"""
Service Order service - Business logic for service order management.
"""

import asyncio
import json
from datetime import UTC, date, datetime

from fastapi import Request
from sqlalchemy import and_, case, exists, extract, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit
from app.core.exceptions import NotFoundError, ValidationError
from app.core.pagination import paginate
from app.core.permissions import (
    apply_store_filter,
    hide_galpon_user,
    is_galpon_profile_user,
    require_resource_access,
)
from app.modules.auth.models import User
from app.modules.consultants.service import get_consultant
from app.modules.dealerships.models import Dealership
from app.modules.scheduling.models import Appointment
from app.modules.service_orders.enums import OSStatus
from app.modules.service_orders.models import (
    ServiceOrder,
    ServiceOrderItem,
    ServiceOrderWorker,
    StatusHistory,
)
from app.modules.service_orders.schemas import (
    FinalizeOrderRequest,
    ServiceOrderCreate,
    ServiceOrderUpdate,
    StatusUpdateRequest,
)
from app.modules.service_orders.workflows import validate_transition
from app.modules.services.enums import ServiceDepartment
from app.modules.services.service import get_service
from app.modules.stores.models import Store
from app.modules.stores.service import get_store
from app.modules.vehicle_models.models import VehicleModel


async def get_service_order_by_id(db: AsyncSession, service_order_id: int) -> ServiceOrder | None:
    """Busca ordem de serviço por ID."""
    result = await db.execute(select(ServiceOrder).where(ServiceOrder.id == service_order_id))
    return result.scalar_one_or_none()


# Status que NÃO contam como duplicata (canceladas/lançadas erradas são ignoradas).
_DUPLICATE_IGNORED_STATUSES = (OSStatus.CANCELLED.value, OSStatus.WRONG.value)


async def has_duplicate_launch(
    db: AsyncSession,
    user: User,
    plate: str,
    service_date: date | None,
    service_ids: list[int],
    exclude_id: int | None = None,
    is_return: bool = False,
) -> bool:
    """
    Verifica se o lançamento atual constitui duplicidade de uma O.S. já existente.

    Critério: existe OUTRA O.S. (status válido, não cancelada/errada) com a MESMA
    Placa/Chassi + data de serviço no MESMO MÊS/ANO + ao menos UM serviço (service_id) em comum.
    Respeita o escopo de loja/galpão do usuário.

    Lançamentos marcados como retorno/retrabalho (is_return) são exceção legítima:
    por natureza repetem placa + serviço no mesmo período, então nunca são duplicidade.

    Usado na criação para decidir se a nova O.S. deve nascer com status "duplicate".
    """
    if is_return:
        return False
    plate_norm = (plate or "").upper().strip()
    target_services = set(service_ids or [])
    if not plate_norm or service_date is None or not target_services:
        return False

    query = (
        select(ServiceOrder.id)
        .join(ServiceOrderItem, ServiceOrderItem.service_order_id == ServiceOrder.id)
        .where(
            ServiceOrder.vehicle_plate == plate_norm,
            extract("year", ServiceOrder.service_date) == service_date.year,
            extract("month", ServiceOrder.service_date) == service_date.month,
            ServiceOrderItem.service_id.in_(target_services),
            ServiceOrder.status.notin_(_DUPLICATE_IGNORED_STATUSES),
        )
        .limit(1)
    )
    if exclude_id is not None:
        query = query.where(ServiceOrder.id != exclude_id)
    query = apply_store_filter(query, user, ServiceOrder.store_id)
    if is_galpon_profile_user(user):
        query = query.where(ServiceOrder.is_galpon.is_(True))
    elif hide_galpon_user(user):
        query = query.where(ServiceOrder.is_galpon.is_(False))

    result = await db.execute(query)
    return result.first() is not None


async def find_launch_duplicates(
    db: AsyncSession,
    user: User,
    plate: str,
    on_date: date,
    department: str,
    service_ids: list[int],
    is_return: bool = False,
) -> dict:
    """
    Busca O.S. e Agendamentos já existentes que constituiriam duplicidade do lançamento atual.

    Critério: mesma Placa/Chassi + data no MESMO MÊS/ANO + ao menos UM serviço em comum.
    Usado para alertar (não bloquear) no momento da criação de O.S. ou de Agendamento.

    Lançamentos de retorno/retrabalho (is_return) são exceção legítima e nunca alertam.

    Returns:
        {"service_orders": [...], "appointments": [...]} com resumos dos registros coincidentes.
    """
    if is_return:
        return {"service_orders": [], "appointments": []}
    plate_norm = plate.upper().strip()
    target_services = set(service_ids or [])
    if not plate_norm or not target_services:
        return {"service_orders": [], "appointments": []}

    # Mapa id->nome dos serviços envolvidos (para mensagens amigáveis)
    from app.modules.services.models import Service

    # ---- O.S. existentes ----
    so_query = (
        select(ServiceOrder)
        .options(selectinload(ServiceOrder.items).selectinload(ServiceOrderItem.service))
        .where(
            ServiceOrder.vehicle_plate == plate_norm,
            extract("year", ServiceOrder.service_date) == on_date.year,
            extract("month", ServiceOrder.service_date) == on_date.month,
            ServiceOrder.status.notin_(_DUPLICATE_IGNORED_STATUSES),
        )
    )
    so_query = apply_store_filter(so_query, user, ServiceOrder.store_id)
    if is_galpon_profile_user(user):
        so_query = so_query.where(ServiceOrder.is_galpon.is_(True))
    elif hide_galpon_user(user):
        so_query = so_query.where(ServiceOrder.is_galpon.is_(False))

    so_result = await db.execute(so_query)
    matched_orders: list[dict] = []
    for so in so_result.scalars().unique().all():
        so_service_ids = {item.service_id for item in so.items}
        shared = target_services & so_service_ids
        if not shared:
            continue
        matched_orders.append(
            {
                "id": so.id,
                "order_number": so.order_number,
                "vehicle_plate": so.vehicle_plate,
                "department": so.department,
                "service_date": so.service_date.isoformat() if so.service_date else None,
                "matched_services": [
                    item.service_name
                    for item in so.items
                    if item.service_id in shared and item.service_name
                ],
            }
        )

    # ---- Agendamentos existentes ----
    appt_query = select(Appointment).where(
        Appointment.vehicle_plate == plate_norm,
        extract("year", Appointment.delivery_date) == on_date.year,
        extract("month", Appointment.delivery_date) == on_date.month,
        Appointment.status != "cancelled",
    )
    appt_query = apply_store_filter(appt_query, user, Appointment.store_id)
    if is_galpon_profile_user(user):
        appt_query = appt_query.where(Appointment.is_galpon.is_(True))
    elif hide_galpon_user(user):
        appt_query = appt_query.where(Appointment.is_galpon.is_(False))

    appt_result = await db.execute(appt_query)
    appointments = list(appt_result.scalars().all())

    # Resolve nomes de serviços para os matches de agendamento
    appt_service_ids: set[int] = set()
    for appt in appointments:
        appt_service_ids.update(appt.service_ids or [])
    name_map: dict[int, str] = {}
    if appt_service_ids:
        names_result = await db.execute(
            select(Service.id, Service.name).where(Service.id.in_(appt_service_ids))
        )
        name_map = {row.id: row.name for row in names_result.all()}

    matched_appointments: list[dict] = []
    for appt in appointments:
        shared = target_services & set(appt.service_ids or [])
        if not shared:
            continue
        matched_appointments.append(
            {
                "id": appt.id,
                "vehicle_plate": appt.vehicle_plate,
                "department": appt.department,
                "delivery_date": appt.delivery_date.isoformat(),
                "service_order_id": appt.service_order_id,
                "matched_services": [name_map[sid] for sid in shared if sid in name_map],
            }
        )

    return {"service_orders": matched_orders, "appointments": matched_appointments}


