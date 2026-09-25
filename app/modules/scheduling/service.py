"""Scheduling service - Business logic for appointment management."""

import json
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

from sqlalchemy import Select, and_, exists, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit
from app.core.exceptions import (
    AuthorizationError,
    ConflictError,
    NotFoundError,
    ValidationError,
)
from app.core.pagination import paginate
from app.core.permissions import (
    apply_store_filter,
    hide_galpon_user,
    is_galpon_profile_user,
    require_resource_access,
    scheduling_visibility_scopes,
)
from app.core.validators import normalize_tonality
from app.modules.auth.models import User
from app.modules.scheduling.models import Appointment
from app.modules.scheduling.schemas import (
    AppointmentCreate,
    AppointmentHistoryEntry,
    AppointmentHistoryResponse,
    AppointmentResponse,
    AppointmentSummaryResponse,
    AppointmentUpdate,
    CarrosResumoItem,
    CarrosResumoResponse,
    CombinedAppointmentCreate,
    CombinedDepartmentEntry,
    GenerateOSRequest,  # noqa: F401 — usado no type hint de generate_service_order
)
from app.modules.service_orders.enums import OSStatus
from app.websocket.manager import manager as ws_manager

# Departamentos em que a tonalidade é obrigatória por película (PPF usa marca).
TONALITY_REQUIRED_DEPARTMENTS = {"film", "security_film"}

DEPARTMENT_LABELS = {
    "film": "Película",
    "security_film": "Película de Segurança",
    "ppf": "PPF",
    "bodywork": "Funilaria",
    "vn": "VN",
    "vd": "VD",
    "vu": "VU",
    "workshop": "Oficina",
}


def _apply_visibility_scopes(query, user: User):
    """
    Aplica o escopo de visibilidade do Agendamento (loja × departamento por perfil)
    a uma query ORM sobre Appointment. Owner não é filtrado; usuário sem escopo é
    bloqueado. Ver app.core.permissions.scheduling_visibility_scopes.
    """
    scopes = scheduling_visibility_scopes(user)
    if scopes is None:  # owner
        return query
    if not scopes:  # sem escopo → nenhum registro
        return query.where(Appointment.store_id == -1)
    predicates = []
    for store_ids, depts in scopes:
        pred = Appointment.store_id.in_(store_ids)
        if depts:
            pred = and_(pred, Appointment.department.in_(depts))
        predicates.append(pred)
    return query.where(or_(*predicates))


def _assert_can_schedule_department(user: User, store_id: int, department: str) -> None:
    """Valida, na CRIAÇÃO, que (loja, departamento) está dentro do escopo de
    visibilidade do perfil — espelha o filtro de leitura de `_apply_visibility_scopes`.
    Sem isso, um usuário restrito a um departamento poderia criar agendamento de
    outro departamento numa loja que ele acessa. Owner não é restrito.
    """
    scopes = scheduling_visibility_scopes(user)
    if scopes is None:  # owner
        return
    for store_ids, depts in scopes:
        if store_id in store_ids and (not depts or department in depts):
            return
    raise AuthorizationError(detail="Sem acesso a este departamento no Agendamento")


def _collect_service_ids(service_ids, film_entries) -> set[int]:
    """Reúne os service_ids do agendamento (lista direta + film_entries, item ou dict)."""
    ids: set[int] = {sid for sid in (service_ids or []) if sid}
    for entry in film_entries or []:
        sid = entry.get("service_id") if isinstance(entry, dict) else entry.service_id
        if sid:
            ids.add(sid)
    return ids


async def _validate_services_department(
    db: AsyncSession, department: str | None, service_ids: set[int]
) -> None:
    """
    Garante que todos os serviços do agendamento pertencem ao seu departamento.

    Sem isso, trocar o departamento mantendo serviços antigos cria agendamentos
    mistos — e a finalização passa a tratar bobinas de película como opcionais
    quando o departamento do agendamento não é film.

    Raises:
        ValidationError: Se algum serviço não existir ou for de outro departamento.
    """
    if not department or not service_ids:
        return

    from app.modules.services.models import Service

    result = await db.execute(select(Service).where(Service.id.in_(service_ids)))
    services = {s.id: s for s in result.scalars()}

    missing = sorted(service_ids - services.keys())
    if missing:
        raise ValidationError(f"Serviços inexistentes no catálogo: {', '.join(map(str, missing))}")

    wrong = sorted(
        (s for s in services.values() if s.department != department),
        key=lambda s: s.name,
    )
    if wrong:
        dept_label = DEPARTMENT_LABELS.get(department, department)
        names = ", ".join(f"{s.code} - {s.name}" if s.code else s.name for s in wrong)
        raise ValidationError(
            f"Os serviços a seguir não pertencem ao departamento "
            f"{dept_label} do agendamento: {names}"
        )


def _validate_film_tonalities(department: str | None, film_entries) -> None:
    """
    Garante que toda película informada tenha tonalidade quando o departamento exige.

    Aceita entradas como FilmEntryItem ou dict (film_entries já serializado).
    Entradas com `applications` (tonalidade por região) exigem tonalidade em
    todas as regiões.

    Raises:
        ValidationError: Se alguma película estiver sem tonalidade.
    """
    if department not in TONALITY_REQUIRED_DEPARTMENTS or not film_entries:
        return
    for entry in film_entries:
        if isinstance(entry, dict):
            applications = entry.get("applications")
            tonality = entry.get("tonality")
        else:
            applications = entry.applications
            tonality = entry.tonality
        if applications:
            for app in applications:
                app_tonality = app.get("tonality") if isinstance(app, dict) else app.tonality
                if not (app_tonality and str(app_tonality).strip()):
                    raise ValidationError("Informe a tonalidade de todas as regiões da película")
            continue
        if not (tonality and str(tonality).strip()):
            raise ValidationError("Informe a tonalidade de todas as películas do agendamento")


def compute_display_status(
    appt: Appointment,
    os_status: str | None,
    os_completion_time: datetime | None = None,
) -> str:
    """
    Calcula o display_status de um agendamento a partir do ESTADO REAL da O.S.

    Regras (por prioridade):
    - agendamento cancelado → 'cancelado'
    - O.S. vinculada 'duplicate' → 'duplicidade' (bucket próprio, tem prioridade)
    - O.S. vinculada FINALIZADA → 'finalizado'. "Finalizada" = status terminal
      (completed/cancelled) OU já teve completion_time gravado. completion_time é
      setado no Finalizar e NUNCA limpo; marcar a O.S. como 'wrong' só troca o status.
      Logo uma O.S. finalizada e depois marcada errada continua 'finalizado' aqui —
      'wrong' NÃO é mais um conceito do Agendamento (vive só na Conferência).
    - O.S. vinculada e ainda não finalizada → 'em_execucao', INDEPENDENTE da data
      (o atraso é marcador ortogonal via ``compute_is_overdue``).
    - sem O.S. + delivery_date vencida → 'atrasado' (nem começou)
    - sem O.S. + delivery_date == amanhã → 'atencao'
    - else → 'agendado'
    """
    if appt.status == "cancelled":
        return "cancelado"

    os_id = appt.service_order_id

    # O.S. duplicada tem display_status próprio e prioridade sobre 'finalizado'.
    if os_id is not None and os_status == OSStatus.DUPLICATE.value:
        return "duplicidade"

    # Finalizada = status terminal OU já finalizada alguma vez (completion_time gravado).
    # Isso torna o Agendamento imune ao rótulo 'wrong': uma O.S. finalizada e depois
    # marcada errada na Conferência continua "finalizado" aqui.
    was_finalized = (
        os_status in {OSStatus.COMPLETED.value, OSStatus.CANCELLED.value}
        or os_completion_time is not None
    )
    if os_id is not None and was_finalized:
        return "finalizado"

    # O.S. vinculada, não-finalizada, não-duplicate → "em execução" INDEPENDENTE da data.
    # O atraso vira marcador separado (is_overdue).
    if os_id is not None:
        return "em_execucao"

    today = date.today()
    tomorrow = today + timedelta(days=1)

    # Sem O.S.: estado por data.
    if appt.delivery_date < today:
        return "atrasado"

    if appt.delivery_date == tomorrow:
        return "atencao"

    return "agendado"


