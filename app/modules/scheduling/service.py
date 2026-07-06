"""Scheduling service - Business logic for appointment management."""

import json
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import and_, exists, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit
from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.core.pagination import paginate
from app.core.permissions import (
    apply_store_filter,
    hide_galpon_user,
    is_galpon_profile_user,
    require_resource_access,
)
from app.modules.auth.models import User
from app.modules.scheduling.models import Appointment
from app.modules.scheduling.schemas import (
    AppointmentCreate,
    AppointmentHistoryEntry,
    AppointmentHistoryResponse,
    AppointmentResponse,
    AppointmentSummaryResponse,
    AppointmentUpdate,
    GenerateOSRequest,  # noqa: F401 — usado no type hint de generate_service_order
)
from app.modules.service_orders.enums import OSStatus
from app.websocket.manager import manager as ws_manager

# Status de O.S. que NÃO são finalizáveis (terminais ou inválidos). Um agendamento
# vinculado a uma O.S. nesses status não deve oferecer a ação de Finalizar — caso
# contrário o backend recusa com 422. Para exibição, são tratados como terminais.
_OS_NAO_FINALIZAVEL = {
    OSStatus.COMPLETED,
    OSStatus.CANCELLED,
    OSStatus.WRONG,
    OSStatus.DUPLICATE,
}


def compute_display_status(appt: Appointment, os_status: str | None) -> str:
    """
    Calcula o display_status de um agendamento com base em regras de negócio.

    Regras (por prioridade):
    - cancelled → 'cancelado'
    - OS vinculada em status terminal/não-finalizável (completed, cancelled, wrong,
      duplicate) → 'finalizado' (não oferece ação de Finalizar)
    - delivery_date vencida (com OS ainda ativa ou sem OS) → 'atrasado'
    - OS vinculada ainda finalizável (waiting/in_progress) → 'em_execucao'
    - sem OS + delivery_date == amanhã → 'atencao'
    - else → 'agendado'
    """
    if appt.status == "cancelled":
        return "cancelado"

    # O.S. em status terminal/não-finalizável tem prioridade sobre data vencida:
    # não está "atrasada" nem "em execução" — o trabalho não é mais acionável aqui.
    if appt.service_order_id is not None and os_status in _OS_NAO_FINALIZAVEL:
        return "finalizado"

    today = date.today()
    tomorrow = today + timedelta(days=1)

    # Data vencida com O.S. ainda ativa (ou sem O.S.)
    if appt.delivery_date < today:
        return "atrasado"

    if appt.service_order_id is not None:
        return "em_execucao"

    if appt.delivery_date == tomorrow:
        return "atencao"

    return "agendado"


def _load_options():
    """Returns selectinload options for Appointment relationships."""
    return [
        selectinload(Appointment.store),
        selectinload(Appointment.consultant),
        selectinload(Appointment.service_order),
    ]