def _apply_sort(query, sort_by: str | None, sort_dir: str):
    """
    Aplica ordenação dinâmica à query de O.S. com base na coluna escolhida.

    Retorna (query, order_by_tuple). Quando sort_by é None/desconhecido, mantém o
    padrão atual (entry_time desc) — preservando o comportamento de outras telas.
    Sempre adiciona ServiceOrder.id como desempate para paginação estável.
    """
    asc = str(sort_dir).lower() == "asc"

    def d(col):
        return col.asc() if asc else col.desc()

    # Loja exige join para ordenar por nome
    if sort_by == "location":
        query = query.join(Store, Store.id == ServiceOrder.store_id)
        return query, (d(Store.name), d(ServiceOrder.id))

    value_sum = (
        select(func.coalesce(func.sum(ServiceOrderItem.unit_price * ServiceOrderItem.quantity), 0))
        .where(ServiceOrderItem.service_order_id == ServiceOrder.id)
        .correlate(ServiceOrder)
        .scalar_subquery()
    )
    sort_map: dict[str, list] = {
        "service_date": [
            func.coalesce(ServiceOrder.service_date, func.date(ServiceOrder.entry_time))
        ],
        "status": [ServiceOrder.is_verified, ServiceOrder.status],
        "department": [ServiceOrder.department],
        "consultant": [ServiceOrder.consultant_name],
        "courtesy": [ServiceOrder.is_courtesy, ServiceOrder.is_return],
        "external_os_number": [ServiceOrder.external_os_number],
        "plate": [ServiceOrder.vehicle_plate],
        "model": [ServiceOrder.vehicle_model],
        "internal_notes": [ServiceOrder.internal_notes],
        "notes": [ServiceOrder.notes],
        "invoice_number": [ServiceOrder.invoice_number],
        "value": [value_sum],
        "updated_at": [ServiceOrder.updated_at],
    }

    cols = sort_map.get(sort_by)
    if not cols:
        # Padrão preservado: mais recentes primeiro
        return query, (ServiceOrder.entry_time.desc(),)

    order_by = tuple(d(c) for c in cols) + (d(ServiceOrder.id),)
    return query, order_by


async def list_service_orders(
    db: AsyncSession,
    user: User,
    store_id: int | None = None,
    store_ids: list[int] | None = None,
    status: list[OSStatus] | None = None,
    department: ServiceDepartment | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    plate: str | None = None,
    is_verified: bool | None = None,
    worker_id: int | None = None,
    include_cancelled: bool = False,
    flags: list[str] | None = None,
    is_return: bool | None = None,
    sort_by: str | None = None,
    sort_dir: str = "desc",
    page: int = 1,
    limit: int = 20,
) -> tuple[list[ServiceOrder], int]:
    """
    Lista ordens de serviço com base nas permissões do usuário.

    Args:
        db: Sessão do banco de dados
        user: Usuário que está listando
        store_id: Filtro por loja
        status: Filtro por status
        department: Filtro por departamento
        date_from: Data inicial
        date_to: Data final
        plate: Filtro por placa
        is_verified: Filtro por verificação (conferência)
        flags: Filtro OR por flags: 'courtesy', 'galpon', 'retorno'
        page: Página atual
        limit: Itens por página

    Returns:
        Tuple com lista de O.S. e total de itens
    """
    query = select(ServiceOrder).options(
        selectinload(ServiceOrder.items).selectinload(ServiceOrderItem.service),
        selectinload(ServiceOrder.consultant),
        selectinload(ServiceOrder.store),
        selectinload(ServiceOrder.dealership),
        selectinload(ServiceOrder.updated_by),
    )

    # Filtro por loja baseado em permissões
    query = apply_store_filter(query, user, ServiceOrder.store_id)

    # Perfil galpão vê apenas OS marcadas como galpão
    if is_galpon_profile_user(user):
        query = query.where(ServiceOrder.is_galpon.is_(True))
    elif hide_galpon_user(user):
        query = query.where(ServiceOrder.is_galpon.is_(False))

    # Filtros adicionais
    if store_ids:
        query = query.where(ServiceOrder.store_id.in_(store_ids))
    elif store_id is not None:
        query = query.where(ServiceOrder.store_id == store_id)

    if status:
        query = query.where(ServiceOrder.status.in_([s.value for s in status]))
    elif not include_cancelled:
        # Excluir canceladas por padrão (soft delete)
        query = query.where(ServiceOrder.status != OSStatus.CANCELLED.value)

    if department is not None:
        query = query.where(ServiceOrder.department == department.value)

    if date_from is not None:
        # Filtra por service_date quando preenchida, senão usa entry_time como fallback
        query = query.where(
            or_(
                and_(ServiceOrder.service_date.is_(None), ServiceOrder.entry_time >= date_from),
                ServiceOrder.service_date >= date_from.date(),
            )
        )

    if date_to is not None:
        date_to_eod = date_to.replace(hour=23, minute=59, second=59, microsecond=999999)
        query = query.where(
            or_(
                and_(ServiceOrder.service_date.is_(None), ServiceOrder.entry_time <= date_to_eod),
                ServiceOrder.service_date <= date_to.date(),
            )
        )

    if worker_id is not None:
        from app.modules.service_orders.models import ServiceOrderWorker

        query = query.where(
            exists().where(
                ServiceOrderWorker.service_order_id == ServiceOrder.id,
                ServiceOrderWorker.employee_id == worker_id,
            )
        )

    if plate is not None:
        query = query.where(
            or_(
                ServiceOrder.vehicle_plate.ilike(f"%{plate}%"),
                ServiceOrder.external_os_number.ilike(f"%{plate}%"),
            )
        )

    if is_verified is not None:
        query = query.where(ServiceOrder.is_verified == is_verified)

    if flags:
        flag_conditions = []
        if "courtesy" in flags:
            flag_conditions.append(ServiceOrder.is_courtesy.is_(True))
        if "galpon" in flags:
            flag_conditions.append(ServiceOrder.is_galpon.is_(True))
        if "retorno" in flags:
            flag_conditions.append(ServiceOrder.is_return.is_(True))
        if flag_conditions:
            query = query.where(or_(*flag_conditions))

    if is_return is not None:
        query = query.where(ServiceOrder.is_return == is_return)

    query, order_by = _apply_sort(query, sort_by, sort_dir)
    return await paginate(db, query, page, limit, order_by=order_by)