def compute_is_overdue(appt: Appointment, display_status: str) -> bool:
    """
    Marca se o agendamento está VENCIDO (data de entrega passou) e o trabalho ainda
    não foi concluído/cancelado. É um marcador ORTOGONAL ao display_status: uma O.S.
    'em_execucao' ou 'duplicidade' com data vencida fica em_execucao/duplicidade E
    overdue → o card mostra "Em execução" + selo "Atrasado".
    """
    if display_status in ("finalizado", "cancelado"):
        return False
    return appt.delivery_date < date.today()


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
    roll_map: dict[tuple[int, int], dict[str | None, str]] | None = None,
    group_map: dict[str, list[dict]] | None = None,
    os_applications_map: dict[tuple[int, int], list[dict]] | None = None,
) -> AppointmentResponse:
    """
    Converte um Appointment ORM para AppointmentResponse, calculando display_status.
    service_map: {service_id: {"name": ..., "code": ...}} para popular service_names
    e enriquecer film_entries sem query extra.
    roll_map: {(service_order_id, service_id): {tonalidade: código visual da bobina}}
    para expor a bobina utilizada (atribuída no Finalizar, nos itens da O.S. gerada)
    em cada film_entry como "film_roll_code" (chave None = código legado/primeira
    bobina; tonalidades mapeiam os códigos das aplicações por região).
    os_applications_map: {(service_order_id, service_id): [aplicações da O.S.]} —
    tonalidades por região vindas do ITEM da O.S. gerada (ServiceOrderItem.
    film_applications), que é a FONTE DE VERDADE após a O.S. existir. Usado como
    origem das `applications` do film_entry (sobrepondo o JSON do agendamento):
    sem isto, uma O.S. multi-tonalidade cujo agendamento não guarda applications
    entrega applications vazio e o Finalizar quebra com 422 ("tonalidades por
    região"), pois o front não envia a tonalidade da bobina.
    group_map: {appointment_group_id: [GroupSiblingInfo dicts]} para expor os irmãos
    de um agendamento combinado sem N+1.
    """
    os_status = appt.service_order.status if appt.service_order else None
    os_completion_time = appt.service_order.completion_time if appt.service_order else None
    display_status = compute_display_status(appt, os_status, os_completion_time)

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
        oamap = os_applications_map or {}
        enriched_film_entries = []
        for fe in appt.film_entries:
            info = smap.get(fe.get("service_id"))
            os_key = (
                (appt.service_order_id, fe.get("service_id"))
                if appt.service_order_id and fe.get("service_id")
                else None
            )
            codes: dict[str | None, str] = rmap.get(os_key, {}) if os_key else {}
            # Origem das aplicações (tonalidade por região): a O.S. gerada é a
            # fonte de verdade (o item guarda film_applications); o JSON do
            # agendamento é só fallback para registros sem O.S. ou antigos.
            applications = (oamap.get(os_key) if os_key else None) or fe.get("applications")
            if applications:
                # Cada aplicação ganha o código da bobina da sua tonalidade
                # (atribuída no Finalizar); mantém region/tonality para o front.
                applications = [
                    {
                        "tonality": app.get("tonality"),
                        "region": app.get("region"),
                        "film_roll_code": (
                            codes.get(normalize_tonality(app.get("tonality")))
                            or app.get("roll_code")
                            or app.get("film_roll_code")
                        ),
                    }
                    for app in applications
                ]
            enriched_film_entries.append(
                {
                    **fe,
                    "applications": applications,
                    "service_name": info["name"] if info else None,
                    "service_code": info["code"] if info else None,
                    "film_roll_code": codes.get(None),
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

    # Irmãos do agendamento combinado (mesmo carro, outros departamentos)
    appointment_group_id = getattr(appt, "appointment_group_id", None)
    group_siblings = None
    if appointment_group_id and group_map:
        siblings = [s for s in group_map.get(appointment_group_id, []) if s["id"] != appt.id]
        group_siblings = siblings or None

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
            "original_service_order_id": getattr(appt, "original_service_order_id", None),
            "film_type_id": appt.film_type_id,
            "film_tonality": appt.film_tonality,
            "film_entries": enriched_film_entries,
            "status": appt.status,
            "display_status": display_status,
            "is_overdue": compute_is_overdue(appt, display_status),
            "service_order_id": appt.service_order_id,
            "service_order_number": appt.service_order.order_number if appt.service_order else None,
            "service_order_notes": service_order_notes,
            "completion_photos": completion_photos,
            "created_by_id": appt.created_by_id,
            "cancelled_at": appt.cancelled_at,
            "cancellation_reason": appt.cancellation_reason,
            "created_at": appt.created_at,
            "updated_at": appt.updated_at,
            "appointment_group_id": appointment_group_id,
            "group_siblings": group_siblings,
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
) -> dict[tuple[int, int], dict[str | None, str]]:
    """
    Mapa {(service_order_id, service_id): {tonalidade: código visual da bobina}}
    dos itens das O.S. geradas pelos agendamentos. A chave None guarda o código
    legado do item (bobina única); itens multi-tonalidade têm um código por
    tonalidade (gravado em film_applications no Finalizar). A bobina é atribuída
    no Finalizar (ServiceOrderItem.film_roll_id) — o agendamento em si não a
    guarda. Uma única query para todos os agendamentos da lista (sem N+1).
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

    roll_map: dict[tuple[int, int], dict[str | None, str]] = {}
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
        if not item.service_id:
            continue
        entry = roll_map.setdefault((item.service_order_id, item.service_id), {})
        if code:
            entry.setdefault(None, code)
        for app in item.film_applications or []:
            app_tonality = normalize_tonality(app.get("tonality"))
            app_code = app.get("roll_code")
            if app_tonality and app_code:
                entry.setdefault(app_tonality, app_code)
    return roll_map


async def _build_os_applications_map(
    db: AsyncSession, appointments: list[Appointment]
) -> dict[tuple[int, int], list[dict]]:
    """
    Mapa {(service_order_id, service_id): film_applications} dos itens das O.S.
    geradas. Diferente de _build_roll_map, NÃO filtra por film_roll_id: a bobina
    de película é atribuída só no Finalizar, então o item multi-tonalidade fica
    com film_roll_id NULL antes disso — mas já carrega as aplicações (tonalidade
    por região). É a fonte de verdade das `applications` no detalhe do
    agendamento (o JSON do agendamento pode não tê-las). Uma query para toda a
    lista (sem N+1).
    """
    from app.modules.service_orders.models import ServiceOrderItem

    os_ids = [a.service_order_id for a in appointments if a.service_order_id]
    if not os_ids:
        return {}

    result = await db.execute(
        select(ServiceOrderItem).where(
            ServiceOrderItem.service_order_id.in_(os_ids),
            ServiceOrderItem.film_applications.isnot(None),
        )
    )

    apps_map: dict[tuple[int, int], list[dict]] = {}
    for item in result.scalars():
        if not item.service_id or not item.film_applications:
            continue
        apps_map[(item.service_order_id, item.service_id)] = item.film_applications
    return apps_map


async def _build_group_map(
    db: AsyncSession, appointments: list[Appointment]
) -> dict[str, list[dict]]:
    """
    Mapa {appointment_group_id: [irmãos]} dos agendamentos combinados da página.
    Uma única query para todos os grupos (sem N+1); cada irmão carrega id,
    departamento, display_status e service_order_id.
    """
    group_ids = {a.appointment_group_id for a in appointments if a.appointment_group_id}
    if not group_ids:
        return {}

    result = await db.execute(
        select(Appointment)
        .where(Appointment.appointment_group_id.in_(group_ids))
        .options(selectinload(Appointment.service_order))
        .order_by(Appointment.id)
    )
    group_map: dict[str, list[dict]] = {}
    for appt in result.scalars():
        os_status = appt.service_order.status if appt.service_order else None
        os_completion_time = appt.service_order.completion_time if appt.service_order else None
        group_map.setdefault(appt.appointment_group_id, []).append(
            {
                "id": appt.id,
                "department": appt.department,
                "display_status": compute_display_status(appt, os_status, os_completion_time),
                "service_order_id": appt.service_order_id,
            }
        )
    return group_map


async def _build_appointment_base_query(
    db: AsyncSession,
    user: User,
    store_id: int | None = None,
    department: str | None = None,
    category: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
) -> Select:
    """Query base de agendamentos com os filtros comuns às três listagens.

    Aplica visibilidade por perfil (loja × departamento), regra de galpão,
    filtro explícito de loja (incluindo loja-galpão), departamento, categoria de
    serviço, intervalo de datas de entrega e busca por placa/O.S. É compartilhada
    por list_appointments, list_appointments_for_export e list_appointments_for_excel
    para evitar drift entre a tela, o PDF e o Excel.
    """
    query = select(Appointment).options(*_load_options())

    # Escopo de visibilidade por perfil (loja × departamento)
    query = _apply_visibility_scopes(query, user)

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
            # Galpão é um "balde" próprio (a loja-galpão). Ao escolher uma loja
            # CONCESSIONÁRIA, não trazer os carros de galpão dela — eles têm o
            # store_id da concessionária + is_galpon=True e apareceriam em dobro
            # (na loja E na loja-galpão). Ficam só sob a loja-galpão e "Todas as
            # lojas". Exceção: perfil galpão já força is_galpon=True (quer o galpão
            # daquela loja), então não sobrepomos.
            if not is_galpon_profile_user(user):
                query = query.where(Appointment.is_galpon.is_(False))

    # Filtro de departamento
    if department is not None:
        query = query.where(Appointment.department == department)

    # Filtro de categoria de serviço — verifica se algum serviço dos service_ids
    # pertence à categoria informada. `service_ids` é coluna JSON (array de ints);
    # no Postgres o cast direto `json::int[]` é rejeitado (CannotCoerceError), então
    # usamos containment JSONB: `service_ids::jsonb @> to_jsonb(s.id)` verifica se o
    # array contém o id do serviço da categoria.
    if category is not None:
        query = query.where(
            text(
                "EXISTS ("
                "SELECT 1 FROM services s "
                "WHERE s.category = :cat "
                "AND (appointments.service_ids)::jsonb @> to_jsonb(s.id)"
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

    return query


def _exclude_terminal_appointments(query: Select) -> Select:
    """Exclui agendamentos terminais da listagem padrão: cancelados e com O.S.
    FINALIZADA. Espelha compute_display_status: terminal = O.S. em status
    completed/cancelled OU com completion_time gravado (foi finalizada alguma vez,
    mesmo que depois marcada 'wrong'). O rótulo 'wrong' não influencia mais."""
    from app.modules.service_orders.models import ServiceOrder

    query = query.where(Appointment.status != "cancelled")
    return query.where(
        ~exists().where(
            and_(
                ServiceOrder.id == Appointment.service_order_id,
                or_(
                    ServiceOrder.status.in_([OSStatus.COMPLETED.value, OSStatus.CANCELLED.value]),
                    ServiceOrder.completion_time.isnot(None),
                ),
            )
        )
    )


def _apply_finalized_month_window(query: Select) -> Select:
    """Restringe os agendamentos FINALIZADOS ao mês vigente (do dia 1 em diante).

    Agendamentos ativos e cancelados não sofrem restrição; finalizados com data
    de entrega futura (concluídos adiantado) permanecem. Usada quando os terminais
    são exibidos e o usuário não informou intervalo de datas nem busca.
    """
    from app.modules.service_orders.models import ServiceOrder

    month_start = date.today().replace(day=1)
    # "Finalizado" para a janela = O.S. completed/cancelled OU com completion_time
    # (mesma regra do compute_display_status / _exclude_terminal_appointments).
    is_finalized = and_(
        Appointment.status != "cancelled",
        exists().where(
            and_(
                ServiceOrder.id == Appointment.service_order_id,
                or_(
                    ServiceOrder.status.in_([OSStatus.COMPLETED.value, OSStatus.CANCELLED.value]),
                    ServiceOrder.completion_time.isnot(None),
                ),
            )
        ),
    )
    return query.where(or_(~is_finalized, Appointment.delivery_date >= month_start))


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
    query = await _build_appointment_base_query(
        db,
        user,
        store_id=store_id,
        department=department,
        category=category,
        date_from=date_from,
        date_to=date_to,
        search=search,
    )

    # Excluir cancelados por padrão
    if not include_cancelled and display_status != "cancelado":
        query = query.where(Appointment.status != "cancelled")

    # Por padrão, ocultar agendamentos TERMINAIS (cancelados + finalizados) para que os
    # agendamentos ATIVOS (agendado/atrasado/atenção/em execução) não sejam truncados pela
    # paginação. O "Mostrar finalizados/cancelados" do frontend envia include_terminal=True.
    if not include_terminal and display_status not in ("cancelado", "finalizado"):
        query = _exclude_terminal_appointments(query)

    # Janela padrão dos FINALIZADOS: quando os terminais são exibidos e o usuário NÃO
    # informou intervalo de datas nem busca, restringe os finalizados ao mês vigente
    # (ver _apply_finalized_month_window). Numa busca por placa/O.S. o usuário procura
    # um carro específico (pode ser finalizado de mês anterior) — a janela não se aplica.
    if include_terminal and date_from is None and date_to is None and not search:
        query = _apply_finalized_month_window(query)

    items, total = await paginate(
        db,
        query,
        page=page,
        limit=limit,
        order_by=(Appointment.delivery_date.asc(), Appointment.id.asc()),
    )

    service_map = await _build_service_map(db, items)
    roll_map = await _build_roll_map(db, items)
    group_map = await _build_group_map(db, items)
    os_apps_map = await _build_os_applications_map(db, items)
    return [
        appointment_to_response(a, service_map, roll_map, group_map, os_apps_map) for a in items
    ], total


# Status "para fazer" (pendentes): tudo que ainda é acionável na operação.
# Exclui 'finalizado' e 'cancelado' — carros já feitos ou que não serão feitos.
PENDING_DISPLAY_STATUSES = ("atrasado", "atencao", "agendado", "em_execucao")


async def list_appointments_for_export(
    db: AsyncSession,
    user: User,
    store_id: int | None = None,
    department: str | None = None,
    category: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    display_statuses: list[str] | None = None,
) -> list[AppointmentResponse]:
    """
    Lista TODOS os agendamentos pendentes ("carros para fazer") que casam com os
    filtros da tela, sem paginação — base do PDF do Agendamento.

    Aplica exatamente a mesma lógica de filtros de list_appointments (loja por
    permissão, galpão, loja/depto/categoria/datas/busca) e exclui cancelados e
    finalizados. Depois filtra pelo display_status calculado, mantendo só os
    status pendentes (atrasado/atenção/agendado/em execução). Quando
    display_statuses traz um ou mais status pendentes, restringe a eles.
    """
    query = await _build_appointment_base_query(
        db,
        user,
        store_id=store_id,
        department=department,
        category=category,
        date_from=date_from,
        date_to=date_to,
        search=search,
    )

    # Só carros ainda por fazer: exclui cancelados e O.S. finalizadas.
    query = _exclude_terminal_appointments(query)

    query = query.order_by(Appointment.delivery_date.asc(), Appointment.id.asc())

    result = await db.execute(query)
    appointments = list(result.scalars().unique().all())

    service_map = await _build_service_map(db, appointments)
    roll_map = await _build_roll_map(db, appointments)
    group_map = await _build_group_map(db, appointments)
    os_apps_map = await _build_os_applications_map(db, appointments)
    responses = [
        appointment_to_response(a, service_map, roll_map, group_map, os_apps_map)
        for a in appointments
    ]

    selected = tuple(s for s in (display_statuses or []) if s in PENDING_DISPLAY_STATUSES)
    wanted = selected or PENDING_DISPLAY_STATUSES
    return [r for r in responses if r.display_status in wanted]


async def get_carros_resumo(
    db: AsyncSession,
    user: User,
    store_id: int | None = None,
    department: str | None = None,
    category: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    display_statuses: list[str] | None = None,
) -> CarrosResumoResponse:
    """
    Resumo por loja dos "carros para fazer" (contagem), com o MESMO critério e
    filtros de list_appointments_for_export — chama-a diretamente e agrega o
    resultado por loja, para não haver drift entre este resumo e o PDF/tela
    detalhados. Não usa get_store_summaries (janela do mês vigente e regra
    diferente).

    Returns:
        CarrosResumoResponse com items ordenados por store_name (alfabético)
        e total = soma dos counts (== quantidade de agendamentos filtrados).
    """
    appointments = await list_appointments_for_export(
        db=db,
        user=user,
        store_id=store_id,
        department=department,
        category=category,
        date_from=date_from,
        date_to=date_to,
        search=search,
        display_statuses=display_statuses,
    )

    counts: dict[int, dict] = {}
    for appt in appointments:
        entry = counts.setdefault(
            appt.store_id,
            {"store_name": appt.store_name or f"Loja {appt.store_id}", "count": 0},
        )
        entry["count"] += 1

    items = [
        CarrosResumoItem(store_id=sid, store_name=info["store_name"], count=info["count"])
        for sid, info in counts.items()
    ]
    items.sort(key=lambda i: i.store_name)

    return CarrosResumoResponse(items=items, total=len(appointments))


async def list_appointments_for_excel(
    db: AsyncSession,
    user: User,
    store_id: int | None = None,
    department: str | None = None,
    category: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    include_cancelled: bool = False,
    include_terminal: bool = False,
    display_statuses: list[str] | None = None,
) -> list[AppointmentResponse]:
    """
    Espelha EXATAMENTE o que a tela de Agendamentos exibe, sem paginação — base do
    Excel do HML-242. Aplica os mesmos filtros de list_appointments (loja por
    permissão, galpão, loja/depto/categoria/datas/busca) e o mesmo comportamento de
    include_cancelled/include_terminal (inclusive a janela do mês vigente para
    finalizados). Por fim, quando display_statuses é informado (seleção da legenda),
    restringe às linhas desses status — como o filtro client-side da página.
    """
    query = await _build_appointment_base_query(
        db,
        user,
        store_id=store_id,
        department=department,
        category=category,
        date_from=date_from,
        date_to=date_to,
        search=search,
    )

    # Mesmo comportamento da list: cancelados/terminais só quando pedidos. A seleção
    # de status da legenda é aplicada DEPOIS (client-side na tela), não aqui.
    if not include_cancelled:
        query = query.where(Appointment.status != "cancelled")

    if not include_terminal:
        query = _exclude_terminal_appointments(query)

    if include_terminal and date_from is None and date_to is None and not search:
        query = _apply_finalized_month_window(query)

    query = query.order_by(Appointment.delivery_date.asc(), Appointment.id.asc())

    result = await db.execute(query)
    appointments = list(result.scalars().unique().all())

    service_map = await _build_service_map(db, appointments)
    roll_map = await _build_roll_map(db, appointments)
    group_map = await _build_group_map(db, appointments)
    os_apps_map = await _build_os_applications_map(db, appointments)
    responses = [
        appointment_to_response(a, service_map, roll_map, group_map, os_apps_map)
        for a in appointments
    ]

    if display_statuses:
        wanted = set(display_statuses)
        responses = [r for r in responses if r.display_status in wanted]
    return responses


async def _build_excel_os_extras(
    db: AsyncSession, appointments: list[AppointmentResponse]
) -> dict[int, dict]:
    """
    {service_order_id: {"value": Decimal, "installers": [nomes]}} das O.S. FINALIZADAS.

    Valor (Σ unit_price × quantity) e Instalador (workers) são dados de finalização —
    só existem para O.S. concluídas. O.S. em andamento não entra no mapa (colunas
    ficam vazias no Excel, igual ao modelo).
    """
    from app.modules.service_orders.models import ServiceOrder, ServiceOrderWorker

    os_ids = [a.service_order_id for a in appointments if a.service_order_id]
    if not os_ids:
        return {}

    result = await db.execute(
        select(ServiceOrder)
        .where(
            ServiceOrder.id.in_(os_ids),
            ServiceOrder.status == OSStatus.COMPLETED.value,
        )
        .options(
            selectinload(ServiceOrder.items),
            selectinload(ServiceOrder.workers).selectinload(ServiceOrderWorker.employee),
        )
    )
    extras: dict[int, dict] = {}
    for so in result.scalars():
        value = sum(((it.unit_price or 0) * (it.quantity or 1)) for it in so.items)
        installers = [w.employee_name for w in so.workers if w.employee_name]
        extras[so.id] = {"value": value, "installers": installers}
    return extras


async def _build_excel_last_changes(
    db: AsyncSession, appointments: list[AppointmentResponse]
) -> dict[int, tuple[datetime, int | None]]:
    """{appointment_id: (data, user_id)} da última edição (audit_logs action='update')."""
    from app.core.audit import AuditLog

    ids = [a.id for a in appointments]
    if not ids:
        return {}

    result = await db.execute(
        select(AuditLog.resource_id, AuditLog.created_at, AuditLog.user_id)
        .where(
            AuditLog.resource_type == "appointment",
            AuditLog.resource_id.in_(ids),
            AuditLog.action == "update",
        )
        .order_by(AuditLog.resource_id, AuditLog.created_at.desc())
    )
    changes: dict[int, tuple[datetime, int | None]] = {}
    for row in result.all():
        # Ordenado por data desc: a primeira ocorrência de cada agendamento é a mais recente.
        if row.resource_id not in changes:
            changes[row.resource_id] = (row.created_at, row.user_id)
    return changes


async def _build_excel_user_names(
    db: AsyncSession,
    appointments: list[AppointmentResponse],
    last_changes: dict[int, tuple[datetime, int | None]],
) -> dict[int, str]:
    """{user_id: full_name} dos responsáveis por cadastro e alteração."""
    from app.modules.auth.models import User as UserModel

    ids: set[int] = {a.created_by_id for a in appointments if a.created_by_id}
    for _dt, uid in last_changes.values():
        if uid:
            ids.add(uid)
    if not ids:
        return {}

    result = await db.execute(
        select(UserModel.id, UserModel.full_name).where(UserModel.id.in_(ids))
    )
    return {row.id: row.full_name for row in result.all()}


async def collect_scheduling_excel_matrix(
    db: AsyncSession,
    user: User,
    store_id: int | None = None,
    department: str | None = None,
    category: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    search: str | None = None,
    include_cancelled: bool = False,
    include_terminal: bool = False,
    display_statuses: list[str] | None = None,
) -> list[list]:
    """Orquestra a matriz (linhas × 21 colunas) do Excel do Agendamento."""
    from app.modules.scheduling.excel import build_scheduling_excel_matrix

    appointments = await list_appointments_for_excel(
        db=db,
        user=user,
        store_id=store_id,
        department=department,
        category=category,
        date_from=date_from,
        date_to=date_to,
        search=search,
        include_cancelled=include_cancelled,
        include_terminal=include_terminal,
        display_statuses=display_statuses,
    )
    os_extras = await _build_excel_os_extras(db, appointments)
    last_changes = await _build_excel_last_changes(db, appointments)
    user_names = await _build_excel_user_names(db, appointments, last_changes)
    return build_scheduling_excel_matrix(appointments, os_extras, user_names, last_changes)


async def _resolve_consultant_name(db: AsyncSession, consultant_id: int | None) -> str | None:
    """Nome do consultor no momento do agendamento (preservado se ele for excluído)."""
    if consultant_id is None:
        return None
    from app.modules.consultants.models import Consultant

    consultant_result = await db.execute(select(Consultant).where(Consultant.id == consultant_id))
    consultant = consultant_result.scalar_one_or_none()
    return consultant.name if consultant is not None else None


async def _resolve_return_origin_id(
    db: AsyncSession,
    *,
    is_return: bool,
    original_id: int | None,
    plate: str | None,
    user: User,
    store_id: int | None = None,
    department: str | None = None,
) -> int | None:
    """Resolve a O.S. de origem de um retorno.

    Valida o id informado contra as lojas da mesma MARCA de `store_id` (a origem
    pode ter sido aberta em outra concessionária da marca); descarta se
    inacessível/inexistente. Quando ausente, faz fallback pela placa (última O.S.
    finalizada, não-retorno, na marca). Quando `department` é informado, o fallback
    é ESTRITO por departamento (não vincula a O.S. de outro departamento). Retorna
    None quando não é retorno ou nada resolve.
    """
    if not is_return:
        return None
    from app.modules.service_orders.models import ServiceOrder
    from app.modules.service_orders.service import (
        get_same_brand_store_ids,
        suggest_return_origin,
    )

    if original_id is not None:
        brand_store_ids = await get_same_brand_store_ids(db, store_id)
        q = select(ServiceOrder.id).where(ServiceOrder.id == original_id)
        if brand_store_ids is not None:
            q = q.where(ServiceOrder.store_id.in_(brand_store_ids))
        else:
            q = apply_store_filter(q, user, ServiceOrder.store_id)
        if (await db.execute(q)).scalar_one_or_none() is not None:
            return original_id
    if plate:
        suggested = await suggest_return_origin(
            db, plate, user, store_id=store_id, department=department
        )
        if suggested is not None:
            return suggested.id
    return None


def _appointment_from_create(
    data: AppointmentCreate,
    consultant_name: str | None,
    user: User,
    group_id: str | None = None,
    original_service_order_id: int | None = None,
) -> Appointment:
    """Constrói o Appointment (sem persistir) a partir do payload de criação."""
    return Appointment(
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
        original_service_order_id=original_service_order_id,
        film_type_id=data.film_type_id,
        film_tonality=data.film_tonality,
        status="scheduled",
        created_by_id=user.id,
        appointment_group_id=group_id,
    )


async def create_appointment(
    db: AsyncSession, data: AppointmentCreate, user: User
) -> AppointmentResponse:
    """
    Cria um novo agendamento.

    - Verifica que a loja existe.
    - Preserva consultant_name se consultant_id for fornecido.
    """
    from app.modules.stores.models import Store

    _validate_film_tonalities(data.department, data.film_entries)
    await _validate_services_department(
        db, data.department, _collect_service_ids(data.service_ids, data.film_entries)
    )

    # Verifica que a loja existe
    store_result = await db.execute(select(Store).where(Store.id == data.store_id))
    store = store_result.scalar_one_or_none()
    if store is None:
        raise NotFoundError(resource="Loja")

    # Escopo de loja: só cria agendamento em loja à qual o usuário tem acesso
    require_resource_access(user, data.store_id, "Agendamento")
    # Escopo de departamento: respeita a restrição de departamentos do perfil
    _assert_can_schedule_department(user, data.store_id, data.department)

    consultant_name = await _resolve_consultant_name(db, data.consultant_id)

    origin_id = await _resolve_return_origin_id(
        db,
        is_return=data.is_return,
        original_id=data.original_service_order_id,
        plate=data.vehicle_plate,
        user=user,
        store_id=data.store_id,
        department=data.department,
    )

    # Retorno sem origem definitiva (nem informada, nem resolvida por placa/marca):
    # mesma trava do create_service_order — só Owner, e só com observação.
    # O Appointment tem campo `notes` próprio, então a exigência já vale aqui
    # (não fica só para o momento de Gerar O.S.).
    from app.modules.service_orders.service import validate_return_without_origin

    validate_return_without_origin(
        is_return=bool(data.is_return),
        original_service_order_id=origin_id,
        user=user,
        notes=data.notes,
    )

    appt = _appointment_from_create(
        data, consultant_name, user, original_service_order_id=origin_id
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
        appt,
        await _build_service_map(db, [appt]),
        await _build_roll_map(db, [appt]),
        await _build_group_map(db, [appt]),
        await _build_os_applications_map(db, [appt]),
    )


async def create_combined_appointments(
    db: AsyncSession, data: CombinedAppointmentCreate, user: User
) -> list[AppointmentResponse]:
    """
    Cria um agendamento POR departamento (mesmo carro), vinculados por
    appointment_group_id. Transacional: qualquer erro de validação aborta o
    conjunto inteiro (nada é criado). Cada irmão segue o fluxo normal depois
    (gerar O.S., finalizar, cancelar) de forma independente — a regra de
    O.S./Fechamento por departamento é satisfeita por construção.
    """
    from app.modules.stores.models import Store

    # Valida a loja uma vez
    store_result = await db.execute(select(Store).where(Store.id == data.store_id))
    store = store_result.scalar_one_or_none()
    if store is None:
        raise NotFoundError(resource="Loja")

    # Escopo de loja: só cria agendamento em loja à qual o usuário tem acesso
    require_resource_access(user, data.store_id, "Agendamento")

    # Valida cada departamento ANTES de criar qualquer agendamento
    for entry in data.departments:
        # Escopo de departamento: respeita a restrição de departamentos do perfil
        _assert_can_schedule_department(user, data.store_id, entry.department)
        if not entry.service_ids and not entry.film_entries:
            dept_label = DEPARTMENT_LABELS.get(entry.department, entry.department)
            raise ValidationError(f"Adicione ao menos um serviço em {dept_label}")
        _validate_film_tonalities(entry.department, entry.film_entries)
        await _validate_services_department(
            db, entry.department, _collect_service_ids(entry.service_ids, entry.film_entries)
        )

    consultant_name = await _resolve_consultant_name(db, data.consultant_id)
    group_id = str(uuid4()) if len(data.departments) > 1 else None

    common = data.model_dump(exclude={"departments"})
    appointments: list[Appointment] = []
    for entry in data.departments:
        appt_data = AppointmentCreate(
            **common,
            department=entry.department,
            service_ids=entry.service_ids,
            film_entries=entry.film_entries,
            film_type_id=entry.film_type_id,
        )
        appt = _appointment_from_create(appt_data, consultant_name, user, group_id=group_id)
        db.add(appt)
        appointments.append(appt)

    await db.flush()

    for appt in appointments:
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
                "appointment_group_id": group_id,
            },
        )

    # Um único commit: tudo ou nada
    await db.commit()

    # Recarrega todos os agendamentos numa ÚNICA query (evita N+1), preservando a ordem.
    _ids = [appt.id for appt in appointments]
    _rows = (
        (
            await db.execute(
                select(Appointment).where(Appointment.id.in_(_ids)).options(*_load_options())
            )
        )
        .scalars()
        .all()
    )
    _by_id = {a.id: a for a in _rows}
    reloaded = [_by_id[i] for i in _ids if i in _by_id]

    # Notificações/WS best-effort (após o commit, como no create simples)
    for appt in reloaded:
        try:
            await _notify_appointment_created(db, appt)
        except Exception:
            pass
        try:
            await ws_manager.send_to_store(
                appt.store_id,
                "appointment_created",
                {
                    "id": appt.id,
                    "store_id": appt.store_id,
                    "delivery_date": str(appt.delivery_date),
                },
            )
        except Exception:
            pass

    service_map = await _build_service_map(db, reloaded)
    roll_map = await _build_roll_map(db, reloaded)
    group_map = await _build_group_map(db, reloaded)
    os_apps_map = await _build_os_applications_map(db, reloaded)
    return [
        appointment_to_response(a, service_map, roll_map, group_map, os_apps_map) for a in reloaded
    ]


async def add_departments_to_appointment(
    db: AsyncSession,
    appointment_id: int,
    departments: list[CombinedDepartmentEntry],
    user: User,
) -> list[AppointmentResponse]:
    """
    Adiciona departamentos-irmãos a um agendamento existente (combinar na
    edição). Cria 1 agendamento por departamento novo, herdando os dados do
    veículo/entrega do agendamento base e vinculando todos por
    appointment_group_id (gerado se o base ainda era avulso). Transacional:
    qualquer erro de validação aborta o conjunto (nada é criado).
    """
    base = await get_appointment(db, appointment_id, user)

    if base.status == "cancelled":
        raise ValidationError("Não é possível combinar um agendamento cancelado")
    if base.service_order_id is not None:
        raise ValidationError("Não é possível combinar um agendamento com OS gerada")

    # Departamentos já presentes no grupo (base + irmãos ativos)
    group_id = base.appointment_group_id
    if group_id:
        existing_result = await db.execute(
            select(Appointment.department).where(
                Appointment.appointment_group_id == group_id,
                Appointment.status != "cancelled",
            )
        )
        existing_depts = set(existing_result.scalars().all())
    else:
        existing_depts = {base.department}

    # Valida TODOS os departamentos novos antes de criar qualquer um
    for entry in departments:
        dept_label = DEPARTMENT_LABELS.get(entry.department, entry.department)
        if entry.department in existing_depts:
            raise ValidationError(f"O departamento {dept_label} já existe neste agendamento")
        if not entry.service_ids and not entry.film_entries:
            raise ValidationError(f"Adicione ao menos um serviço em {dept_label}")
        _validate_film_tonalities(entry.department, entry.film_entries)
        await _validate_services_department(
            db, entry.department, _collect_service_ids(entry.service_ids, entry.film_entries)
        )

    # Garante group_id (cria e atribui ao base se era avulso)
    if not group_id:
        group_id = str(uuid4())
        base.appointment_group_id = group_id

    created: list[Appointment] = []
    for entry in departments:
        appt = Appointment(
            store_id=base.store_id,
            department=entry.department,
            delivery_date=base.delivery_date,
            delivery_time=base.delivery_time,
            external_os_number=base.external_os_number,
            vehicle_plate=base.vehicle_plate,
            vehicle_model=base.vehicle_model,
            vehicle_color=base.vehicle_color,
            consultant_id=base.consultant_id,
            consultant_name=base.consultant_name,
            service_ids=entry.service_ids or None,
            film_entries=(
                [e.model_dump() for e in entry.film_entries] if entry.film_entries else None
            ),
            notes=base.notes,
            is_galpon=base.is_galpon,
            is_courtesy=base.is_courtesy,
            is_return=base.is_return,
            # Irmão de OUTRO departamento não herda a origem do base (seria um
            # vínculo cross-departamento). Fica None e resolve a própria origem,
            # estrita por departamento, no Gerar O.S. (create_service_order).
            original_service_order_id=None,
            film_type_id=entry.film_type_id,
            status="scheduled",
            created_by_id=user.id,
            appointment_group_id=group_id,
        )
        db.add(appt)
        created.append(appt)

    await db.flush()

    for appt in created:
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
                "appointment_group_id": group_id,
                "combined_from": base.id,
            },
        )

    # Um único commit: tudo ou nada
    await db.commit()

    # Recarrega todos numa ÚNICA query (evita N+1), preservando a ordem.
    _ids = [appt.id for appt in created]
    _rows = (
        (
            await db.execute(
                select(Appointment).where(Appointment.id.in_(_ids)).options(*_load_options())
            )
        )
        .scalars()
        .all()
    )
    _by_id = {a.id: a for a in _rows}
    reloaded = [_by_id[i] for i in _ids if i in _by_id]

    # Notificações/WS best-effort (após o commit, como no create combinado)
    for appt in reloaded:
        try:
            await _notify_appointment_created(db, appt)
        except Exception:
            pass
        try:
            await ws_manager.send_to_store(
                appt.store_id,
                "appointment_created",
                {
                    "id": appt.id,
                    "store_id": appt.store_id,
                    "delivery_date": str(appt.delivery_date),
                },
            )
        except Exception:
            pass

    service_map = await _build_service_map(db, reloaded)
    roll_map = await _build_roll_map(db, reloaded)
    group_map = await _build_group_map(db, reloaded)
    os_apps_map = await _build_os_applications_map(db, reloaded)
    return [
        appointment_to_response(a, service_map, roll_map, group_map, os_apps_map) for a in reloaded
    ]


async def update_appointment(
    db: AsyncSession, appointment_id: int, data: AppointmentUpdate, user: User
) -> AppointmentResponse:
    """
    Atualiza um agendamento existente.

    Quando há O.S. vinculada em status não-terminal (waiting/in_progress/duplicate/
    wrong) a edição é permitida e os itens/dados da O.S. são ressincronizados.
    O.S. já finalizada (completed) ou cancelada bloqueia a edição.

    Raises:
        ValidationError: Se o agendamento estiver cancelado ou a O.S. vinculada
            já estiver finalizada/cancelada ou tiver bobina atribuída.
        NotFoundError: Se o agendamento não existir ou usuário sem acesso.
    """
    appt = await get_appointment(db, appointment_id, user)

    if appt.status == "cancelled":
        raise ValidationError("Não é possível editar um agendamento cancelado")

    # Se há O.S. vinculada, verificar se é terminal ou não
    linked_os = None
    if appt.service_order_id is not None:
        from app.modules.service_orders.models import ServiceOrder

        os_result = await db.execute(
            select(ServiceOrder)
            .options(
                selectinload(ServiceOrder.items),
            )
            .where(ServiceOrder.id == appt.service_order_id)
        )
        linked_os = os_result.scalar_one_or_none()

        if linked_os is not None and linked_os.status in (
            OSStatus.COMPLETED.value,
            OSStatus.CANCELLED.value,
        ):
            raise ValidationError(
                "Não é possível editar: a O.S. vinculada já está finalizada/cancelada"
            )

    update_data = data.model_dump(exclude_unset=True)

    # Mudança de loja exige acesso à loja de destino (paridade com
    # update_service_order): além de proteger o próprio agendamento, `store_id` é a
    # base da MARCA usada para validar a O.S. de origem logo abaixo — não pode ser um
    # valor controlado pelo cliente sem verificação (evita burlar o escopo de acesso).
    if "store_id" in update_data and update_data["store_id"] != appt.store_id:
        require_resource_access(user, update_data["store_id"], "Agendamento")

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

    # Tonalidade obrigatória por película quando as entradas são alteradas
    # (não bloqueia edições de outros campos em agendamentos legados sem tonalidade)
    if update_data.get("film_entries") is not None:
        _validate_film_tonalities(
            update_data.get("department") or appt.department, update_data["film_entries"]
        )

    # Serialize film_entries list[FilmEntryItem] → list[dict] for JSON storage
    if "film_entries" in update_data and update_data["film_entries"] is not None:
        from app.modules.scheduling.schemas import FilmEntryItem as _FilmEntryItem

        raw = update_data["film_entries"]
        update_data["film_entries"] = [
            e.model_dump() if isinstance(e, _FilmEntryItem) else e for e in raw
        ]

    # Valida o estado FINAL do agendamento (payload mesclado com os valores atuais):
    # bloqueia salvar com serviços de outro departamento, inclusive em legados mistos.
    effective_department = update_data.get("department", appt.department)
    effective_service_ids = _collect_service_ids(
        update_data["service_ids"] if "service_ids" in update_data else appt.service_ids,
        update_data["film_entries"] if "film_entries" in update_data else appt.film_entries,
    )
    await _validate_services_department(db, effective_department, effective_service_ids)

    # Valida escopo de original_service_order_id na edição (paridade com a O.S.):
    # a origem precisa ser da mesma MARCA da loja do agendamento (a origem pode
    # estar em outra concessionária da marca). Descarta se não resolver.
    if (
        "original_service_order_id" in update_data
        and update_data["original_service_order_id"] is not None
    ):
        from app.modules.service_orders.models import ServiceOrder as _ServiceOrder
        from app.modules.service_orders.service import get_same_brand_store_ids

        _upd_store_id = update_data.get("store_id", appt.store_id)
        _brand_ids = await get_same_brand_store_ids(db, _upd_store_id)
        _oq = select(_ServiceOrder.id).where(
            _ServiceOrder.id == update_data["original_service_order_id"]
        )
        if _brand_ids is not None:
            _oq = _oq.where(_ServiceOrder.store_id.in_(_brand_ids))
        else:
            _oq = apply_store_filter(_oq, user, _ServiceOrder.store_id)
        if (await db.execute(_oq)).scalar_one_or_none() is None:
            update_data["original_service_order_id"] = None

    # Retorno sem origem definitiva no estado FINAL da edição do agendamento:
    # mesma trava do create_appointment/create_service_order. Sem isto, editar um
    # agendamento já existente (ex.: marcar is_return=True sem origem) burlaria a
    # regra e ainda propagaria para a O.S. vinculada via setattr direto abaixo.
    from app.modules.service_orders.service import validate_return_without_origin

    _final_is_return = update_data.get("is_return", appt.is_return)
    _final_original_id = update_data.get(
        "original_service_order_id", appt.original_service_order_id
    )
    _final_notes = update_data.get("notes", appt.notes)
    validate_return_without_origin(
        is_return=bool(_final_is_return),
        original_service_order_id=_final_original_id,
        user=user,
        notes=_final_notes,
    )

    old_value = {field: getattr(appt, field, None) for field in update_data}

    for field, value in update_data.items():
        setattr(appt, field, value)

    # Resincronizar itens da O.S. vinculada quando a edição envolve serviços/filmes
    # e a O.S. ainda está em estado editável (não-terminal).
    if linked_os is not None:
        from app.modules.inventory.models import FilmConsumption
        from app.modules.service_orders.models import ServiceOrderItem as _ServiceOrderItem
        from app.modules.service_orders.models import StatusHistory as _StatusHistory
        from app.modules.service_orders.schemas import ServiceOrderItemCreate as _SOItemCreate
        from app.modules.services.models import Service as _Service

        # SAFETY: rejeitar se qualquer item já tem bobina atribuída OU há consumo registrado
        item_ids = [it.id for it in linked_os.items]
        has_roll = any(it.film_roll_id is not None for it in linked_os.items)
        has_consumption = False
        if item_ids and not has_roll:
            consumption_result = await db.execute(
                select(FilmConsumption)
                .where(FilmConsumption.service_order_item_id.in_(item_ids))
                .limit(1)
            )
            has_consumption = consumption_result.scalar_one_or_none() is not None

        if has_roll or has_consumption:
            raise ValidationError(
                "Não é possível editar os serviços: a O.S. já teve bobina atribuída/consumida. "
                "Edite pela O.S. ou cancele e refaça."
            )

        # Recriar itens usando o estado FINAL do agendamento (após aplicar update_data)
        new_item_dicts = _build_os_items_from_appointment(appt)

        # Deletar itens atuais e recriar
        for old_item in list(linked_os.items):
            await db.delete(old_item)
        await db.flush()

        for item_dict in new_item_dicts:
            item_schema = _SOItemCreate(**item_dict)
            service_result = await db.execute(
                select(_Service).where(_Service.id == item_schema.service_id)
            )
            service = service_result.scalar_one_or_none()
            if service is None:
                continue
            new_item = _ServiceOrderItem(
                service_order_id=linked_os.id,
                service_id=item_schema.service_id,
                quantity=item_schema.quantity,
                unit_price=(
                    item_schema.unit_price
                    if (service.has_variable_price and item_schema.unit_price is not None)
                    else service.base_price
                ),
                tonality=item_schema.tonality,
                roll_code=None,
                film_roll_id=None,
                film_type_id=item_schema.film_type_id,
                film_applications=(
                    [
                        a.model_dump() if hasattr(a, "model_dump") else a
                        for a in (item_schema.film_applications or [])
                    ]
                    if item_schema.film_applications
                    else None
                ),
                notes=item_schema.notes,
            )
            db.add(new_item)

        # Atualizar campos escalares da O.S. a partir do agendamento
        consultant_name_for_os: str | None = None
        effective_consultant_id = appt.consultant_id
        if effective_consultant_id is not None:
            from app.modules.consultants.models import Consultant as _Consultant

            c_result = await db.execute(
                select(_Consultant).where(_Consultant.id == effective_consultant_id)
            )
            c = c_result.scalar_one_or_none()
            consultant_name_for_os = c.name if c is not None else None

        linked_os.notes = appt.notes
        linked_os.external_os_number = appt.external_os_number
        linked_os.vehicle_model = appt.vehicle_model
        linked_os.vehicle_color = appt.vehicle_color
        linked_os.consultant_id = appt.consultant_id
        if consultant_name_for_os is not None:
            linked_os.consultant_name = consultant_name_for_os
        linked_os.service_date = appt.delivery_date
        linked_os.is_courtesy = appt.is_courtesy
        linked_os.is_return = appt.is_return
        linked_os.is_galpon = appt.is_galpon
        linked_os.department = appt.department
        linked_os.updated_by_id = user.id

        # D-02: o conteúdo da O.S. mudou por baixo (serviços/tonalidade/dados). Se
        # estava verificada, a verificação CAI — precisa reconferir antes do
        # Fechamento (mesma regra do A-01 na edição direta). A NF é preservada.
        os_desverificada = bool(linked_os.is_verified)
        if os_desverificada:
            linked_os.is_verified = False
            linked_os.verified_at = None

        # Gravar StatusHistory na O.S. para rastro de auditoria
        os_history = _StatusHistory(
            service_order_id=linked_os.id,
            from_status=linked_os.status,
            to_status=linked_os.status,
            changed_by_id=user.id,
            changed_at=datetime.now(UTC),
            notes=(
                "Serviços/dados atualizados via edição do agendamento"
                + ("; verificação revertida para reconferência" if os_desverificada else "")
            ),
        )
        db.add(os_history)

    # D-04: mantém os IRMÃOS do agendamento combinado (mesmo appointment_group_id)
    # consistentes no que é do CARRO — placa, modelo, cor e data de entrega são do
    # veículo, não do departamento. Corrigir num irmão propaga aos demais (não
    # cancelados) para o lote não ficar com dados/datas divergentes. Serviços e
    # tonalidades NÃO propagam (são por departamento).
    if appt.appointment_group_id is not None:
        _GROUP_SHARED = ["vehicle_plate", "vehicle_model", "vehicle_color", "delivery_date"]
        _group_changed = [f for f in _GROUP_SHARED if f in update_data]
        if _group_changed:
            siblings = (
                (
                    await db.execute(
                        select(Appointment).where(
                            Appointment.appointment_group_id == appt.appointment_group_id,
                            Appointment.id != appt.id,
                            Appointment.status != "cancelled",
                        )
                    )
                )
                .scalars()
                .all()
            )
            for sib in siblings:
                for f in _group_changed:
                    setattr(sib, f, getattr(appt, f))
                db.add(sib)

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
        appt,
        await _build_service_map(db, [appt]),
        await _build_roll_map(db, [appt]),
        await _build_group_map(db, [appt]),
        await _build_os_applications_map(db, [appt]),
    )


async def cancel_appointment(
    db: AsyncSession, appointment_id: int, reason: str | None, user: User
) -> AppointmentResponse:
    """
    Cancela um agendamento (não deleta do banco).

    Se houver O.S. vinculada em status não-terminal (não completed/cancelled),
    cancela a O.S. também — aproveitando a lógica de estorno de bobina de
    cancel_service_order. O.S. já completada é preservada sem alterar.

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

    # Cancelar a O.S. vinculada se ainda não estiver terminal.
    # cancel_service_order já grava StatusHistory e estorna bobina; não duplicar aqui.
    # ATOMICIDADE (I1): se cancel_service_order falhar (ex.: autorização, estorno),
    # a exceção propaga — o db.commit() abaixo nunca ocorre e a transação inteira
    # reverte via rollback pelo handler da rota. Agendamento e O.S. ficam coerentes.
    if appt.service_order_id is not None:
        from app.modules.service_orders.models import ServiceOrder as _ServiceOrder
        from app.modules.service_orders.service import (
            cancel_service_order as _cancel_service_order,
        )

        os_result = await db.execute(
            select(_ServiceOrder).where(_ServiceOrder.id == appt.service_order_id)
        )
        linked_os = os_result.scalar_one_or_none()
        if linked_os is not None and linked_os.status not in (
            OSStatus.COMPLETED.value,
            OSStatus.CANCELLED.value,
        ):
            await _cancel_service_order(
                db,
                appt.service_order_id,
                user,
                reason="Agendamento cancelado",
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
        appt,
        await _build_service_map(db, [appt]),
        await _build_roll_map(db, [appt]),
        await _build_group_map(db, [appt]),
        await _build_os_applications_map(db, [appt]),
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

    query = _apply_visibility_scopes(query, user)

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
        os_completion_time = appt.service_order.completion_time if appt.service_order else None
        ds = compute_display_status(appt, os_status, os_completion_time)
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
        elif ds == "duplicidade":
            summary.duplicidade += 1

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


def _build_os_items_from_appointment(appt: Appointment) -> list:
    """
    Constrói a lista de ServiceOrderItemCreate a partir dos dados do agendamento.

    Reutilizado tanto em generate_service_order (criação) quanto na resincronização
    de itens da O.S. ao editar um agendamento com O.S. ainda não finalizada.

    Retorna uma lista de dicts com os campos de ServiceOrderItemCreate; o import
    real de ServiceOrderItemCreate é feito pelos callers para evitar import circular.
    """
    items = []

    if appt.film_entries:
        for fe in appt.film_entries:
            items.append(
                {
                    "service_id": fe["service_id"],
                    "tonality": fe.get("tonality"),
                    "film_roll_id": None,  # deferred to finalize
                    "film_type_id": fe.get("film_type_id") or appt.film_type_id,
                    "film_applications": fe.get("applications"),
                }
            )

    film_service_ids = {fe["service_id"] for fe in (appt.film_entries or [])}
    non_film_service_ids = [sid for sid in (appt.service_ids or []) if sid not in film_service_ids]
    for sid in non_film_service_ids:
        if not any(it["service_id"] == sid for it in items):
            items.append({"service_id": sid})

    return items


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

    # D-01: trava a LINHA do agendamento (with_for_update) e revalida o vínculo sob o
    # lock — impede que duas requisições concorrentes gerem duas O.S. do mesmo
    # agendamento (a segunda bloqueia até a primeira commitar e então vê o vínculo).
    locked_service_order_id = (
        await db.execute(
            select(Appointment.service_order_id)
            .where(Appointment.id == appointment_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if locked_service_order_id is not None:
        raise ConflictError("Este agendamento já possui uma O.S. gerada")

    # Construir itens a partir do agendamento (sem film_roll_id — será atribuído no Finalizar)
    os_items: list[ServiceOrderItemCreate] = [
        ServiceOrderItemCreate(**item_dict) for item_dict in _build_os_items_from_appointment(appt)
    ]

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
        original_service_order_id=appt.original_service_order_id,
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

    # ATOMICIDADE (ALTA-4): a O.S., a mudança de status e o VÍNCULO
    # appointment.service_order_id têm de subir numa ÚNICA transação. Antes eram
    # três commits separados — uma falha entre criar a O.S. e gravar o vínculo
    # deixava uma O.S. órfã commitada e o agendamento sem vínculo, permitindo que
    # um retry gerasse uma 2ª O.S. (a causa das "O.S. fantasma/duplicadas").
    # Por isso os services encadeados rodam com commit=False.
    # skip_return_origin_guard=True: um retorno sem origem só existe aqui porque o
    # agendamento já foi validado (Owner + observação) na sua própria criação/edição
    # (create_appointment/update_appointment) — quem clica em "Gerar O.S." pode ser
    # qualquer agendador com scheduling_os:can_edit, não precisa ser Owner de novo.
    service_order = await create_service_order(
        db, os_data, user, commit=False, skip_return_origin_guard=True
    )

    # Mover para in_progress automaticamente (OS de agendamento nasce fazendo),
    # exceto se já nasceu marcada como duplicada — nesse caso preserva o status para revisão.
    if service_order.status != OSStatus.DUPLICATE.value:
        status_req = _StatusUpdateRequest(new_status=OSStatus.IN_PROGRESS)
        service_order = await _change_status(db, service_order.id, status_req, user, commit=False)

    # Vincular O.S. ao agendamento (o `appt` já está com a linha travada pelo D-01).
    service_order_id = service_order.id
    appt.service_order_id = service_order_id

    await log_audit(
        db=db,
        action="generate_os",
        resource_type="appointment",
        user_id=user.id,
        resource_id=appointment_id,
        new_value={"service_order_id": service_order_id},
    )

    # Único commit: O.S. + itens + consumo + status + vínculo + auditoria juntos.
    await db.commit()

    # Recarrega a O.S. com relacionamentos após o commit atômico.
    from app.modules.service_orders.service import get_service_order

    return await get_service_order(db, service_order_id, user)


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
    Respeita o escopo de visibilidade por perfil (loja × departamento).
    """
    from app.modules.scheduling.schemas import SchedulingStoreSummary

    is_owner = user.role == "owner"
    galpon_only = is_galpon_profile_user(user)

    conditions: list[str] = []
    params: dict = {}

    if not is_owner:
        scopes = scheduling_visibility_scopes(user)
        # scopes é lista para não-owner; vazia = sem acesso
        if not scopes:
            return []
        scope_clauses: list[str] = []
        for i, (scope_store_ids, scope_depts) in enumerate(scopes):
            sk = f"scope_stores_{i}"
            params[sk] = scope_store_ids
            if scope_depts:
                dk = f"scope_depts_{i}"
                params[dk] = scope_depts
                scope_clauses.append(f"(a.store_id = ANY(:{sk}) AND a.department = ANY(:{dk}))")
            else:
                scope_clauses.append(f"a.store_id = ANY(:{sk})")
        conditions.append("(" + " OR ".join(scope_clauses) + ")")

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

    # Espelha compute_display_status: 'wrong' NÃO influencia mais o Agendamento.
    # Finalizado = O.S. terminal (completed/cancelled) OU com completion_time (foi
    # finalizada alguma vez). "Disponível" p/ os baldes por data = sem O.S. apenas.
    finalizado_sql = (
        "(COALESCE(so.status, '') IN ('completed', 'cancelled') OR so.completion_time IS NOT NULL)"
    )
    available = "(a.service_order_id IS NULL)"

    sql = text(f"""
        SELECT
            a.store_id,
            s.name AS store_name,
            COUNT(CASE WHEN a.status = 'cancelled' THEN 1 END)::int AS cancelado,
            COUNT(CASE WHEN a.status != 'cancelled' AND COALESCE(so.status, '') != 'duplicate' AND {finalizado_sql} THEN 1 END)::int AS finalizado,
            COUNT(CASE WHEN a.status != 'cancelled' AND so.status = 'duplicate' THEN 1 END)::int AS duplicidade,
            COUNT(CASE WHEN a.status != 'cancelled' AND a.service_order_id IS NOT NULL AND COALESCE(so.status, '') != 'duplicate' AND NOT {finalizado_sql} AND a.delivery_date >= CURRENT_DATE THEN 1 END)::int AS em_execucao,
            COUNT(CASE WHEN a.status != 'cancelled' AND a.delivery_date < CURRENT_DATE AND COALESCE(so.status, '') != 'duplicate' AND NOT {finalizado_sql} THEN 1 END)::int AS atrasado,
            COUNT(CASE WHEN a.status != 'cancelled' AND {available} AND a.delivery_date = CURRENT_DATE + 1 THEN 1 END)::int AS atencao,
            COUNT(CASE WHEN a.status != 'cancelled' AND {available} AND a.delivery_date >= CURRENT_DATE AND a.delivery_date != CURRENT_DATE + 1 THEN 1 END)::int AS agendado,
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
            duplicidade=row["duplicidade"],
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