def appointment_to_response(
    appt: Appointment,
    service_map: dict[int, dict] | None = None,
    roll_map: dict[tuple[int, int], str] | None = None,
) -> AppointmentResponse:
    """
    Converte um Appointment ORM para AppointmentResponse, calculando display_status.
    service_map: {service_id: {"name": ..., "code": ...}} para popular service_names
    e enriquecer film_entries sem query extra.
    roll_map: {(service_order_id, service_id): código visual da bobina} para expor
    a bobina utilizada (atribuída no Finalizar, nos itens da O.S. gerada) em cada
    film_entry como "film_roll_code".
    """
    os_status = appt.service_order.status if appt.service_order else None
    display_status = compute_display_status(appt, os_status)

    def _label(info: dict) -> str:
        return f"{info['code']} - {info['name']}" if info.get("code") else info["name"]

    smap = service_map or {}
    film_ids = [fe.get("service_id") for fe in (appt.film_entries or []) if fe.get("service_id")]
    other_ids = [sid for sid in (appt.service_ids or []) if sid not in film_ids]
    ordered_ids = list(dict.fromkeys(film_ids + other_ids))
    service_names = [_label(smap[sid]) for sid in ordered_ids if sid in smap]

    enriched_film_entries = None
    if appt.film_entries:
        rmap = roll_map or {}
        enriched_film_entries = []
        for fe in appt.film_entries:
            info = smap.get(fe.get("service_id"))
            roll_code = (
                rmap.get((appt.service_order_id, fe.get("service_id")))
                if appt.service_order_id and fe.get("service_id")
                else None
            )
            enriched_film_entries.append(
                {
                    **fe,
                    "service_name": info["name"] if info else None,
                    "service_code": info["code"] if info else None,
                    "film_roll_code": roll_code,
                }
            )

    # Fotos da chancela/chassi e observações da O.S. vinculada (já eager-loaded)
    completion_photos: list[str] | None = None
    service_order_notes: str | None = None
    if appt.service_order:
        service_order_notes = appt.service_order.notes
        if appt.service_order.completion_photos:
            try:
                parsed = json.loads(appt.service_order.completion_photos)
                if isinstance(parsed, list):
                    completion_photos = [p for p in parsed if isinstance(p, str)]
            except (ValueError, TypeError):
                completion_photos = None

    return AppointmentResponse.model_validate(
        {
            "id": appt.id,
            "store_id": appt.store_id,
            "store_name": appt.store.name if appt.store else None,
            "department": appt.department,
            "delivery_date": appt.delivery_date,
            "delivery_time": appt.delivery_time,
            "external_os_number": appt.external_os_number,
            "vehicle_plate": appt.vehicle_plate,
            "vehicle_model": appt.vehicle_model,
            "vehicle_color": appt.vehicle_color,
            "consultant_id": appt.consultant_id,
            "consultant_name": appt.consultant_name,
            "service_ids": appt.service_ids or [],
            "service_names": service_names,
            "notes": appt.notes,
            "is_galpon": appt.is_galpon,
            "is_courtesy": appt.is_courtesy,
            "is_return": appt.is_return,
            "film_type_id": appt.film_type_id,
            "film_tonality": appt.film_tonality,
            "film_entries": enriched_film_entries,
            "status": appt.status,
            "display_status": display_status,
            "service_order_id": appt.service_order_id,
            "service_order_number": appt.service_order.order_number if appt.service_order else None,
            "service_order_notes": service_order_notes,
            "completion_photos": completion_photos,
            "created_by_id": appt.created_by_id,
            "cancelled_at": appt.cancelled_at,
            "cancellation_reason": appt.cancellation_reason,
            "created_at": appt.created_at,
            "updated_at": appt.updated_at,
        }
    )


async def get_appointment_by_id(db: AsyncSession, appointment_id: int) -> Appointment | None:
    """Busca agendamento por ID com relacionamentos carregados."""
    result = await db.execute(
        select(Appointment).where(Appointment.id == appointment_id).options(*_load_options())
    )
    return result.scalar_one_or_none()


async def get_appointment(db: AsyncSession, appointment_id: int, user: User) -> Appointment:
    """
    Busca agendamento por ID verificando permissão de acesso.

    Raises:
        NotFoundError: Se não encontrado ou usuário sem acesso à loja.
    """
    appt = await get_appointment_by_id(db, appointment_id)
    if appt is None:
        raise NotFoundError(resource="Agendamento")
    require_resource_access(user, appt.store_id, "Agendamento")
    return appt


async def _build_service_map(db: AsyncSession, appointments: list[Appointment]) -> dict[int, dict]:
    """Coleta todos os service_ids referenciados e retorna {id: {'name': ..., 'code': ...}}.

    Não filtra is_active: resolve nome de serviços inativos referenciados em agendamentos.
    """
    from app.modules.services.models import Service

    all_ids: set[int] = set()
    for appt in appointments:
        for fe in appt.film_entries or []:
            if fe.get("service_id"):
                all_ids.add(fe["service_id"])
        for sid in appt.service_ids or []:
            all_ids.add(sid)
    if not all_ids:
        return {}
    result = await db.execute(
        select(Service.id, Service.name, Service.code).where(Service.id.in_(all_ids))
    )
    return {row.id: {"name": row.name, "code": row.code} for row in result.all()}