async def get_conference_summary(
    db: AsyncSession,
    user: User,
    store_ids: list[int] | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    plate: str | None = None,
    worker_id: int | None = None,
    include_cancelled: bool = False,
    is_courtesy: bool | None = None,
) -> list[dict]:
    """
    Retorna um resumo de O.S. da conferência agrupado por departamento.

    Para cada departamento retorna:
    - department: nome do departamento
    - total: total de O.S.
    - verified: O.S. com is_verified=True
    - waiting: O.S. com status waiting ou in_progress
    - wrong: O.S. com status wrong
    - cancelled: O.S. com status cancelled
    - percent_verified: percentual de verificadas em relação ao total

    Args:
        db: Sessão do banco de dados
        user: Usuário autenticado
        store_ids: Filtrar por múltiplas lojas
        date_from: Data inicial
        date_to: Data final
        plate: Filtrar por placa/OS externa
        worker_id: Filtrar por instalador
        include_cancelled: Incluir canceladas na contagem
        is_courtesy: Filtrar apenas cortesias (True) ou excluir cortesias (False)

    Returns:
        Lista de dicts com resumo por departamento
    """
    query = (
        select(
            ServiceOrder.department,
            func.count(ServiceOrder.id).label("total"),
            func.sum(
                case(
                    (
                        and_(
                            ServiceOrder.is_verified.is_(True),
                            ServiceOrder.status != OSStatus.CANCELLED.value,
                        ),
                        1,
                    ),
                    else_=0,
                )
            ).label("verified"),
            func.sum(
                case(
                    (
                        and_(
                            ServiceOrder.is_verified.is_(False),
                            ServiceOrder.status != OSStatus.CANCELLED.value,
                        ),
                        1,
                    ),
                    else_=0,
                )
            ).label("waiting"),
            func.sum(case((ServiceOrder.status == OSStatus.WRONG.value, 1), else_=0)).label(
                "wrong"
            ),
            func.sum(case((ServiceOrder.status == OSStatus.CANCELLED.value, 1), else_=0)).label(
                "cancelled"
            ),
        )
        .group_by(ServiceOrder.department)
        .order_by(ServiceOrder.department)
    )

    # Aplicar filtro de loja baseado em permissões
    query = apply_store_filter(query, user, ServiceOrder.store_id)

    if is_galpon_profile_user(user):
        query = query.where(ServiceOrder.is_galpon.is_(True))
    elif hide_galpon_user(user):
        query = query.where(ServiceOrder.is_galpon.is_(False))

    if store_ids:
        query = query.where(ServiceOrder.store_id.in_(store_ids))

    if not include_cancelled:
        query = query.where(ServiceOrder.status != OSStatus.CANCELLED.value)

    if date_from is not None:
        query = query.where(
            or_(
                and_(ServiceOrder.service_date.is_(None), ServiceOrder.entry_time >= date_from),
                ServiceOrder.service_date >= date_from.date(),
            )
        )

    if date_to is not None:
        date_to_eod = date_to.replace(hour=23, minute=59, second=59, microsecond=999999)
        query = query.where(
            or_(
                and_(
                    ServiceOrder.service_date.is_(None),
                    ServiceOrder.entry_time <= date_to_eod,
                ),
                ServiceOrder.service_date <= date_to.date(),
            )
        )

    if plate is not None:
        query = query.where(
            or_(
                ServiceOrder.vehicle_plate.ilike(f"%{plate}%"),
                ServiceOrder.external_os_number.ilike(f"%{plate}%"),
            )
        )

    if worker_id is not None:
        query = query.where(
            exists().where(
                ServiceOrderWorker.service_order_id == ServiceOrder.id,
                ServiceOrderWorker.employee_id == worker_id,
            )
        )

    if is_courtesy is not None:
        query = query.where(ServiceOrder.is_courtesy == is_courtesy)

    result = await db.execute(query)
    rows = result.all()

    summary = []
    for row in rows:
        total = row.total or 0
        verified = int(row.verified or 0)
        cancelled = int(row.cancelled or 0)
        non_cancelled = total - cancelled
        percent_verified = round((verified / non_cancelled) * 100, 1) if non_cancelled > 0 else 0.0
        summary.append(
            {
                "department": row.department,
                "total": total,
                "verified": verified,
                "waiting": int(row.waiting or 0),
                "wrong": int(row.wrong or 0),
                "cancelled": cancelled,
                "percent_verified": percent_verified,
            }
        )

    return summary


async def get_conference_summary_by_store(
    db: AsyncSession,
    user: User,
    store_ids: list[int] | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    plate: str | None = None,
    worker_id: int | None = None,
    include_cancelled: bool = False,
    is_courtesy: bool | None = None,
) -> list[dict]:
    """
    Resumo de O.S. da conferência agrupado por LOJA (mesmos campos do resumo por
    departamento). Aplica exatamente os mesmos filtros do resumo por departamento.

    Returns:
        Lista de dicts com: store_id, store_name, total, verified, waiting, wrong,
        cancelled, percent_verified.
    """
    query = (
        select(
            ServiceOrder.store_id,
            Store.name.label("store_name"),
            func.count(ServiceOrder.id).label("total"),
            func.sum(
                case(
                    (
                        and_(
                            ServiceOrder.is_verified.is_(True),
                            ServiceOrder.status != OSStatus.CANCELLED.value,
                        ),
                        1,
                    ),
                    else_=0,
                )
            ).label("verified"),
            func.sum(
                case(
                    (
                        and_(
                            ServiceOrder.is_verified.is_(False),
                            ServiceOrder.status != OSStatus.CANCELLED.value,
                        ),
                        1,
                    ),
                    else_=0,
                )
            ).label("waiting"),
            func.sum(case((ServiceOrder.status == OSStatus.WRONG.value, 1), else_=0)).label(
                "wrong"
            ),
            func.sum(case((ServiceOrder.status == OSStatus.CANCELLED.value, 1), else_=0)).label(
                "cancelled"
            ),
        )
        .join(Store, Store.id == ServiceOrder.store_id)
        .group_by(ServiceOrder.store_id, Store.name)
        .order_by(Store.name)
    )

    # Aplicar filtro de loja baseado em permissões
    query = apply_store_filter(query, user, ServiceOrder.store_id)

    if is_galpon_profile_user(user):
        query = query.where(ServiceOrder.is_galpon.is_(True))
    elif hide_galpon_user(user):
        query = query.where(ServiceOrder.is_galpon.is_(False))

    if store_ids:
        query = query.where(ServiceOrder.store_id.in_(store_ids))

    if not include_cancelled:
        query = query.where(ServiceOrder.status != OSStatus.CANCELLED.value)

    if date_from is not None:
        query = query.where(
            or_(
                and_(ServiceOrder.service_date.is_(None), ServiceOrder.entry_time >= date_from),
                ServiceOrder.service_date >= date_from.date(),
            )
        )

    if date_to is not None:
        date_to_eod = date_to.replace(hour=23, minute=59, second=59, microsecond=999999)
        query = query.where(
            or_(
                and_(
                    ServiceOrder.service_date.is_(None),
                    ServiceOrder.entry_time <= date_to_eod,
                ),
                ServiceOrder.service_date <= date_to.date(),
            )
        )

    if plate is not None:
        query = query.where(
            or_(
                ServiceOrder.vehicle_plate.ilike(f"%{plate}%"),
                ServiceOrder.external_os_number.ilike(f"%{plate}%"),
            )
        )

    if worker_id is not None:
        query = query.where(
            exists().where(
                ServiceOrderWorker.service_order_id == ServiceOrder.id,
                ServiceOrderWorker.employee_id == worker_id,
            )
        )

    if is_courtesy is not None:
        query = query.where(ServiceOrder.is_courtesy == is_courtesy)

    result = await db.execute(query)
    rows = result.all()

    summary = []
    for row in rows:
        total = row.total or 0
        verified = int(row.verified or 0)
        cancelled = int(row.cancelled or 0)
        non_cancelled = total - cancelled
        percent_verified = round((verified / non_cancelled) * 100, 1) if non_cancelled > 0 else 0.0
        summary.append(
            {
                "store_id": row.store_id,
                "store_name": row.store_name,
                "total": total,
                "verified": verified,
                "waiting": int(row.waiting or 0),
                "wrong": int(row.wrong or 0),
                "cancelled": cancelled,
                "percent_verified": percent_verified,
            }
        )

    return summary


async def get_service_order(db: AsyncSession, service_order_id: int, user: User) -> ServiceOrder:
    """
    Obtém uma O.S. verificando permissões do usuário.

    Args:
        db: Sessão do banco de dados
        service_order_id: ID da O.S.
        user: Usuário que está consultando

    Returns:
        ServiceOrder encontrada

    Raises:
        NotFoundError: O.S. não encontrada ou sem permissão
    """
    # Eager load relationships
    result = await db.execute(
        select(ServiceOrder)
        .options(
            selectinload(ServiceOrder.store),
            selectinload(ServiceOrder.items).selectinload(ServiceOrderItem.service),
            selectinload(ServiceOrder.workers).selectinload(ServiceOrderWorker.employee),
            selectinload(ServiceOrder.status_history),
            selectinload(ServiceOrder.updated_by),
        )
        .where(ServiceOrder.id == service_order_id)
    )
    service_order = result.scalar_one_or_none()

    if not service_order:
        raise NotFoundError(resource="Ordem de Serviço")

    # Verificar permissão de acesso
    require_resource_access(user, service_order.store_id, "Ordem de Serviço")

    return service_order


# Tarefas de broadcast em background (fire-and-forget). Mantidas em um set para não serem
# coletadas pelo GC antes de concluírem (asyncio só guarda referência fraca à task).
_bg_tasks: set[asyncio.Task] = set()


def _broadcast_bg(store_id: int, event: str, payload: dict) -> None:
    """Agenda um broadcast WebSocket sem bloquear a resposta HTTP."""
    from app.websocket.manager import manager as ws_manager

    task = asyncio.create_task(ws_manager.send_to_store(store_id, event, payload))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)


async def set_verified(
    db: AsyncSession,
    service_order_id: int,
    verified: bool,
    user: User,
    request: Request | None = None,
) -> ServiceOrder:
    """
    Marca/desmarca uma O.S. como verificada (conferência) — caminho leve e dedicado.

    Diferente do update genérico (`update_service_order`): só altera is_verified/verified_at,
    registra um histórico mínimo e dispara o broadcast WebSocket em background, deixando a
    resposta HTTP o mais rápida possível para o optimistic update do frontend.
    """
    service_order = await get_service_order(db, service_order_id, user)

    if service_order.is_verified == verified:
        return service_order  # idempotente — nada a fazer

    now = datetime.now(UTC)
    service_order.is_verified = verified
    service_order.verified_at = now if verified else None
    service_order.updated_by_id = user.id

    db.add(
        StatusHistory(
            service_order_id=service_order.id,
            from_status=service_order.status,
            to_status=service_order.status,
            changed_by_id=user.id,
            changed_at=now,
            notes="OS verificada" if verified else "Verificação revertida para Aguardando",
        )
    )

    await log_audit(
        db=db,
        action="verify" if verified else "unverify",
        resource_type="service_order",
        user_id=user.id,
        resource_id=service_order_id,
        old_value={"is_verified": not verified},
        new_value={"is_verified": verified},
        request=request,
    )

    await db.commit()

    # Recarregar com eager loading de relacionamentos: setar updated_by_id direto na FK
    # expira o relacionamento updated_by no commit; sem recarregar, o model_validate do
    # ServiceOrderDetailResponse dispara lazy-load em sessao async -> MissingGreenlet.
    # Mesmo padrao de change_status().
    service_order = await get_service_order(db, service_order_id, user)

    _broadcast_bg(
        service_order.store_id,
        "os_verified" if verified else "os_updated",
        {
            "id": service_order.id,
            "plate": service_order.vehicle_plate,
            "status": service_order.status,
            "is_verified": service_order.is_verified,
        },
    )

    return service_order