async def _build_roll_map(
    db: AsyncSession, appointments: list[Appointment]
) -> dict[tuple[int, int], str]:
    """
    Mapa {(service_order_id, service_id): código visual da bobina} dos itens das
    O.S. geradas pelos agendamentos. A bobina é atribuída no Finalizar
    (ServiceOrderItem.film_roll_id) — o agendamento em si não a guarda.
    Uma única query para todos os agendamentos da lista (sem N+1).
    """
    from app.modules.inventory.models import FilmRoll
    from app.modules.inventory.service import compute_visual_id
    from app.modules.service_orders.models import ServiceOrderItem

    os_ids = [a.service_order_id for a in appointments if a.service_order_id]
    if not os_ids:
        return {}

    result = await db.execute(
        select(ServiceOrderItem)
        .where(
            ServiceOrderItem.service_order_id.in_(os_ids),
            ServiceOrderItem.film_roll_id.isnot(None),
        )
        .options(selectinload(ServiceOrderItem.film_roll).selectinload(FilmRoll.film_type))
    )

    roll_map: dict[tuple[int, int], str] = {}
    for item in result.scalars():
        code: str | None = None
        roll = item.film_roll
        if roll is not None:
            code = compute_visual_id(
                roll.film_type.name if roll.film_type else "",
                roll.tonality,
                roll.receipt_date,
                roll.total_meters,
            )
            # visual_id termina com " [metros]" — irrelevante para o detalhe
            code = code.split(" [")[0]
        code = code or item.roll_code
        if code and item.service_id:
            roll_map.setdefault((item.service_order_id, item.service_id), code)
    return roll_map


async def list_appointments(
    db: AsyncSession,
    user: User,
    store_id: int | None = None,
    department: str | None = None,
    category: str | None = None,
    display_status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    include_cancelled: bool = False,
    include_terminal: bool = False,
    page: int = 1,
    limit: int = 20,
) -> tuple[list[AppointmentResponse], int]:
    """
    Lista agendamentos com filtros e paginação.

    O parâmetro display_status é ignorado no filtro SQL — o frontend aplica
    o filtro visual. Por padrão, cancelados são excluídos a menos que
    display_status == 'cancelado' ou include_cancelled=True.

    Returns:
        Tuple com lista de AppointmentResponse e total de registros.
    """
    query = select(Appointment).options(*_load_options())

    # Filtro de loja por permissão
    query = apply_store_filter(query, user, Appointment.store_id)

    # Perfil galpão vê apenas agendamentos marcados como galpão
    if is_galpon_profile_user(user):
        query = query.where(Appointment.is_galpon.is_(True))
    elif hide_galpon_user(user):
        query = query.where(Appointment.is_galpon.is_(False))

    # Filtro explícito de loja
    if store_id is not None:
        from app.modules.stores.models import Store

        store_result = await db.execute(select(Store.is_galpon_store).where(Store.id == store_id))
        is_selected_galpon_store = store_result.scalar_one_or_none() or False
        if is_selected_galpon_store:
            # Loja galpão: exibir todos os agendamentos marcados como galpão
            query = query.where(Appointment.is_galpon.is_(True))
        else:
            query = query.where(Appointment.store_id == store_id)

    # Filtro de departamento
    if department is not None:
        query = query.where(Appointment.department == department)

    # Filtro de categoria de serviço — verifica se algum serviço dos service_ids
    # pertence à categoria informada (JOIN via subquery no PostgreSQL JSON cast)
    if category is not None:
        query = query.where(
            text(
                "EXISTS ("
                "SELECT 1 FROM services s "
                "WHERE s.category = :cat "
                "AND s.id = ANY(appointments.service_ids::int[])"
                ")"
            ).bindparams(cat=category)
        )

    # Filtro de data de entrega
    if date_from is not None:
        query = query.where(Appointment.delivery_date >= date_from)
    if date_to is not None:
        query = query.where(Appointment.delivery_date <= date_to)

    # Busca por placa ou número de O.S. externa
    if search is not None:
        search_term = f"%{search}%"
        query = query.where(
            or_(
                Appointment.vehicle_plate.ilike(search_term),
                Appointment.external_os_number.ilike(search_term),
            )
        )

    # Excluir cancelados por padrão
    if not include_cancelled and display_status != "cancelado":
        query = query.where(Appointment.status != "cancelled")

    # Por padrão, ocultar agendamentos TERMINAIS (cancelados + finalizados) para que os
    # agendamentos ATIVOS (agendado/atrasado/atenção/em execução) não sejam truncados pela
    # paginação. O "Mostrar finalizados/cancelados" do frontend envia include_terminal=True.
    if not include_terminal and display_status not in ("cancelado", "finalizado"):
        from app.modules.service_orders.models import ServiceOrder

        query = query.where(Appointment.status != "cancelled")
        query = query.where(
            ~exists().where(
                and_(
                    ServiceOrder.id == Appointment.service_order_id,
                    ServiceOrder.status == OSStatus.COMPLETED.value,
                )
            )
        )

    items, total = await paginate(
        db,
        query,
        page=page,
        limit=limit,
        order_by=(Appointment.delivery_date.asc(), Appointment.id.asc()),
    )

    service_map = await _build_service_map(db, items)
    roll_map = await _build_roll_map(db, items)
    return [appointment_to_response(a, service_map, roll_map) for a in items], total


async def create_appointment(
    db: AsyncSession, data: AppointmentCreate, user: User
) -> AppointmentResponse:
    """
    Cria um novo agendamento.

    - Verifica que a loja existe.
    - Preserva consultant_name se consultant_id for fornecido.
    """
    from app.modules.stores.models import Store

    # Verifica que a loja existe
    store_result = await db.execute(select(Store).where(Store.id == data.store_id))
    store = store_result.scalar_one_or_none()
    if store is None:
        raise NotFoundError(resource="Loja")

    # Resolve consultant_name
    consultant_name: str | None = None
    if data.consultant_id is not None:
        from app.modules.consultants.models import Consultant

        consultant_result = await db.execute(
            select(Consultant).where(Consultant.id == data.consultant_id)
        )
        consultant = consultant_result.scalar_one_or_none()
        if consultant is not None:
            consultant_name = consultant.name

    appt = Appointment(
        store_id=data.store_id,
        department=data.department,
        delivery_date=data.delivery_date,
        delivery_time=data.delivery_time,
        external_os_number=data.external_os_number,
        vehicle_plate=data.vehicle_plate,
        vehicle_model=data.vehicle_model,
        vehicle_color=data.vehicle_color,
        consultant_id=data.consultant_id,
        consultant_name=consultant_name,
        service_ids=data.service_ids or None,
        film_entries=[e.model_dump() for e in data.film_entries] if data.film_entries else None,
        notes=data.notes,
        is_galpon=data.is_galpon,
        is_courtesy=data.is_courtesy,
        is_return=data.is_return,
        film_type_id=data.film_type_id,
        film_tonality=data.film_tonality,
        status="scheduled",
        created_by_id=user.id,
    )

    db.add(appt)
    await db.flush()

    await log_audit(
        db=db,
        action="create",
        resource_type="appointment",
        user_id=user.id,
        resource_id=appt.id,
        new_value={
            "store_id": appt.store_id,
            "delivery_date": str(appt.delivery_date),
            "vehicle_plate": appt.vehicle_plate,
            "department": appt.department,
        },
    )

    # Reload with relationships
    appt = await get_appointment_by_id(db, appt.id)
    await db.commit()
    await db.refresh(appt)

    # Reload again to ensure all relations are fresh after commit
    appt = await get_appointment_by_id(db, appt.id)

    # Disparar notificação de novo agendamento
    try:
        await _notify_appointment_created(db, appt)
    except Exception:
        pass

    try:
        await ws_manager.send_to_store(
            appt.store_id,
            "appointment_created",
            {"id": appt.id, "store_id": appt.store_id, "delivery_date": str(appt.delivery_date)},
        )
    except Exception:
        pass

    return appointment_to_response(
        appt, await _build_service_map(db, [appt]), await _build_roll_map(db, [appt])
    )