async def create_service_order(
    db: AsyncSession, data: ServiceOrderCreate, user: User, request: Request | None = None
) -> ServiceOrder:
    """
    Cria uma nova ordem de serviço.

    Args:
        db: Sessão do banco de dados
        data: Dados da nova O.S.
        user: Usuário que está criando

    Returns:
        ServiceOrder criada

    Raises:
        NotFoundError: Loja, concessionária ou serviço não encontrado
        ValidationError: Dados inválidos
    """
    # Verificar se loja existe e usuário tem acesso
    await get_store(db, data.store_id, user)

    # Validação de fotos: mínimo de 1 foto obrigatória
    if len(data.photos) < 1:
        raise ValidationError(detail="Mínimo de 1 foto obrigatória")

    # Resolve dealership_id automaticamente se não fornecido
    resolved_dealership_id = data.dealership_id
    if not resolved_dealership_id:
        result = await db.execute(
            select(Dealership).where(Dealership.store_id == data.store_id).limit(1)
        )
        dealership = result.scalar_one_or_none()
        if dealership:
            resolved_dealership_id = dealership.id
        else:
            raise ValidationError(detail="Nenhuma concessionária cadastrada para esta loja")

    # Consultor opcional — apenas resolve o nome; aplicado após criar service_order_data
    consultant_name: str | None = None
    if data.consultant_id:
        consultant = await get_consultant(db, data.consultant_id, user)
        consultant_name = consultant.name

    # Verificar se serviços existem
    for item_data in data.items:
        await get_service(db, item_data.service_id)

    # Resolver vehicle_model_id: validar que pertence à marca da loja
    resolved_vehicle_brand = data.vehicle_brand
    resolved_vehicle_model = data.vehicle_model
    if data.vehicle_model_id is not None:
        vm_result = await db.execute(
            select(VehicleModel).where(VehicleModel.id == data.vehicle_model_id)
        )
        vm = vm_result.scalar_one_or_none()
        if vm is None:
            raise ValidationError(detail="Modelo de veículo não encontrado")

        # Validar que o modelo pertence à mesma marca da loja
        store_result = await db.execute(select(Store.brand_id).where(Store.id == data.store_id))
        store_brand_id = store_result.scalar_one_or_none()
        if store_brand_id is not None and vm.brand_id != store_brand_id:
            raise ValidationError(detail="O modelo de veículo não pertence à marca desta loja")

        # Preencher texto a partir do catálogo
        resolved_vehicle_model = vm.name
        # Buscar nome da marca via relacionamento ou query simples
        from app.modules.brands.models import Brand

        brand_result = await db.execute(select(Brand.name).where(Brand.id == vm.brand_id))
        brand_name = brand_result.scalar_one_or_none()
        if brand_name:
            resolved_vehicle_brand = brand_name

    # Criar ordem de serviço
    service_order_data = data.model_dump(
        exclude={"items", "workers", "damage_map", "photos", "damage_photos"}
    )
    service_order_data["department"] = data.department.value
    service_order_data["created_by_id"] = user.id
    service_order_data["updated_by_id"] = user.id
    # Detecta duplicidade do lançamento (mesma placa/chassi + serviço em comum + mesmo mês).
    # Se duplicar uma O.S. existente, a nova nasce como "Duplicado" para revisão.
    # Retorno/retrabalho (is_return) é exceção: não dispara duplicidade.
    is_duplicate_launch = await has_duplicate_launch(
        db,
        user,
        data.vehicle_plate,
        data.service_date,
        [item.service_id for item in data.items],
        is_return=bool(data.is_return),
    )
    initial_status = OSStatus.DUPLICATE.value if is_duplicate_launch else OSStatus.WAITING.value
    service_order_data["status"] = initial_status
    service_order_data["dealership_id"] = resolved_dealership_id
    service_order_data["vehicle_brand"] = resolved_vehicle_brand
    service_order_data["vehicle_model"] = resolved_vehicle_model
    if consultant_name:
        service_order_data["consultant_name"] = consultant_name

    # Serializar damage_map e photos para JSON
    if data.damage_map:
        service_order_data["damage_map"] = json.dumps(
            [point.model_dump() for point in data.damage_map]
        )

    if data.photos:
        service_order_data["photos"] = json.dumps(data.photos)
    else:
        service_order_data["photos"] = json.dumps([])

    if data.damage_photos:
        service_order_data["damage_photos"] = json.dumps(data.damage_photos)
    else:
        service_order_data["damage_photos"] = json.dumps([])

    # Determinar se requer NF (película)
    service_order_data["requires_invoice"] = data.department == ServiceDepartment.FILM

    service_order = ServiceOrder(**service_order_data)
    db.add(service_order)
    await db.flush()

    # Criar itens
    for item_data in data.items:
        service = await get_service(db, item_data.service_id)
        item = ServiceOrderItem(
            service_order_id=service_order.id,
            service_id=item_data.service_id,
            quantity=item_data.quantity,
            unit_price=(
                item_data.unit_price
                if (service.has_variable_price and item_data.unit_price is not None)
                else service.base_price
            ),
            tonality=getattr(item_data, "tonality", None),
            roll_code=getattr(item_data, "roll_code", None),
            film_roll_id=getattr(item_data, "film_roll_id", None),
            film_type_id=getattr(item_data, "film_type_id", None),
            notes=item_data.notes,
        )
        db.add(item)
        await db.flush()

        # Descontar metros da bobina vinculada (se houver)
        if item_data.film_roll_id:
            # Buscar bobina para obter film_type_id
            from app.modules.inventory.models import FilmRoll
            from app.modules.inventory.service import consume_roll, get_meters_for_service

            roll_result = await db.execute(
                select(FilmRoll).where(FilmRoll.id == item_data.film_roll_id)
            )
            roll = roll_result.scalar_one_or_none()
            if roll:
                meters = await get_meters_for_service(db, roll.film_type_id, item_data.service_id)
                if meters:
                    await consume_roll(db, item_data.film_roll_id, item.id, meters)

    # Criar workers
    for worker_data in data.workers:
        worker = ServiceOrderWorker(
            service_order_id=service_order.id,
            employee_id=worker_data.employee_id,
        )
        db.add(worker)

    # Criar histórico inicial
    history = StatusHistory(
        service_order_id=service_order.id,
        from_status=None,
        to_status=initial_status,
        changed_by_id=user.id,
        changed_at=datetime.now(UTC),
        notes=(
            "Ordem de serviço criada (possível duplicidade detectada)"
            if is_duplicate_launch
            else "Ordem de serviço criada"
        ),
    )
    db.add(history)

    await db.flush()

    await log_audit(
        db=db,
        action="create",
        resource_type="service_order",
        user_id=user.id,
        resource_id=service_order.id,
        new_value={
            "vehicle_plate": service_order.vehicle_plate,
            "department": service_order.department,
            "store_id": service_order.store_id,
            "status": service_order.status,
        },
        request=request,
    )

    await db.commit()

    # Recarregar com eager loading de relacionamentos
    service_order = await get_service_order(db, service_order.id, user)

    # Broadcast em tempo real
    from app.websocket.manager import manager as ws_manager

    await ws_manager.send_to_store(
        service_order.store_id,
        "os_created",
        {
            "id": service_order.id,
            "plate": service_order.vehicle_plate,
            "status": service_order.status,
            "department": service_order.department,
        },
    )

    return service_order