async def update_appointment(
    db: AsyncSession, appointment_id: int, data: AppointmentUpdate, user: User
) -> AppointmentResponse:
    """
    Atualiza um agendamento existente.

    Raises:
        ValidationError: Se o agendamento estiver cancelado ou tiver OS gerada.
        NotFoundError: Se o agendamento não existir ou usuário sem acesso.
    """
    appt = await get_appointment(db, appointment_id, user)

    if appt.status == "cancelled":
        raise ValidationError("Não é possível editar um agendamento cancelado")

    if appt.service_order_id is not None:
        raise ValidationError("Não é possível editar um agendamento com OS gerada")

    update_data = data.model_dump(exclude_unset=True)

    # If consultant_id changed, resolve new consultant_name
    if "consultant_id" in update_data:
        new_consultant_id = update_data["consultant_id"]
        if new_consultant_id is not None:
            from app.modules.consultants.models import Consultant

            consultant_result = await db.execute(
                select(Consultant).where(Consultant.id == new_consultant_id)
            )
            consultant = consultant_result.scalar_one_or_none()
            update_data["consultant_name"] = consultant.name if consultant is not None else None
        else:
            update_data["consultant_name"] = None

    # Serialize film_entries list[FilmEntryItem] → list[dict] for JSON storage
    if "film_entries" in update_data and update_data["film_entries"] is not None:
        from app.modules.scheduling.schemas import FilmEntryItem as _FilmEntryItem

        raw = update_data["film_entries"]
        update_data["film_entries"] = [
            e.model_dump() if isinstance(e, _FilmEntryItem) else e for e in raw
        ]

    old_value = {field: getattr(appt, field, None) for field in update_data}

    for field, value in update_data.items():
        setattr(appt, field, value)

    await log_audit(
        db=db,
        action="update",
        resource_type="appointment",
        user_id=user.id,
        resource_id=appt.id,
        old_value=old_value,
        new_value=update_data,
    )

    await db.commit()
    await db.refresh(appt)

    appt = await get_appointment_by_id(db, appt.id)

    try:
        await ws_manager.send_to_store(
            appt.store_id,
            "appointment_updated",
            {"id": appt.id, "store_id": appt.store_id, "delivery_date": str(appt.delivery_date)},
        )
    except Exception:
        pass

    return appointment_to_response(
        appt, await _build_service_map(db, [appt]), await _build_roll_map(db, [appt])
    )


async def cancel_appointment(
    db: AsyncSession, appointment_id: int, reason: str | None, user: User
) -> AppointmentResponse:
    """
    Cancela um agendamento (não deleta do banco).

    Raises:
        ConflictError: Se o agendamento já estiver cancelado.
        NotFoundError: Se o agendamento não existir ou usuário sem acesso.
    """
    appt = await get_appointment(db, appointment_id, user)

    if appt.status == "cancelled":
        raise ConflictError("Agendamento já está cancelado")

    old_status = appt.status
    appt.status = "cancelled"
    appt.cancelled_at = datetime.now(UTC)
    appt.cancellation_reason = reason

    await log_audit(
        db=db,
        action="cancel",
        resource_type="appointment",
        user_id=user.id,
        resource_id=appt.id,
        old_value={"status": old_status},
        new_value={"status": "cancelled"},
    )

    await db.commit()
    await db.refresh(appt)

    appt = await get_appointment_by_id(db, appt.id)

    try:
        await ws_manager.send_to_store(
            appt.store_id,
            "appointment_cancelled",
            {"id": appt.id, "store_id": appt.store_id},
        )
    except Exception:
        pass

    return appointment_to_response(
        appt, await _build_service_map(db, [appt]), await _build_roll_map(db, [appt])
    )


async def get_today_summary(
    db: AsyncSession, user: User, store_id: int | None = None
) -> AppointmentSummaryResponse:
    """
    Retorna contadores de agendamentos para o dia atual + atrasados sem OS.

    Inclui:
    - Agendamentos com delivery_date == hoje
    - Agendamentos atrasados (delivery_date < hoje, status scheduled, sem OS)
    """
    today = date.today()

    query = (
        select(Appointment)
        .options(*_load_options())
        .where(
            or_(
                Appointment.delivery_date == today,
                and_(
                    Appointment.delivery_date < today,
                    Appointment.status == "scheduled",
                ),
            )
        )
    )

    query = apply_store_filter(query, user, Appointment.store_id)

    if is_galpon_profile_user(user):
        query = query.where(Appointment.is_galpon.is_(True))
    elif hide_galpon_user(user):
        query = query.where(Appointment.is_galpon.is_(False))

    if store_id is not None:
        query = query.where(Appointment.store_id == store_id)

    result = await db.execute(query)
    appointments = result.scalars().all()

    summary = AppointmentSummaryResponse()

    for appt in appointments:
        os_status = appt.service_order.status if appt.service_order else None
        ds = compute_display_status(appt, os_status)
        if ds == "atrasado":
            summary.atrasado += 1
        elif ds == "atencao":
            summary.atencao += 1
        elif ds == "agendado":
            summary.agendado += 1
        elif ds == "em_execucao":
            summary.em_execucao += 1
        elif ds == "finalizado":
            summary.finalizado += 1
        elif ds == "cancelado":
            summary.cancelado += 1

    return summary


async def get_capacity_count(db: AsyncSession, store_id: int, delivery_date: date) -> int:
    """
    Conta quantos agendamentos ativos existem para a loja+data de entrega.
    """
    result = await db.execute(
        select(func.count(Appointment.id)).where(
            and_(
                Appointment.store_id == store_id,
                Appointment.delivery_date == delivery_date,
                Appointment.status != "cancelled",
            )
        )
    )
    return result.scalar() or 0


async def generate_service_order(
    db: AsyncSession,
    appointment_id: int,
    data: GenerateOSRequest,
    user: User,
):
    """
    Gera uma O.S. a partir de um agendamento existente.

    - Valida que o agendamento está ativo e sem O.S. vinculada.
    - Constrói a O.S. com dados do agendamento + dados fornecidos pelo instalador.
    - Vincula a O.S. ao agendamento via service_order_id.

    Raises:
        ValidationError: Se o agendamento estiver cancelado ou já tiver O.S.
        NotFoundError: Se o agendamento não existir.
    """
    from app.modules.service_orders.schemas import (
        ServiceOrderCreate,
        ServiceOrderItemCreate,
    )
    from app.modules.service_orders.schemas import (
        StatusUpdateRequest as _StatusUpdateRequest,
    )
    from app.modules.service_orders.service import change_status as _change_status
    from app.modules.service_orders.service import create_service_order
    from app.modules.services.enums import ServiceDepartment

    appt = await get_appointment(db, appointment_id, user)

    if appt.status == "cancelled":
        raise ValidationError("Não é possível gerar O.S. para agendamento cancelado")

    if appt.service_order_id is not None:
        raise ConflictError("Este agendamento já possui uma O.S. gerada")

    # Construir itens a partir do agendamento (sem film_roll_id — será atribuído no Finalizar)
    os_items: list[ServiceOrderItemCreate] = []

    if appt.film_entries:
        for fe in appt.film_entries:
            os_items.append(
                ServiceOrderItemCreate(
                    service_id=fe["service_id"],
                    tonality=fe.get("tonality"),
                    film_roll_id=None,  # deferred to finalize
                    film_type_id=fe.get("film_type_id") or appt.film_type_id,
                )
            )

    # Itens de serviços não-película (service_ids que não estão em film_entries)
    film_service_ids = {fe["service_id"] for fe in (appt.film_entries or [])}
    non_film_service_ids = [sid for sid in (appt.service_ids or []) if sid not in film_service_ids]
    for sid in non_film_service_ids:
        if not any(item.service_id == sid for item in os_items):
            os_items.append(ServiceOrderItemCreate(service_id=sid))

    if not os_items:
        raise ValidationError("O agendamento não possui serviços cadastrados para gerar a O.S.")

    # Montar payload da O.S.
    try:
        department = ServiceDepartment(appt.department)
    except ValueError as err:
        raise ValidationError(f"Departamento inválido: {appt.department}") from err

    os_data = ServiceOrderCreate(
        store_id=appt.store_id,
        consultant_id=appt.consultant_id,
        is_galpon=appt.is_galpon,
        is_courtesy=appt.is_courtesy,
        is_return=appt.is_return,
        vehicle_plate=appt.vehicle_plate,
        vehicle_model=appt.vehicle_model,
        vehicle_color=appt.vehicle_color,
        department=department,
        external_os_number=appt.external_os_number,
        photos=data.photos,
        notes=data.notes or appt.notes,
        items=os_items,
        workers=[],  # sem workers no Gerar — atribuídos no Finalizar
        service_date=appt.delivery_date,
    )

    service_order = await create_service_order(db, os_data, user)

    # Mover para in_progress automaticamente (OS de agendamento nasce fazendo),
    # exceto se já nasceu marcada como duplicada — nesse caso preserva o status para revisão.
    if service_order.status != OSStatus.DUPLICATE.value:
        status_req = _StatusUpdateRequest(new_status=OSStatus.IN_PROGRESS)
        service_order = await _change_status(db, service_order.id, status_req, user)

    # Vincular O.S. ao agendamento
    appt_obj = await get_appointment_by_id(db, appointment_id)
    if appt_obj:
        appt_obj.service_order_id = service_order.id
        await db.commit()

    await log_audit(
        db=db,
        action="generate_os",
        resource_type="appointment",
        user_id=user.id,
        resource_id=appointment_id,
        new_value={"service_order_id": service_order.id},
    )

    return service_order