async def update_service_order(
    db: AsyncSession,
    service_order_id: int,
    data: ServiceOrderUpdate,
    user: User,
    request: Request | None = None,
) -> ServiceOrder:
    """
    Atualiza uma ordem de serviço.

    Args:
        db: Sessão do banco de dados
        service_order_id: ID da O.S.
        data: Dados para atualização
        user: Usuário que está atualizando

    Returns:
        ServiceOrder atualizada

    Raises:
        NotFoundError: O.S. não encontrada
    """
    service_order = await get_service_order(db, service_order_id, user)

    update_data = data.model_dump(
        exclude_unset=True,
        exclude={
            "damage_map",
            "photos",
            "damage_photos",
            "workers",
            "items",
            "department",
        },
    )

    # Serializar department como valor do enum
    if data.department is not None:
        update_data["department"] = data.department.value

    # Serializar campos JSON
    if data.damage_map is not None:
        update_data["damage_map"] = json.dumps([point.model_dump() for point in data.damage_map])

    if data.photos is not None:
        update_data["photos"] = json.dumps(data.photos)

    if data.damage_photos is not None:
        update_data["damage_photos"] = json.dumps(data.damage_photos)

    # Resolver consultant_name ao atualizar consultant_id
    if "consultant_id" in update_data:
        if update_data["consultant_id"] is not None:
            consultant = await get_consultant(db, update_data["consultant_id"], user)
            update_data["consultant_name"] = consultant.name
        else:
            update_data["consultant_name"] = None

    # Resolver vehicle_model_id: popular vehicle_model e vehicle_brand a partir do catálogo
    if "vehicle_model_id" in update_data and update_data["vehicle_model_id"] is not None:
        from app.modules.brands.models import Brand

        vm_result = await db.execute(
            select(VehicleModel).where(VehicleModel.id == update_data["vehicle_model_id"])
        )
        vm = vm_result.scalar_one_or_none()
        if vm is not None:
            update_data["vehicle_model"] = vm.name
            brand_result = await db.execute(select(Brand.name).where(Brand.id == vm.brand_id))
            brand_name = brand_result.scalar_one_or_none()
            if brand_name:
                update_data["vehicle_brand"] = brand_name

    # --- Troca de loja do lançamento ---
    # Permite corrigir a loja de uma O.S. Valida acesso à nova loja e registra no histórico.
    store_change_history: str | None = None
    if "store_id" in update_data and update_data["store_id"] != service_order.store_id:
        new_store_id = update_data["store_id"]
        require_resource_access(user, new_store_id, "Ordem de Serviço")
        stores_result = await db.execute(
            select(Store.id, Store.name).where(Store.id.in_([service_order.store_id, new_store_id]))
        )
        store_names = {row.id: row.name for row in stores_result.all()}
        if new_store_id not in store_names:
            raise NotFoundError(f"Loja #{new_store_id} não encontrada")
        old_store_label = store_names.get(service_order.store_id, "—")
        new_store_label = store_names.get(new_store_id, "—")
        store_change_history = f"Loja: {old_store_label} → {new_store_label}"

    # --- Capturar valores antigos para histórico ---
    TRACKED_FIELDS = {
        "vehicle_model": "Modelo",
        "vehicle_color": "Cor",
        "vehicle_plate": "Placa/Chassi",
        "consultant_name": "Consultor",
        "department": "Departamento",
        "service_date": "Data do Serviço",
        "is_galpon": "Galpão",
    }

    def _build_roll_key(
        svc_name: str | None, roll_code: str | None, film_roll_id: int | None
    ) -> str | None:
        """Constrói chave de rastreamento incluindo roll_code E film_roll_id."""
        parts = []
        if roll_code:
            parts.append(roll_code)
        if film_roll_id:
            parts.append(f"Bobina #{film_roll_id}")
        if not parts:
            return None
        return f"{svc_name or '?'}: {' + '.join(parts)}"

    old_values = {f: getattr(service_order, f) for f in TRACKED_FIELDS}
    old_is_verified = service_order.is_verified
    service_order.updated_by_id = user.id
    old_services = sorted(
        [item.service_name for item in service_order.items if item.service_name],
    )
    old_roll_codes = sorted(
        filter(
            None,
            [
                _build_roll_key(item.service_name, item.roll_code, item.film_roll_id)
                for item in service_order.items
            ],
        )
    )

    # --- Snapshot completo para AUDITORIA: capturar TODOS os campos auditáveis ANTES da atualização ---
    _AUDIT_FIELDS = [
        "vehicle_plate",
        "vehicle_model",
        "vehicle_color",
        "vehicle_brand",
        "vehicle_model_id",
        "vehicle_year",
        "consultant_id",
        "consultant_name",
        "department",
        "store_id",
        "is_galpon",
        "is_return",
        "is_courtesy",
        "service_date",
        "external_os_number",
        "invoice_number",
        "notes",
        "internal_notes",
        "is_verified",
    ]
    old_audit_snapshot = {f: getattr(service_order, f, None) for f in _AUDIT_FIELDS}
    old_audit_workers = [{"employee_id": w.employee_id} for w in service_order.workers]
    old_audit_items = [
        {"service_id": i.service_id, "service_name": i.service_name} for i in service_order.items
    ]

    for field, value in update_data.items():
        setattr(service_order, field, value)

    # Capturar valores novos AGORA, antes de qualquer db.flush(), para garantir
    # que atributos escalares não sejam expirados pelo SQLAlchemy após operações bulk.
    new_values_for_history = {f: getattr(service_order, f) for f in TRACKED_FIELDS}
    new_is_verified_for_history = service_order.is_verified

    # Replace workers if provided
    if data.workers is not None:
        from sqlalchemy import delete as sa_delete

        await db.execute(
            sa_delete(ServiceOrderWorker).where(
                ServiceOrderWorker.service_order_id == service_order_id
            )
        )
        for worker_data in data.workers:
            worker = ServiceOrderWorker(
                service_order_id=service_order_id,
                employee_id=worker_data.employee_id,
            )
            db.add(worker)

    # Replace items if provided.
    # O consumo de bobina é calculado por DELTA (novo - anterior) por bobina, em vez de
    # re-debitar cada item a cada save. Isso evita o desconto em dobro e o erro
    # "bobina esgotada" ao re-editar/validar uma O.S. cuja bobina não mudou.
    new_services: list[str] | None = None
    new_roll_codes: list[str] | None = None
    if data.items is not None:
        from sqlalchemy import delete as sa_delete

        from app.modules.inventory.models import FilmRoll
        from app.modules.inventory.service import (
            consume_roll,
            get_meters_for_service,
            release_roll_meters,
        )

        async def _meters_for(film_roll_id: int, service_id: int) -> float:
            """Metros consumidos por uma aplicação do serviço na bobina informada."""
            roll_res = await db.execute(select(FilmRoll).where(FilmRoll.id == film_roll_id))
            roll = roll_res.scalar_one_or_none()
            if roll is None:
                return 0.0
            meters = await get_meters_for_service(db, roll.film_type_id, service_id)
            return float(meters or 0.0)

        # 1) Consumo ANTERIOR por bobina (itens atuais, antes do delete)
        old_consumption: dict[int, float] = {}
        for item in service_order.items:
            if item.film_roll_id:
                m = await _meters_for(item.film_roll_id, item.service_id)
                if m:
                    old_consumption[item.film_roll_id] = (
                        old_consumption.get(item.film_roll_id, 0.0) + m
                    )

        await db.execute(
            sa_delete(ServiceOrderItem).where(ServiceOrderItem.service_order_id == service_order_id)
        )
        new_services = []
        new_roll_code_list: list[str] = []
        new_consumption: dict[int, float] = {}
        roll_item_id: dict[int, int] = {}  # bobina -> um item_id (para auditoria do consumo)
        for item_data in data.items:
            svc = await get_service(db, item_data.service_id)
            if not svc:
                raise NotFoundError(f"Serviço #{item_data.service_id} não encontrado")
            new_services.append(svc.name)
            # Rastreia bobina: inclui roll_code E film_roll_id no mesmo key
            _frid = getattr(item_data, "film_roll_id", None)
            roll_key = _build_roll_key(svc.name, item_data.roll_code, _frid)
            if roll_key:
                new_roll_code_list.append(roll_key)
            item = ServiceOrderItem(
                service_order_id=service_order_id,
                service_id=item_data.service_id,
                quantity=item_data.quantity,
                unit_price=(
                    item_data.unit_price
                    if (svc.has_variable_price and item_data.unit_price is not None)
                    else svc.base_price
                ),
                tonality=item_data.tonality,
                roll_code=item_data.roll_code,
                film_roll_id=_frid,
                film_type_id=getattr(item_data, "film_type_id", None),
                notes=item_data.notes,
            )
            db.add(item)
            await db.flush()

            # 2) Consumo NOVO por bobina
            if _frid:
                m = await _meters_for(_frid, item_data.service_id)
                if m:
                    new_consumption[_frid] = new_consumption.get(_frid, 0.0) + m
                roll_item_id.setdefault(_frid, item.id)

        # 3) Aplicar o DELTA por bobina
        for roll_id in set(old_consumption) | set(new_consumption):
            delta = new_consumption.get(roll_id, 0.0) - old_consumption.get(roll_id, 0.0)
            if delta > 1e-9:
                await consume_roll(db, roll_id, roll_item_id.get(roll_id), delta)
            elif delta < -1e-9:
                await release_roll_meters(db, roll_id, roll_item_id.get(roll_id), -delta)
            # delta ~ 0: bobina inalterada — não consome nem valida esgotada

        new_services = sorted(new_services)
        new_roll_codes = sorted(new_roll_code_list)

        # Sync appointment vinculado ao alterar itens da O.S.
        from app.modules.scheduling.models import Appointment as AppointmentModel

        appt_result = await db.execute(
            select(AppointmentModel).where(AppointmentModel.service_order_id == service_order_id)
        )
        appt = appt_result.scalar_one_or_none()
        if appt is not None:
            appt.service_ids = [item_data.service_id for item_data in data.items]
            film_entries_new = [
                {
                    "service_id": item_data.service_id,
                    "tonality": item_data.tonality,
                    "roll_code": item_data.roll_code,
                    "film_roll_id": getattr(item_data, "film_roll_id", None),
                    "film_type_id": getattr(item_data, "film_type_id", None),
                }
                for item_data in data.items
                if item_data.tonality is not None
                or getattr(item_data, "film_type_id", None) is not None
            ]
            if film_entries_new:
                appt.film_entries = film_entries_new
                first = film_entries_new[0]
                if first.get("film_type_id"):
                    appt.film_type_id = first["film_type_id"]
                if first.get("tonality"):
                    appt.film_tonality = first["tonality"]
            db.add(appt)

    # --- Construir notas de histórico ---
    history_parts: list[str] = []

    if store_change_history is not None:
        history_parts.append(store_change_history)

    new_is_verified = new_is_verified_for_history
    if new_is_verified != old_is_verified:
        if new_is_verified:
            history_parts.append("OS marcada como Verificada")
        else:
            history_parts.append("Verificação revertida para Aguardando")

    for field, label in TRACKED_FIELDS.items():
        old_val = old_values[field]
        new_val = new_values_for_history[field]
        if isinstance(old_val, bool) or isinstance(new_val, bool):
            old_str = "Sim" if old_val else "Não"
            new_str = "Sim" if new_val else "Não"
        else:
            old_str = str(old_val) if old_val is not None else "—"
            new_str = str(new_val) if new_val is not None else "—"
        if old_str != new_str:
            history_parts.append(f"{label}: {old_str} → {new_str}")

    if new_services is not None and new_services != old_services:
        old_label = ", ".join(old_services) if old_services else "—"
        new_label = ", ".join(new_services) if new_services else "—"
        history_parts.append(f"Serviços: {old_label} → {new_label}")

    if new_roll_codes is not None and new_roll_codes != old_roll_codes:
        old_r = ", ".join(old_roll_codes) if old_roll_codes else "—"
        new_r = ", ".join(new_roll_codes) if new_roll_codes else "—"
        history_parts.append(f"Bobina: {old_r} → {new_r}")

    if history_parts:
        history = StatusHistory(
            service_order_id=service_order.id,
            from_status=None,
            to_status=service_order.status,
            changed_by_id=user.id,
            changed_at=datetime.now(UTC),
            notes="; ".join(history_parts),
        )
        db.add(history)

    await db.flush()

    # Preparar dados para auditoria
    # new_value: usa update_data (tem valores resolvidos: consultant_name, vehicle_model via DB lookup)
    # Exclui campos binários/JSON que não são úteis para exibição na tabela de diff
    _audit_new_value: dict = {
        k: v for k, v in update_data.items() if k not in ("photos", "damage_photos", "damage_map")
    }
    if data.workers is not None:
        _audit_new_value["workers"] = [w.model_dump() for w in data.workers]
    if data.items is not None:
        _audit_new_value["items"] = [{"service_id": i.service_id} for i in data.items]

    # old_value: captura os valores ANTERIORES para cada campo presente em new_value
    _audit_old_value: dict = {}
    for _key in _audit_new_value:
        if _key in old_audit_snapshot:
            _audit_old_value[_key] = old_audit_snapshot[_key]
        elif _key == "workers":
            _audit_old_value["workers"] = old_audit_workers
        elif _key == "items":
            _audit_old_value["items"] = old_audit_items

    await log_audit(
        db=db,
        action="update",
        resource_type="service_order",
        user_id=user.id,
        resource_id=service_order.id,
        old_value=_audit_old_value or None,
        new_value=_audit_new_value or None,
        request=request,
    )

    await db.commit()

    # Recarregar com eager loading de relacionamentos
    service_order = await get_service_order(db, service_order_id, user)

    # Broadcast em tempo real
    from app.websocket.manager import manager as ws_manager

    event = "os_verified" if service_order.is_verified and not old_is_verified else "os_updated"
    await ws_manager.send_to_store(
        service_order.store_id,
        event,
        {
            "id": service_order.id,
            "plate": service_order.vehicle_plate,
            "status": service_order.status,
            "is_verified": service_order.is_verified,
        },
    )

    return service_order