async def get_appointment_history(
    db: AsyncSession, appointment_id: int, user: User
) -> AppointmentHistoryResponse:
    """
    Retorna o histórico de edições de um agendamento via audit_logs.

    A finalização da O.S. vinculada não gera audit_log do agendamento — é
    mesclada dinamicamente a partir do StatusHistory da O.S. (to_status
    'completed'), como action "finalize_os". Cobre também finalizações
    anteriores a esta feature, sem backfill.

    Verifica que o usuário tem acesso à loja do agendamento antes de retornar.
    Acessível a qualquer usuário com permissão de visualizar agendamentos.
    """
    from app.core.audit import AuditLog
    from app.modules.auth.models import User as UserModel

    appt = await get_appointment(db, appointment_id, user)

    result = await db.execute(
        select(AuditLog)
        .where(
            and_(
                AuditLog.resource_type == "appointment",
                AuditLog.resource_id == appointment_id,
            )
        )
        .order_by(AuditLog.created_at.desc())
    )
    logs = result.scalars().all()

    items = []
    for log in logs:
        user_name: str | None = None
        if log.user_id is not None:
            user_result = await db.execute(
                select(UserModel.full_name).where(UserModel.id == log.user_id)
            )
            user_name = user_result.scalar_one_or_none()

        items.append(
            AppointmentHistoryEntry(
                id=log.id,
                action=log.action,
                user_id=log.user_id,
                user_name=user_name,
                old_value=log.old_value,
                new_value=log.new_value,
                created_at=log.created_at,
            )
        )

    # Finalização da O.S. vinculada (id negativo para não colidir com audit_logs)
    if appt.service_order_id is not None:
        from app.modules.service_orders.models import StatusHistory

        history_result = await db.execute(
            select(StatusHistory)
            .where(
                StatusHistory.service_order_id == appt.service_order_id,
                StatusHistory.to_status == OSStatus.COMPLETED.value,
            )
            .options(selectinload(StatusHistory.changed_by))
        )
        for sh in history_result.scalars():
            items.append(
                AppointmentHistoryEntry(
                    id=-sh.id,
                    action="finalize_os",
                    user_id=sh.changed_by_id,
                    user_name=sh.changed_by.full_name if sh.changed_by else None,
                    old_value=None,
                    new_value=None,
                    created_at=sh.changed_at,
                )
            )
        items.sort(key=lambda e: e.created_at, reverse=True)

    return AppointmentHistoryResponse(items=items)