async def change_status(
    db: AsyncSession,
    service_order_id: int,
    data: StatusUpdateRequest,
    user: User,
    request: Request | None = None,
) -> ServiceOrder:
    """
    Muda o status de uma ordem de serviço.

    Args:
        db: Sessão do banco de dados
        service_order_id: ID da O.S.
        data: Dados da mudança de status
        user: Usuário que está mudando

    Returns:
        ServiceOrder atualizada

    Raises:
        NotFoundError: O.S. não encontrada
        ValidationError: Transição inválida ou requisitos não atendidos
    """
    service_order = await get_service_order(db, service_order_id, user)

    # Validar transição
    validate_transition(service_order.status, data.new_status.value)

    # Atualizar campos específicos do status
    old_status = service_order.status
    service_order.status = data.new_status.value
    service_order.updated_by_id = user.id

    now = datetime.now(UTC)

    if data.new_status == OSStatus.IN_PROGRESS and service_order.start_time is None:
        service_order.start_time = now

    if data.new_status == OSStatus.COMPLETED and service_order.completion_time is None:
        service_order.completion_time = now

    # Criar histórico
    history = StatusHistory(
        service_order_id=service_order.id,
        from_status=old_status,
        to_status=data.new_status.value,
        changed_by_id=user.id,
        changed_at=now,
        notes=data.notes,
    )
    db.add(history)

    await log_audit(
        db=db,
        action="status_change",
        resource_type="service_order",
        user_id=user.id,
        resource_id=service_order_id,
        old_value={"status": old_status},
        new_value={"status": data.new_status.value},
        request=request,
    )

    await db.flush()
    await db.commit()

    # Recarregar com eager loading de relacionamentos
    service_order = await get_service_order(db, service_order_id, user)

    # Broadcast em tempo real
    from app.websocket.manager import manager as ws_manager

    await ws_manager.send_to_store(
        service_order.store_id,
        "os_status_changed",
        {
            "id": service_order.id,
            "plate": service_order.vehicle_plate,
            "old_status": old_status,
            "new_status": service_order.status,
        },
    )

    return service_order


async def cancel_service_order(
    db: AsyncSession,
    service_order_id: int,
    user: User,
    reason: str | None = None,
    request: Request | None = None,
) -> ServiceOrder:
    """
    Cancela uma ordem de serviço (soft delete).

    A O.S. não é removida do banco — seu status passa para 'cancelled'.
    Ela deixa de aparecer no painel e nas listagens padrão, mas fica
    disponível para auditoria ao filtrar por status=cancelled.

    Args:
        db: Sessão do banco de dados
        service_order_id: ID da O.S.
        user: Usuário que está cancelando
        reason: Motivo do cancelamento (opcional)

    Raises:
        ValidationError: Se a O.S. já estiver cancelada
    """
    service_order = await get_service_order(db, service_order_id, user)

    if service_order.status == OSStatus.CANCELLED.value:
        raise ValidationError(detail="Ordem de serviço já está cancelada")

    old_status = service_order.status
    service_order.status = OSStatus.CANCELLED.value
    # Cancelamento é terminal e exclusivo: revoga qualquer verificação anterior
    # para não exibir o ícone de validado nem entrar no fechamento.
    service_order.is_verified = False
    service_order.verified_at = None

    history = StatusHistory(
        service_order_id=service_order.id,
        from_status=old_status,
        to_status=OSStatus.CANCELLED.value,
        changed_by_id=user.id,
        changed_at=datetime.now(UTC),
        notes=reason or "Ordem de serviço cancelada",
    )
    db.add(history)

    await db.flush()

    await log_audit(
        db=db,
        action="cancel",
        resource_type="service_order",
        user_id=user.id,
        resource_id=service_order.id,
        old_value={"status": old_status},
        new_value={"status": OSStatus.CANCELLED.value},
        request=request,
    )

    # Cancelar agendamentos vinculados que ainda estejam ativos
    linked_appts_result = await db.execute(
        select(Appointment).where(
            Appointment.service_order_id == service_order.id,
            Appointment.status.in_(["scheduled", "in_progress"]),
        )
    )
    linked_appts = linked_appts_result.scalars().all()
    for appt in linked_appts:
        appt.status = "cancelled"
        appt.cancelled_at = datetime.now(UTC)
        appt.cancellation_reason = f"O.S. #{service_order.id} cancelada"

    await db.commit()

    service_order = await get_service_order(db, service_order.id, user)

    # Broadcast em tempo real
    from app.websocket.manager import manager as ws_manager

    await ws_manager.send_to_store(
        service_order.store_id,
        "os_cancelled",
        {"id": service_order.id, "plate": service_order.vehicle_plate},
    )

    return service_order


async def get_os_history(
    db: AsyncSession,
    service_order_id: int,
    user: User,
) -> list[StatusHistory]:
    """
    Retorna o histórico de transições de status de uma OS.

    Args:
        db: Sessão do banco de dados
        service_order_id: ID da O.S.
        user: Usuário que está consultando

    Returns:
        Lista de StatusHistory ordenada por changed_at ASC

    Raises:
        NotFoundError: Se a O.S. não existir ou usuário não tiver acesso
    """
    result = await db.execute(
        select(ServiceOrder)
        .options(
            selectinload(ServiceOrder.status_history).selectinload(StatusHistory.changed_by),
            selectinload(ServiceOrder.store),
        )
        .where(ServiceOrder.id == service_order_id)
    )
    os_obj = result.scalar_one_or_none()

    if os_obj is None:
        from app.core.exceptions import NotFoundError

        raise NotFoundError(resource="ServiceOrder")

    require_resource_access(user, os_obj.store_id, "ServiceOrder")

    history = sorted(os_obj.status_history, key=lambda h: h.changed_at)
    return history


async def get_vehicle_history(
    db: AsyncSession,
    plate: str,
    user: User,
) -> list[ServiceOrder]:
    """
    Retorna todas as OSs abertas para um veículo identificado pela placa/chassi.

    Aplica filtro de loja baseado nas permissões do usuário.
    Limita a 50 registros, ordenados por entry_time DESC.

    Args:
        db: Sessão do banco de dados
        plate: Placa ou chassi do veículo (será convertido para maiúsculas)
        user: Usuário que está consultando

    Returns:
        Lista de ServiceOrder (máx. 50) ordenada por entry_time DESC
    """
    query = (
        select(ServiceOrder)
        .options(
            selectinload(ServiceOrder.items).selectinload(ServiceOrderItem.service),
            selectinload(ServiceOrder.store),
        )
        .where(ServiceOrder.vehicle_plate == plate.upper())
        .order_by(ServiceOrder.entry_time.desc())
        .limit(50)
    )

    query = apply_store_filter(query, user, ServiceOrder.store_id)

    result = await db.execute(query)
    return list(result.scalars().all())


async def finalize_service_order(
    db: AsyncSession,
    service_order_id: int,
    data: FinalizeOrderRequest,
    user: User,
) -> ServiceOrder:
    """
    Finaliza uma O.S. em andamento:
    - Atribui bobina a cada item de película
    - Adiciona workers
    - Armazena fotos da chancela
    - Muda status para completed

    Raises:
        NotFoundError: O.S. não encontrada.
        ValidationError: O.S. não está em andamento.
    """
    from sqlalchemy import delete as sa_delete

    service_order = await get_service_order(db, service_order_id, user)

    _finalizaveis = {OSStatus.IN_PROGRESS.value, OSStatus.WAITING.value}
    if service_order.status not in _finalizaveis:
        raise ValidationError("Apenas O.S. em andamento ou aguardando podem ser finalizadas")

    # Atribuir bobinas aos itens de película
    for assignment in data.film_roll_assignments:
        item_result = await db.execute(
            select(ServiceOrderItem).where(
                ServiceOrderItem.service_order_id == service_order_id,
                ServiceOrderItem.service_id == assignment.service_id,
            )
        )
        item = item_result.scalar_one_or_none()
        if item and item.film_roll_id is None:
            item.film_roll_id = assignment.film_roll_id
            # Consumir metros da bobina
            from app.modules.inventory.models import FilmRoll
            from app.modules.inventory.service import (
                compute_visual_id,
                consume_roll,
                get_meters_for_service,
            )

            roll_result = await db.execute(
                select(FilmRoll)
                .options(selectinload(FilmRoll.film_type))
                .where(FilmRoll.id == assignment.film_roll_id)
            )
            roll = roll_result.scalar_one_or_none()
            if roll:
                film_type_name = roll.film_type.name if roll.film_type else ""
                item.roll_code = compute_visual_id(
                    film_type_name, roll.tonality, roll.receipt_date, roll.total_meters
                )
                meters = await get_meters_for_service(db, roll.film_type_id, assignment.service_id)
                if meters:
                    await consume_roll(db, assignment.film_roll_id, item.id, meters)

    # Armazenar fotos da chancela
    if data.completion_photos:
        service_order.completion_photos = json.dumps(data.completion_photos)

    # Substituir workers (se fornecidos)
    if data.employee_ids:
        await db.execute(
            sa_delete(ServiceOrderWorker).where(
                ServiceOrderWorker.service_order_id == service_order_id
            )
        )
        await db.flush()
        for eid in data.employee_ids:
            worker = ServiceOrderWorker(
                service_order_id=service_order_id,
                employee_id=eid,
            )
            db.add(worker)

    # Mudar status para completed
    now = datetime.now(UTC)
    original_status = service_order.status
    service_order.status = OSStatus.COMPLETED.value
    if service_order.start_time is None:
        service_order.start_time = now
    if service_order.completion_time is None:
        service_order.completion_time = now

    history = StatusHistory(
        service_order_id=service_order_id,
        from_status=original_status,
        to_status=OSStatus.COMPLETED.value,
        changed_by_id=user.id,
        changed_at=now,
    )
    db.add(history)

    await db.flush()
    await db.commit()

    service_order = await get_service_order(db, service_order_id, user)

    # Broadcast em tempo real
    from app.websocket.manager import manager as ws_manager

    await ws_manager.send_to_store(
        service_order.store_id,
        "os_finalized",
        {
            "id": service_order.id,
            "plate": service_order.vehicle_plate,
            "status": service_order.status,
        },
    )

    return service_order