async def get_store_summaries(
    db: AsyncSession,
    user: User,
    date_from: date | None = None,
    date_to: date | None = None,
    department: str | None = None,
) -> list:
    """
    Retorna contadores de agendamentos agrupados por loja.
    Respeita filtros de acesso do usuário (apply_store_filter equivalente).
    """
    from app.core.permissions import PermissionChecker
    from app.modules.scheduling.schemas import SchedulingStoreSummary

    store_ids = PermissionChecker.get_user_store_ids(user)
    is_owner = user.role == "owner"

    # Usuário não-owner sem lojas configuradas: sem acesso
    if not is_owner and not store_ids:
        return []

    galpon_only = is_galpon_profile_user(user)

    conditions: list[str] = []
    params: dict = {}

    if not is_owner:
        conditions.append("a.store_id = ANY(:store_ids)")
        params["store_ids"] = store_ids

    if galpon_only:
        conditions.append("a.is_galpon = TRUE")

    if date_from is not None:
        conditions.append("a.delivery_date >= :date_from")
        params["date_from"] = date_from

    if date_to is not None:
        conditions.append("a.delivery_date <= :date_to")
        params["date_to"] = date_to

    if department is not None:
        conditions.append("a.department = :department")
        params["department"] = department

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    sql = text(f"""
        SELECT
            a.store_id,
            s.name AS store_name,
            COUNT(CASE WHEN a.status = 'cancelled' THEN 1 END)::int AS cancelado,
            COUNT(CASE WHEN a.status != 'cancelled' AND so.status = 'completed' THEN 1 END)::int AS finalizado,
            COUNT(CASE WHEN a.status != 'cancelled' AND a.service_order_id IS NOT NULL AND COALESCE(so.status, '') != 'completed' AND a.delivery_date >= CURRENT_DATE THEN 1 END)::int AS em_execucao,
            COUNT(CASE WHEN a.status != 'cancelled' AND a.delivery_date < CURRENT_DATE AND COALESCE(so.status, '') != 'completed' THEN 1 END)::int AS atrasado,
            COUNT(CASE WHEN a.status != 'cancelled' AND a.service_order_id IS NULL AND a.delivery_date = CURRENT_DATE + 1 THEN 1 END)::int AS atencao,
            COUNT(CASE WHEN a.status != 'cancelled' AND a.service_order_id IS NULL AND a.delivery_date >= CURRENT_DATE AND a.delivery_date != CURRENT_DATE + 1 THEN 1 END)::int AS agendado,
            COUNT(CASE WHEN a.status != 'cancelled' THEN 1 END)::int AS total
        FROM appointments a
        JOIN stores s ON a.store_id = s.id
        LEFT JOIN service_orders so ON a.service_order_id = so.id
        {where_clause}
        GROUP BY a.store_id, s.name
        ORDER BY s.name
    """)

    if params:
        sql = sql.bindparams(**params)

    result = await db.execute(sql)
    rows = result.mappings().all()

    return [
        SchedulingStoreSummary(
            store_id=row["store_id"],
            store_name=row["store_name"],
            cancelado=row["cancelado"],
            finalizado=row["finalizado"],
            em_execucao=row["em_execucao"],
            atrasado=row["atrasado"],
            atencao=row["atencao"],
            agendado=row["agendado"],
            total=row["total"],
        )
        for row in rows
    ]


async def _notify_appointment_created(db: AsyncSession, appt: "Appointment") -> None:
    """Notifica owners sobre novo agendamento."""
    from sqlalchemy import select as sa_select

    from app.modules.auth.models import User as _User
    from app.modules.notifications.schemas import NotificationType
    from app.modules.notifications.service import create_notification

    owners_result = await db.execute(
        sa_select(_User).where(_User.role == "owner", _User.is_active == True)  # noqa: E712
    )
    owners = list(owners_result.scalars().all())

    plate = appt.vehicle_plate or "—"
    title = "Novo Agendamento"
    body = f"Agendamento criado para {plate} em {appt.delivery_date.strftime('%d/%m/%Y')}."

    for owner in owners:
        await create_notification(
            db=db,
            user_id=owner.id,
            type=NotificationType.SCHEDULING_CREATED,
            title=title,
            body=body,
            is_galpon=appt.is_galpon,
        )
