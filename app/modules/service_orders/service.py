"""
Service Order service - Business logic for service order management.
"""

import asyncio
import json
import logging
from datetime import UTC, date, datetime

from fastapi import Request
from sqlalchemy import and_, case, exists, extract, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit
from app.core.exceptions import AuthorizationError, NotFoundError, ValidationError
from app.core.media_url import validate_internal_media_url
from app.core.pagination import paginate
from app.core.permissions import (
    apply_store_filter,
    get_access_profile_permission,
    hide_galpon_user,
    is_galpon_profile_user,
    is_owner,
    require_resource_access,
)
from app.core.validators import normalize_tonality
from app.modules.auth.models import User
from app.modules.consultants.service import get_consultant
from app.modules.dealerships.models import Dealership
from app.modules.scheduling.models import Appointment
from app.modules.service_orders.enums import ConferenceStatus, OSStatus
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

# Departamentos que exigem número da NF para poder ser verificados na Conferência.
INVOICE_REQUIRED_DEPARTMENTS = (
    ServiceDepartment.FILM.value,
    ServiceDepartment.SECURITY_FILM.value,
    ServiceDepartment.PPF.value,
)


def _require_invoice_to_verify(department: str | None, invoice_number: str | None) -> None:
    """
    Bloqueia a verificação de O.S. de Película/PPF/Película de Segurança sem NF.

    Levanta ValidationError quando o departamento exige NF e o número não está
    preenchido. Usado tanto na verificação rápida (`set_verified`) quanto na
    verificação via edição (`update_service_order`).
    """
    if department in INVOICE_REQUIRED_DEPARTMENTS and not (invoice_number or "").strip():
        raise ValidationError(
            detail="Informe o número da NF para verificar O.S. de Película, PPF ou Película de Segurança."
        )


def service_ids_condition(service_ids: list[int]):
    """O.S. que tenha ao menos um item com service_id na lista."""
    return ServiceOrder.items.any(ServiceOrderItem.service_id.in_(service_ids))


def conference_status_condition(statuses: list[ConferenceStatus]):
    """
    OR das condições do filtro multi de status da Conferência.

    Reproduz a semântica do antigo filtro single: 'pending' inclui wrong/duplicate
    não verificadas; 'pending'/'verified' excluem canceladas.
    """
    conds = []
    for s in statuses:
        if s == ConferenceStatus.PENDING:
            conds.append(
                and_(
                    ServiceOrder.is_verified.is_(False),
                    ServiceOrder.status != OSStatus.CANCELLED.value,
                )
            )
        elif s == ConferenceStatus.VERIFIED:
            conds.append(
                and_(
                    ServiceOrder.is_verified.is_(True),
                    ServiceOrder.status != OSStatus.CANCELLED.value,
                )
            )
        else:  # cancelled / wrong / duplicate
            conds.append(ServiceOrder.status == s.value)
    return or_(*conds) if conds else None


def build_conference_export_query(
    user: User,
    *,
    store_id: int | None = None,
    store_ids: list[int] | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    department: ServiceDepartment | None = None,
    departments: list[ServiceDepartment] | None = None,
    is_verified: bool | None = None,
    status_filter: str | None = None,
    conference_statuses: list[ConferenceStatus] | None = None,
    flag: list[str] | None = None,
    plate: str | None = None,
    service_ids: list[int] | None = None,
    worker_id: int | None = None,
):
    """
    Monta o SELECT das O.S. da Conferência aplicando EXATAMENTE os mesmos
    filtros da listagem/export da tela (loja+permissão, status de conferência,
    departamento, data com fallback service_date/entry_time, placa/OS, serviços,
    instalador e flags). Reusado pelo export de Excel e pelo export de fotos
    para que os dois nunca divirjam. Não aplica limit nem ordenação de página.
    """
    store_ids = store_ids or []
    departments = departments or []
    conference_statuses = conference_statuses or []
    flag = flag or []
    service_ids = service_ids or []

    query = select(ServiceOrder)

    query = apply_store_filter(query, user, ServiceOrder.store_id)

    # Escopo de galpão — espelha list_service_orders para o export não divergir
    # da tela (perfil galpão só vê O.S. de galpão; "ocultar galpão" nunca as vê).
    if is_galpon_profile_user(user):
        query = query.where(ServiceOrder.is_galpon.is_(True))
    elif hide_galpon_user(user):
        query = query.where(ServiceOrder.is_galpon.is_(False))

    if store_ids:
        query = query.where(ServiceOrder.store_id.in_(store_ids))
    elif store_id is not None:
        query = query.where(ServiceOrder.store_id == store_id)

    # Filtro de status — espelha a listagem da tela de conferência
    if conference_statuses:
        cond = conference_status_condition(conference_statuses)
        if cond is not None:
            query = query.where(cond)
    elif status_filter == OSStatus.CANCELLED.value:
        query = query.where(ServiceOrder.status == OSStatus.CANCELLED.value)
    elif status_filter == OSStatus.WRONG.value:
        query = query.where(ServiceOrder.status == OSStatus.WRONG.value)
    elif status_filter == OSStatus.DUPLICATE.value:
        query = query.where(ServiceOrder.status == OSStatus.DUPLICATE.value)
    elif is_verified is None:
        # "Todas" → tudo, incluindo canceladas (paridade com a listagem)
        pass
    else:
        # verified / pending
        query = query.where(ServiceOrder.is_verified == is_verified)
        query = query.where(ServiceOrder.status != OSStatus.CANCELLED.value)

    if departments:
        query = query.where(ServiceOrder.department.in_([d.value for d in departments]))
    elif department is not None:
        query = query.where(ServiceOrder.department == department.value)

    # Filtro de data: usa service_date quando preenchida, senão entry_time como fallback
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
                and_(ServiceOrder.service_date.is_(None), ServiceOrder.entry_time <= date_to_eod),
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

    if service_ids:
        query = query.where(service_ids_condition(service_ids))

    if worker_id is not None:
        query = query.where(
            exists().where(
                ServiceOrderWorker.service_order_id == ServiceOrder.id,
                ServiceOrderWorker.employee_id == worker_id,
            )
        )

    if flag:
        flag_conditions = []
        if "courtesy" in flag:
            flag_conditions.append(ServiceOrder.is_courtesy.is_(True))
        if "galpon" in flag:
            flag_conditions.append(ServiceOrder.is_galpon.is_(True))
        if "retorno" in flag:
            flag_conditions.append(ServiceOrder.is_return.is_(True))
        if flag_conditions:
            query = query.where(or_(*flag_conditions))

    query = query.order_by(
        ServiceOrder.service_date.asc().nulls_last(), ServiceOrder.entry_time.asc()
    )

    return query


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
    exclude_appointment_id: int | None = None,
    exclude_service_order_id: int | None = None,
) -> dict:
    """
    Busca O.S. e Agendamentos já existentes que constituiriam duplicidade do lançamento atual.

    Critério: mesma Placa/Chassi + data no MESMO MÊS/ANO + ao menos UM serviço em comum.
    Usado para alertar (não bloquear) no momento da criação de O.S. ou de Agendamento.

    Lançamentos de retorno/retrabalho (is_return) são exceção legítima e nunca alertam.

    exclude_appointment_id / exclude_service_order_id: ao EDITAR um agendamento (ou sua
    O.S. gerada), o próprio registro e a própria O.S. devem ser ignorados — senão o
    agendamento em edição acusaria a si mesmo como duplicidade.

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
        if exclude_service_order_id is not None and so.id == exclude_service_order_id:
            continue
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
        if exclude_appointment_id is not None and appt.id == exclude_appointment_id:
            continue
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
    departments: list[ServiceDepartment] | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    plate: str | None = None,
    service_ids: list[int] | None = None,
    conference_statuses: list[ConferenceStatus] | None = None,
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
        department: Filtro por departamento (single)
        departments: Filtro por múltiplos departamentos (tem precedência sobre department)
        date_from: Data inicial
        date_to: Data final
        plate: Filtro por placa
        service_ids: O.S. com ao menos um item nesses serviços
        conference_statuses: Filtro multi de status da conferência (OR das condições)
        is_verified: Filtro por verificação (conferência)
        flags: Filtro OR por flags: 'courtesy', 'galpon', 'retorno'
        page: Página atual
        limit: Itens por página

    Returns:
        Tuple com lista de O.S. e total de itens
    """
    query = select(ServiceOrder).options(
        selectinload(ServiceOrder.items).selectinload(ServiceOrderItem.service),
        selectinload(ServiceOrder.workers).selectinload(ServiceOrderWorker.employee),
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

    if conference_statuses:
        # OR das condições multi da conferência; decide sozinho o que entra
        # (inclusive canceladas), por isso pula o default de exclusão abaixo.
        cond = conference_status_condition(conference_statuses)
        if cond is not None:
            query = query.where(cond)
    elif status:
        query = query.where(ServiceOrder.status.in_([s.value for s in status]))
    elif not include_cancelled:
        # Excluir canceladas por padrão (soft delete)
        query = query.where(ServiceOrder.status != OSStatus.CANCELLED.value)

    if departments:
        query = query.where(ServiceOrder.department.in_([d.value for d in departments]))
    elif department is not None:
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

    if service_ids:
        query = query.where(service_ids_condition(service_ids))

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
    service_ids: list[int] | None = None,
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

    if service_ids:
        query = query.where(service_ids_condition(service_ids))

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
    service_ids: list[int] | None = None,
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

    if service_ids:
        query = query.where(service_ids_condition(service_ids))

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
                "total": non_cancelled,
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

    # Verificar permissão de acesso (loja)
    require_resource_access(user, service_order.store_id, "Ordem de Serviço")

    # MÉDIA-11: reforça o filtro de galpão TAMBÉM no acesso por-id. Sem isto, o
    # filtro de galpão só valia nas listagens e um usuário podia abrir por id uma
    # O.S. fora do seu escopo de galpão. Usa NotFoundError (não revela existência).
    if is_galpon_profile_user(user) and not service_order.is_galpon:
        raise NotFoundError(resource="Ordem de Serviço")
    if hide_galpon_user(user) and service_order.is_galpon:
        raise NotFoundError(resource="Ordem de Serviço")

    return service_order


async def get_item_linear_meters(db: AsyncSession, item_ids: list[int]) -> dict[int, float]:
    """
    Soma líquida de metros de película consumidos (FilmConsumption) por item de
    O.S. — usado SÓ no detalhe da O.S. (evita N+1 na listagem: uma única query
    agregada para todos os itens, em vez de uma por item).

    Net = consumo (+) + estorno (já negativo) + ajuste (+/-); retalho é sempre
    0m (serviço feito com sobra não debita a bobina de novo — ver
    ``record_scrap_use``). Mesma lógica de soma líquida usada no estorno de
    cancelamento (``cancel_service_order``), só que agrupada por item em vez de
    por bobina.

    Item sem NENHUM registro no extrato (serviço fora do departamento Película,
    ou película sem bobina vinculada) fica de fora do dict — o chamador trata
    como ``None``. Item feito com retalho aparece com ``0.0`` (tem registro
    ``kind='retalho'`` de 0m, mas não teve metros debitados).
    """
    from app.modules.inventory.models import FilmConsumption

    if not item_ids:
        return {}

    rows = (
        await db.execute(
            select(
                FilmConsumption.service_order_item_id,
                func.sum(FilmConsumption.meters_consumed),
            )
            .where(FilmConsumption.service_order_item_id.in_(item_ids))
            .group_by(FilmConsumption.service_order_item_id)
        )
    ).all()
    return {
        item_id: round(float(net), 2)
        for item_id, net in rows
        if item_id is not None and net is not None
    }


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

    if verified:
        _require_invoice_to_verify(service_order.department, service_order.invoice_number)

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

    # Indicadores usam is_verified p/ decidir se receita de wrong/duplicate conta
    # → marca para invalidar o cache de analytics pós-commit
    db.info["bump_analytics"] = True

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


async def _validate_service_items_domain(
    db: AsyncSession,
    department: str,
    brand_id: int | None,
    service_ids: "list[int] | set[int]",
) -> None:
    """
    Garante que os serviços da O.S. pertencem ao mesmo DEPARTAMENTO e (quando a
    marca da O.S. é conhecida) à mesma MARCA. Fecha B-01/B-03 na raiz: sem isso,
    O.S. recebia serviço de outra marca/departamento (bug O.S. 7366).

    - department: departamento final da O.S. (film, vn, workshop, ...).
    - brand_id: marca da O.S. (do modelo vinculado). None = não valida marca (O.S.
      sem modelo no catálogo — valida só o departamento).
    - service_ids: ids dos serviços que ficarão na O.S.

    Raises:
        ValidationError: serviço inexistente, de outro departamento ou de outra marca.
    """
    ids = set(service_ids)
    if not ids:
        return

    from app.modules.brands.models import Brand
    from app.modules.service_orders.daily_summary import DEPARTMENT_LABELS
    from app.modules.services.models import Service

    result = await db.execute(select(Service).where(Service.id.in_(ids)))
    services = {s.id: s for s in result.scalars()}

    missing = sorted(ids - services.keys())
    if missing:
        raise ValidationError(
            detail=f"Serviços inexistentes no catálogo: {', '.join(map(str, missing))}"
        )

    def _label(s) -> str:
        return f"{s.code} - {s.name}" if s.code else s.name

    wrong_dept = sorted(
        (s for s in services.values() if s.department != department), key=lambda s: s.name
    )
    if wrong_dept:
        dept_label = DEPARTMENT_LABELS.get(department, department)
        names = ", ".join(_label(s) for s in wrong_dept)
        raise ValidationError(
            detail=f"Os serviços a seguir não pertencem ao departamento {dept_label} da O.S.: {names}"
        )

    if brand_id is not None:
        wrong_brand = sorted(
            (s for s in services.values() if s.brand_id != brand_id), key=lambda s: s.name
        )
        if wrong_brand:
            brand_name = (
                await db.execute(select(Brand.name).where(Brand.id == brand_id))
            ).scalar_one_or_none() or f"#{brand_id}"
            names = ", ".join(_label(s) for s in wrong_brand)
            raise ValidationError(
                detail=(
                    f"Os serviços a seguir não pertencem à marca {brand_name} da O.S.: {names}. "
                    "Selecione o serviço correspondente à marca do veículo."
                )
            )


def _validate_photo_urls(urls: list[str] | None, *, field: str) -> None:
    """Recusa URLs de foto que não venham do upload do próprio sistema.

    As fotos da O.S. são exibidas em contexto de confiança (drawer, export ZIP da
    Conferência lido por `read_media_bytes`), então não podem apontar para host
    externo nem escapar do storage interno (path traversal).
    """
    for url in urls or []:
        validate_internal_media_url(url, field=field)


def validate_return_without_origin(
    *,
    is_return: bool,
    original_service_order_id: int | None,
    user: User,
    notes: str | None,
) -> None:
    """Trava o retorno SEM O.S. de origem vinculada (pós-resolução automática).

    Um retorno sem origem vinculada perde a rastreabilidade do histórico do
    carro — só o Owner pode lançar/editar esse caso, e mesmo assim precisa
    registrar o motivo na observação. Retornos COM origem (encontrada ou
    informada), cortesias e O.S. normais nunca disparam esta regra.

    Chame DEPOIS de toda a resolução automática de origem por placa/marca
    (`suggest_return_origin` / `_resolve_return_origin_id`), quando
    `original_service_order_id` já é definitivo.

    Raises:
        AuthorizationError: Usuário não é Owner (403).
        ValidationError: Observação (notes) vazia/ausente (422).
    """
    if not (is_return and original_service_order_id is None):
        return
    if not is_owner(user):
        raise AuthorizationError(
            detail="Somente o Proprietário pode lançar um retorno sem O.S. de origem vinculada."
        )
    if not notes or not notes.strip():
        raise ValidationError(
            detail="Informe a observação (motivo) ao lançar um retorno sem O.S. de origem."
        )


async def create_service_order(
    db: AsyncSession,
    data: ServiceOrderCreate,
    user: User,
    request: Request | None = None,
    commit: bool = True,
    skip_return_origin_guard: bool = False,
) -> ServiceOrder:
    """
    Cria uma nova ordem de serviço.

    Args:
        db: Sessão do banco de dados
        data: Dados da nova O.S.
        user: Usuário que está criando
        skip_return_origin_guard: Pula `validate_return_without_origin` (Owner +
            observação) para retorno sem origem. Uso EXCLUSIVO de
            `generate_service_order` (scheduling): o agendamento de origem já
            passou por essa trava na sua própria criação/edição — quem clica em
            "Gerar O.S." é só quem materializa algo que o Owner já autorizou, não
            quem decide o retorno sem origem. Não usar em nenhum outro call-site.

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

    # Resolver vehicle_model_id: validar que pertence à marca da loja
    resolved_vehicle_brand = data.vehicle_brand
    resolved_vehicle_model = data.vehicle_model
    os_brand_id: int | None = None
    if data.vehicle_model_id is not None:
        vm_result = await db.execute(
            select(VehicleModel).where(VehicleModel.id == data.vehicle_model_id)
        )
        vm = vm_result.scalar_one_or_none()
        if vm is None:
            raise ValidationError(detail="Modelo de veículo não encontrado")
        os_brand_id = vm.brand_id

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

    # B-01/B-03: valida que os serviços pertencem ao departamento e (quando há
    # modelo vinculado) à marca da O.S. — impede lançar serviço de outra marca.
    await _validate_service_items_domain(
        db, data.department.value, os_brand_id, [item.service_id for item in data.items]
    )

    # Criar ordem de serviço
    service_order_data = data.model_dump(
        exclude={
            "items",
            "workers",
            "damage_map",
            "photos",
            "damage_photos",
            "finalize_on_create",
        }
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
    # Lançamento direto já finalizado (QuickCreate de película): nasce 'completed'.
    # Duplicidade tem prioridade (nasce 'duplicate' para revisão, nunca finaliza).
    should_finalize = bool(data.finalize_on_create) and not is_duplicate_launch
    if should_finalize and not data.workers:
        raise ValidationError("Informe ao menos um instalador para lançar a O.S. já finalizada")
    # #1 (porta lateral do lançamento direto): O.S. de película comum já finalizada
    # exige bobina por serviço, para não-Owner — mesma regra do finalize_service_order.
    # Owner é isento (backlog). O QuickCreate já força a bobina no front; isto fecha o
    # bypass via API (a foto de vistoria mínima já é exigida na criação).
    if should_finalize and not is_owner(user) and data.department == "film":
        # Serviço feito com retalho não tem bobina consumida — a marcação substitui
        # a seleção da bobina (a origem do retalho é opcional).
        if any(
            not getattr(item, "film_roll_id", None) and not getattr(item, "used_scrap", False)
            for item in data.items
        ):
            raise ValidationError("Selecione uma bobina para cada serviço de película")
    if is_duplicate_launch:
        initial_status = OSStatus.DUPLICATE.value
    elif should_finalize:
        initial_status = OSStatus.COMPLETED.value
    else:
        initial_status = OSStatus.WAITING.value
    service_order_data["status"] = initial_status
    if should_finalize:
        service_order_data["completion_time"] = datetime.now(UTC)
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

    _validate_photo_urls(data.photos, field="Foto")
    _validate_photo_urls(data.damage_photos, field="Foto de avaria")

    if data.photos:
        service_order_data["photos"] = json.dumps(data.photos)
    else:
        service_order_data["photos"] = json.dumps([])

    if data.damage_photos:
        service_order_data["damage_photos"] = json.dumps(data.damage_photos)
    else:
        service_order_data["damage_photos"] = json.dumps([])

    # Determinar se requer NF (película)
    # 🟠 (auditoria): requer NF para Película, Película de Segurança E PPF — mesma
    # regra do enforcement na verificação (_require_invoice_to_verify). Antes só
    # marcava `film`, então security_film/ppf eram verificáveis sem NF.
    _dept_value = getattr(data.department, "value", data.department)
    service_order_data["requires_invoice"] = _dept_value in INVOICE_REQUIRED_DEPARTMENTS

    # Valida escopo de original_service_order_id: a O.S. referenciada precisa existir
    # e ser da mesma MARCA da loja da O.S. de retorno (a origem pode ter sido aberta
    # em outra concessionária da marca). Se não resolver, descarta o link
    # silenciosamente (evita FK IntegrityError 500 e vazamento cross-marca).
    _os_store_id = service_order_data.get("store_id")
    if service_order_data.get("original_service_order_id") is not None:
        _brand_store_ids = await get_same_brand_store_ids(db, _os_store_id)
        _origin_id = service_order_data["original_service_order_id"]
        _origin_q = select(ServiceOrder.id).where(ServiceOrder.id == _origin_id)
        if _brand_store_ids is not None:
            _origin_q = _origin_q.where(ServiceOrder.store_id.in_(_brand_store_ids))
        else:
            _origin_q = apply_store_filter(_origin_q, user, ServiceOrder.store_id)
        _origin_resolved = (await db.execute(_origin_q)).scalar_one_or_none()
        if _origin_resolved is None:
            service_order_data["original_service_order_id"] = None

    # Retorno sem origem explícita (ou descartada acima): resolve automaticamente
    # pela placa — última O.S. finalizada, não-retorno, da mesma placa, buscando
    # nas lojas da mesma marca. Robustez: o modal já exige o vínculo, mas fluxos
    # legados (generate-os de agendamentos antigos) não ficam sem histórico.
    if (
        service_order_data.get("is_return")
        and service_order_data.get("original_service_order_id") is None
        and service_order_data.get("vehicle_plate")
    ):
        _suggested = await suggest_return_origin(
            db,
            service_order_data["vehicle_plate"],
            user,
            store_id=_os_store_id,
            department=service_order_data.get("department"),
        )
        if _suggested is not None:
            service_order_data["original_service_order_id"] = _suggested.id

    # Retorno sem origem definitiva (nem informada, nem resolvida por placa/marca):
    # só o Owner pode lançar, e só com observação preenchida (motivo). Pulado
    # quando vem do generate_service_order — o agendamento de origem já passou
    # por essa trava (ver docstring de skip_return_origin_guard acima).
    if not skip_return_origin_guard:
        validate_return_without_origin(
            is_return=bool(service_order_data.get("is_return")),
            original_service_order_id=service_order_data.get("original_service_order_id"),
            user=user,
            notes=service_order_data.get("notes"),
        )

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
            used_scrap=bool(getattr(item_data, "used_scrap", False)),
            scrap_source_roll_id=getattr(item_data, "scrap_source_roll_id", None),
            film_applications=(
                [a.model_dump() for a in (item_data.film_applications or [])]
                if getattr(item_data, "film_applications", None)
                else None
            ),
            notes=item_data.notes,
        )
        db.add(item)
        await db.flush()

        # Retalho: sobra de corte anterior, já debitada da bobina na época — só
        # registra o movimento de 0m na bobina de origem, sem descontar de novo.
        if getattr(item_data, "used_scrap", False):
            scrap_roll_id = getattr(item_data, "scrap_source_roll_id", None)
            if scrap_roll_id:
                from app.modules.inventory.service import record_scrap_use

                await record_scrap_use(db, scrap_roll_id, item.id)
        # Descontar metros da bobina vinculada (se houver)
        elif item_data.film_roll_id:
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
            else (
                "Ordem de serviço lançada e finalizada"
                if should_finalize
                else "Ordem de serviço criada"
            )
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

    # Indicadores agregam O.S. criadas (receita/consumo) → marca para invalidar
    # o cache de analytics pós-commit. Marcado mesmo em commit=False: quem
    # orquestra fecha a transação e o get_db lê a flag no commit real dela.
    db.info["bump_analytics"] = True

    # commit=False: quem orquestra (ex.: generate_service_order) fecha a
    # transação num único commit atômico junto com o vínculo do agendamento.
    # O objeto já tem id/status após o flush acima.
    if not commit:
        return service_order

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

    # Cortesia e galpão são editáveis por quem tem permissão de editar a O.S.
    # (service_orders:can_edit — exigida pelo endpoint), não só pelo owner: o
    # conferente que ajusta a O.S. precisa marcar cortesia/galpão. A criação já
    # aceitava esses campos de qualquer editor; o update segue a mesma regra.

    # Serializar department como valor do enum
    if data.department is not None:
        update_data["department"] = data.department.value

    # Serializar campos JSON
    if data.damage_map is not None:
        update_data["damage_map"] = json.dumps([point.model_dump() for point in data.damage_map])

    if data.photos is not None:
        _validate_photo_urls(data.photos, field="Foto")
        update_data["photos"] = json.dumps(data.photos)

    if data.damage_photos is not None:
        _validate_photo_urls(data.damage_photos, field="Foto de avaria")
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
        "execution_notes",
        "is_verified",
    ]
    old_audit_snapshot = {f: getattr(service_order, f, None) for f in _AUDIT_FIELDS}
    old_audit_workers = [{"employee_id": w.employee_id} for w in service_order.workers]
    old_audit_items = [
        {"service_id": i.service_id, "service_name": i.service_name} for i in service_order.items
    ]

    # Bloqueia verificação sem NF em Película/PPF/Película de Segurança. Avalia o
    # estado FINAL (departamento e NF podem estar mudando na mesma edição).
    if update_data.get("is_verified") is True:
        # #2b: marcar como verificada (mesmo pelo update genérico) exige a permissão
        # da Conferência — senão o /verify blindado seria contornável por aqui.
        if not get_access_profile_permission(user, "conference", "edit"):
            raise AuthorizationError(
                detail="Sem permissão para verificar a O.S. (conference:can_edit)"
            )
        final_department = update_data.get("department", service_order.department)
        final_invoice = update_data.get("invoice_number", service_order.invoice_number)
        _require_invoice_to_verify(final_department, final_invoice)

    # B-01/B-03: revalida o domínio (departamento + marca) dos serviços quando os
    # itens, o departamento ou o modelo do veículo mudam. Impede que a edição deixe
    # (ou introduza) serviço de outra marca/departamento na O.S. Avalia o estado FINAL.
    if data.items is not None or "department" in update_data or "vehicle_model_id" in update_data:
        _final_department = update_data.get("department", service_order.department)
        _final_model_id = update_data.get("vehicle_model_id", service_order.vehicle_model_id)
        _final_brand_id: int | None = None
        if _final_model_id is not None:
            _final_brand_id = (
                await db.execute(
                    select(VehicleModel.brand_id).where(VehicleModel.id == _final_model_id)
                )
            ).scalar_one_or_none()
        _final_service_ids = (
            [i.service_id for i in data.items]
            if data.items is not None
            else [i.service_id for i in service_order.items]
        )
        await _validate_service_items_domain(
            db, _final_department, _final_brand_id, _final_service_ids
        )

    # Valida escopo de original_service_order_id na edição: a origem precisa existir
    # e ser da mesma MARCA da loja da O.S. (paridade com o create — a origem pode
    # estar em outra concessionária da marca). Descarta o link se não resolver.
    if (
        "original_service_order_id" in update_data
        and update_data["original_service_order_id"] is not None
    ):
        _upd_origin_id = update_data["original_service_order_id"]
        _upd_store_id = update_data.get("store_id", service_order.store_id)
        _upd_brand_ids = await get_same_brand_store_ids(db, _upd_store_id)
        _upd_origin_q = select(ServiceOrder.id).where(ServiceOrder.id == _upd_origin_id)
        if _upd_brand_ids is not None:
            _upd_origin_q = _upd_origin_q.where(ServiceOrder.store_id.in_(_upd_brand_ids))
        else:
            _upd_origin_q = apply_store_filter(_upd_origin_q, user, ServiceOrder.store_id)
        _upd_origin_resolved = (await db.execute(_upd_origin_q)).scalar_one_or_none()
        if _upd_origin_resolved is None:
            update_data["original_service_order_id"] = None

    # Retorno sem origem definitiva no estado FINAL da edição: mesma trava do create.
    _final_is_return = update_data.get("is_return", service_order.is_return)
    _final_original_id = update_data.get(
        "original_service_order_id", service_order.original_service_order_id
    )
    _final_notes = update_data.get("notes", service_order.notes)
    validate_return_without_origin(
        is_return=bool(_final_is_return),
        original_service_order_id=_final_original_id,
        user=user,
        notes=_final_notes,
    )

    for field, value in update_data.items():
        setattr(service_order, field, value)

    # 🟠 (auditoria): ao mudar o departamento, recomputar requires_invoice para o
    # campo persistido não mentir (film/security_film/ppf exigem NF). O enforcement
    # da verificação já usa o department final, mas o flag alimenta telas/relatórios.
    if "department" in update_data:
        service_order.requires_invoice = service_order.department in INVOICE_REQUIRED_DEPARTMENTS

    # A-01: editar uma O.S. já verificada REMOVE a verificação — o dado mudou e
    # precisa passar de novo pela Conferência antes de contar no Fechamento. A NF
    # (invoice_number) e demais campos são preservados; só cai o carimbo de
    # verificado. Exceção: quando a própria edição está marcando is_verified=True
    # (revalida na hora, já com a checagem de NF acima), respeita o valor enviado.
    if old_is_verified and update_data.get("is_verified") is not True:
        service_order.is_verified = False
        service_order.verified_at = None

    # Capturar valores novos AGORA, antes de qualquer db.flush(), para garantir
    # que atributos escalares não sejam expirados pelo SQLAlchemy após operações bulk.
    new_values_for_history = {f: getattr(service_order, f) for f in TRACKED_FIELDS}
    new_is_verified_for_history = service_order.is_verified

    # Replace workers if provided.
    # Se o conjunto de instaladores não mudou, preserva os registros atuais —
    # regravar aqui achataria o vínculo por serviço (service_order_item_id) que
    # o Finalizar criou, corrompendo a divisão de produção no Desempenho.
    if data.workers is not None:
        current_employee_ids = {w.employee_id for w in service_order.workers}
        new_employee_ids = {w.employee_id for w in data.workers}
        if new_employee_ids != current_employee_ids:
            from sqlalchemy import delete as sa_delete

            await db.execute(
                sa_delete(ServiceOrderWorker).where(
                    ServiceOrderWorker.service_order_id == service_order_id
                )
            )
            for employee_id in dict.fromkeys(w.employee_id for w in data.workers):
                worker = ServiceOrderWorker(
                    service_order_id=service_order_id,
                    employee_id=employee_id,
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

        # Itens com tonalidades por região (film_applications) tiveram o consumo
        # dividido entre bobinas no Finalizar — o delta abaixo só enxerga a
        # bobina espelhada. Preserva as aplicações (o form de edição não as
        # envia), bloqueia troca de bobina por aqui e exclui esses itens do
        # cálculo de delta.
        previous_multi_applications: dict[int, list] = {
            it.service_id: it.film_applications
            for it in service_order.items
            if it.film_applications
        }
        previous_roll_by_service: dict[int, int | None] = {
            it.service_id: it.film_roll_id for it in service_order.items
        }

        # Reconciliação de consumo POR SERVIÇO (tonalidade única). Capturamos, antes do
        # delete, a bobina atual e as linhas de consumo de cada serviço:
        #  - mesma bobina  → re-vincula o consumo ao item novo (mantém o histórico);
        #  - trocou/removeu → DELETA o consumo na bobina antiga e restaura os metros SEM
        #    inserir linha (a bobina antiga não fica com "+Xm" órfão nem "-Xm em branco");
        #  - bobina nova   → consome normalmente (linkado ao item novo).
        # Itens multi-tonalidade (film_applications) têm o consumo dividido por bobina no
        # Finalizar e não trocam de bobina na edição — suas linhas são apenas RE-VINCULADAS
        # ao item novo (nunca deletadas), como antes.
        from app.modules.inventory.models import FilmConsumption as _FilmConsumption

        _multi_services = set(previous_multi_applications.keys())

        old_single_roll_by_service: dict[int, int] = {
            it.service_id: it.film_roll_id
            for it in service_order.items
            if it.film_roll_id and not it.film_applications
        }

        # Retalho é definido no Finalizar/lançamento direto — a edição PRESERVA a
        # marcação (nenhuma tela de edição a expõe; sem isso, salvar a O.S. apagaria
        # o "feito com retalho" e a bobina voltaria a ser debitada indevidamente).
        old_scrap_by_service: dict[int, tuple[bool, int | None]] = {
            it.service_id: (bool(it.used_scrap), it.scrap_source_roll_id)
            for it in service_order.items
        }

        _old_item_service = {it.id: it.service_id for it in service_order.items}
        # cons_by_service: service_id -> [(cons_id, film_roll_id, meters_consumed, kind)]
        cons_by_service: dict[int, list[tuple[int, int | None, float, str | None]]] = {}
        if _old_item_service:
            _cons_rows = await db.execute(
                select(
                    _FilmConsumption.id,
                    _FilmConsumption.service_order_item_id,
                    _FilmConsumption.film_roll_id,
                    _FilmConsumption.meters_consumed,
                    _FilmConsumption.kind,
                ).where(_FilmConsumption.service_order_item_id.in_(list(_old_item_service.keys())))
            )
            for _cid, _soi, _frid_row, _meters, _kind in _cons_rows.all():
                _svc = _old_item_service.get(_soi)
                if _svc is None:
                    continue
                cons_by_service.setdefault(_svc, []).append(
                    (_cid, _frid_row, float(_meters or 0.0), _kind)
                )

        await db.execute(
            sa_delete(ServiceOrderItem).where(ServiceOrderItem.service_order_id == service_order_id)
        )
        new_services = []
        new_roll_code_list: list[str] = []
        new_roll_by_service: dict[int, int] = {}  # serviço (tonalidade única) -> bobina nova
        new_meters_by_service: dict[int, float] = {}  # serviço -> metros na bobina nova
        new_item_by_service: dict[int, int] = {}  # serviço -> item novo
        new_scrap_by_service: dict[int, bool] = {}  # serviço -> feito com retalho
        new_scrap_source_by_service: dict[int, int | None] = {}  # serviço -> bobina origem
        for item_data in data.items:
            svc = await get_service(db, item_data.service_id)
            if not svc:
                raise NotFoundError(f"Serviço #{item_data.service_id} não encontrado")
            new_services.append(svc.name)
            # Rastreia bobina: inclui roll_code E film_roll_id no mesmo key
            _frid = getattr(item_data, "film_roll_id", None)
            prev_applications = previous_multi_applications.get(item_data.service_id)
            if (
                prev_applications
                and _frid
                and _frid != previous_roll_by_service.get(item_data.service_id)
            ):
                raise ValidationError(
                    "Serviço com tonalidades por região: as bobinas são definidas "
                    "ao finalizar e não podem ser trocadas na edição"
                )
            roll_key = _build_roll_key(svc.name, item_data.roll_code, _frid)
            if roll_key:
                new_roll_code_list.append(roll_key)
            payload_applications = (
                [a.model_dump() for a in (item_data.film_applications or [])]
                if getattr(item_data, "film_applications", None)
                else None
            )
            _prev_scrap, _prev_scrap_source = old_scrap_by_service.get(
                item_data.service_id, (False, None)
            )
            # Preserva o retalho do item anterior SOMENTE quando a key não veio no
            # payload (client legado/edição que não expõe o toggle). Se veio
            # explicitamente (mesmo que False), respeita a intenção do caller.
            _item_set_fields = (
                item_data.model_fields_set if hasattr(item_data, "model_fields_set") else set()
            )
            if "used_scrap" in _item_set_fields:
                _used_scrap = bool(item_data.used_scrap)
                _scrap_source = getattr(item_data, "scrap_source_roll_id", None)
            else:
                _used_scrap = _prev_scrap
                _scrap_source = _prev_scrap_source
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
                used_scrap=_used_scrap,
                scrap_source_roll_id=_scrap_source,
                film_applications=payload_applications or prev_applications,
                notes=item_data.notes,
            )
            db.add(item)
            await db.flush()
            new_item_by_service[item_data.service_id] = item.id
            new_scrap_by_service[item_data.service_id] = _used_scrap
            new_scrap_source_by_service[item_data.service_id] = (
                _scrap_source if _used_scrap else None
            )

            # Bobina NOVA por serviço (tonalidade única). Multi-tonalidade fica de fora:
            # o consumo dele foi dividido por bobina no Finalizar.
            if _frid and not (payload_applications or prev_applications):
                new_roll_by_service[item_data.service_id] = _frid
                m = await _meters_for(_frid, item_data.service_id)
                new_meters_by_service[item_data.service_id] = (
                    new_meters_by_service.get(item_data.service_id, 0.0) + m
                )

        from sqlalchemy import update as _sa_update

        # Multi-tonalidade: re-vincula as linhas ao item novo do mesmo serviço.
        # Quando o serviço foi REMOVIDO na edição (sem item novo correspondente),
        # não há a quem religar — deleta o rastro de consumo (senão fica órfão,
        # item_id NULL) e devolve os metros a cada bobina envolvida (uma
        # aplicação multi-tonalidade pode ter consumido de mais de uma bobina).
        for _svc in _multi_services:
            _new_item_id = new_item_by_service.get(_svc)
            _multi_rows = cons_by_service.get(_svc, [])
            if _new_item_id is None:
                if not _multi_rows:
                    continue
                _net_by_roll: dict[int, float] = {}
                for _cid, _frid_row, _m, _kind in _multi_rows:
                    if _frid_row is not None:
                        _net_by_roll[_frid_row] = _net_by_roll.get(_frid_row, 0.0) + _m
                await db.execute(
                    sa_delete(_FilmConsumption).where(
                        _FilmConsumption.id.in_([cid for (cid, _frid, _m, _kind) in _multi_rows])
                    )
                )
                for _roll_id, _net in _net_by_roll.items():
                    if _net > 1e-9:
                        await release_roll_meters(
                            db, _roll_id, None, _net, record_consumption=False
                        )
                continue
            for _cid, _frid_row, _m, _kind in _multi_rows:
                await db.execute(
                    _sa_update(_FilmConsumption)
                    .where(_FilmConsumption.id == _cid)
                    .values(service_order_item_id=_new_item_id)
                )

        # Tonalidade única: reconcilia bobina antiga × nova por serviço.
        for _svc in set(old_single_roll_by_service) | set(new_roll_by_service):
            old_roll = old_single_roll_by_service.get(_svc)
            new_roll = new_roll_by_service.get(_svc)
            new_item_id = new_item_by_service.get(_svc)
            rows = cons_by_service.get(_svc, [])

            if old_roll is not None and new_roll is not None and old_roll == new_roll:
                # Mesma bobina: re-vincula o consumo ao item novo, metros inalterados.
                for _cid, _frid_row, _m, _kind in rows:
                    await db.execute(
                        _sa_update(_FilmConsumption)
                        .where(_FilmConsumption.id == _cid)
                        .values(service_order_item_id=new_item_id)
                    )
                continue

            # Trocou ou removeu: apaga o rastro na bobina antiga e restaura os metros
            # SEM inserir linha de estorno. Linhas de retalho (0m, na bobina de
            # ORIGEM) ficam de fora — são tratadas no passo abaixo.
            if old_roll is not None:
                old_rows = [
                    (cid, m) for (cid, frid, m, _kind) in rows if frid == old_roll and abs(m) > 1e-9
                ]
                if old_rows:
                    net = sum(m for (_, m) in old_rows)
                    await db.execute(
                        sa_delete(_FilmConsumption).where(
                            _FilmConsumption.id.in_([cid for (cid, _) in old_rows])
                        )
                    )
                    if net > 1e-9:
                        await release_roll_meters(db, old_roll, None, net, record_consumption=False)

            # Bobina nova (destino): consome normalmente, linkado ao item novo.
            if new_roll is not None and new_roll != old_roll:
                m = new_meters_by_service.get(_svc, 0.0)
                if m > 1e-9 and new_item_id is not None:
                    await consume_roll(db, new_roll, new_item_id, m)

        # Movimentos de RETALHO (0m) na reconciliação da edição. Identificados por
        # kind == 'retalho' (NÃO por metragem: um ajuste de delta nulo ou uma
        # reconciliação legada também valem 0m e não podem ser tocados aqui).
        from app.modules.inventory.service import record_scrap_use as _record_scrap_use

        for _svc, _rows in cons_by_service.items():
            if _svc in _multi_services:
                continue
            _scrap_rows = [(cid, frid) for (cid, frid, m, kind) in _rows if kind == "retalho"]
            _still_scrap = bool(new_scrap_by_service.get(_svc)) and bool(
                new_item_by_service.get(_svc)
            )
            _new_item_id = new_item_by_service.get(_svc)
            _source = new_scrap_source_by_service.get(_svc)

            if not _still_scrap:
                # Deixou de ser retalho: remove todas as linhas de 0m do serviço.
                _ids = [cid for (cid, _frid) in _scrap_rows]
                if _ids:
                    await db.execute(
                        sa_delete(_FilmConsumption).where(_FilmConsumption.id.in_(_ids))
                    )
                continue

            # Ainda é retalho: mantém só a linha na bobina de origem ATUAL
            # (re-vinculada ao item novo) e descarta as de bobina que deixou de ser
            # origem — senão item e extrato discordam sobre de onde saiu a sobra.
            _keep = [cid for (cid, frid) in _scrap_rows if _source is not None and frid == _source]
            _drop = [cid for (cid, _frid) in _scrap_rows if cid not in _keep]
            if _drop:
                await db.execute(sa_delete(_FilmConsumption).where(_FilmConsumption.id.in_(_drop)))
            if _keep:
                await db.execute(
                    _sa_update(_FilmConsumption)
                    .where(_FilmConsumption.id.in_(_keep))
                    .values(service_order_item_id=_new_item_id)
                )
            elif _source is not None and _new_item_id is not None:
                # Retalho NASCIDO (ou com origem TROCADA) na edição — ex.: a
                # Conferência marca o que o instalador esqueceu. Sem isto o
                # scrap_source_roll_id ficava apontando uma bobina que nunca soube
                # que foi aproveitada, e a auditoria de retalho saía incompleta.
                await _record_scrap_use(db, _source, _new_item_id)

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

    # D-03: propaga os campos escalares do veículo de volta ao agendamento vinculado.
    # Antes só service_ids/film_entries voltavam — corrigir a placa/modelo na O.S. não
    # corrigia no agendamento e os filtros por placa divergiam entre as telas.
    _SCALAR_SYNC_TO_APPT = {
        "vehicle_plate": "vehicle_plate",
        "vehicle_model": "vehicle_model",
        "vehicle_color": "vehicle_color",
        "external_os_number": "external_os_number",
    }
    _scalars_changed = [f for f in _SCALAR_SYNC_TO_APPT if f in update_data]
    if _scalars_changed:
        from app.modules.scheduling.models import Appointment as _ApptSync

        _appt_scalar = (
            await db.execute(
                select(_ApptSync).where(_ApptSync.service_order_id == service_order_id)
            )
        ).scalar_one_or_none()
        if _appt_scalar is not None:
            for _os_field in _scalars_changed:
                setattr(
                    _appt_scalar,
                    _SCALAR_SYNC_TO_APPT[_os_field],
                    getattr(service_order, _os_field),
                )
            db.add(_appt_scalar)

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

    # Indicadores agregam receita/consumo/status da O.S. editada → marca para
    # invalidar o cache de analytics pós-commit (cobre edição de preço/serviço/
    # status/etc. sem tocar bobina — antes não invalidava)
    db.info["bump_analytics"] = True

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
    commit: bool = True,
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

    # Indicadores agregam status da O.S. → marca para invalidar o cache de
    # analytics pós-commit. Marcado mesmo em commit=False: quem orquestra
    # fecha a transação e o get_db lê a flag no commit real dela.
    db.info["bump_analytics"] = True

    # commit=False: orquestrador fecha a transação (ver generate_service_order).
    if not commit:
        return service_order

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


async def undo_wrong(
    db: AsyncSession,
    service_order_id: int,
    user: User,
    request: Request | None = None,
) -> ServiceOrder:
    """
    Desfaz o "Lançado Errado" restaurando a O.S. ao status que ela tinha ANTES de
    ser marcada como wrong (tipicamente 'completed').

    Diferente de um change_status genérico para 'waiting': se a O.S. já estava
    finalizada quando foi marcada como Lançado Errado, desfazer o erro a devolve
    para Finalizado — sem reabrir o trabalho nem fazer o agendamento vinculado
    ressurgir como "Atrasado". Restaura o estado pré-wrong pelo StatusHistory;
    bypass proposital da máquina de estados (retorno a um estado já válido).
    """
    service_order = await get_service_order(db, service_order_id, user)

    if service_order.status != OSStatus.WRONG.value:
        raise ValidationError(detail="A O.S. não está em 'Lançado Errado'.")

    # Status anterior ao wrong, a partir do último registro que ENTROU em 'wrong'.
    result = await db.execute(
        select(StatusHistory)
        .where(
            StatusHistory.service_order_id == service_order_id,
            StatusHistory.to_status == OSStatus.WRONG.value,
        )
        .order_by(StatusHistory.changed_at.desc())
        .limit(1)
    )
    last_wrong = result.scalar_one_or_none()
    previous = last_wrong.from_status if last_wrong and last_wrong.from_status else None

    # Só restaura para estados ativos/finalizado; nunca para outro terminal.
    _RESTORABLE = {
        OSStatus.WAITING.value,
        OSStatus.IN_PROGRESS.value,
        OSStatus.COMPLETED.value,
    }
    if previous not in _RESTORABLE:
        previous = OSStatus.WAITING.value

    now = datetime.now(UTC)
    old_status = service_order.status
    service_order.status = previous
    service_order.updated_by_id = user.id
    if previous == OSStatus.COMPLETED.value and service_order.completion_time is None:
        service_order.completion_time = now

    db.add(
        StatusHistory(
            service_order_id=service_order.id,
            from_status=old_status,
            to_status=previous,
            changed_by_id=user.id,
            changed_at=now,
            notes="Lançado Errado desfeito",
        )
    )

    await log_audit(
        db=db,
        action="status_change",
        resource_type="service_order",
        user_id=user.id,
        resource_id=service_order_id,
        old_value={"status": old_status},
        new_value={"status": previous},
        request=request,
    )

    # Indicadores agregam status da O.S. → marca para invalidar o cache de
    # analytics pós-commit
    db.info["bump_analytics"] = True

    await db.flush()
    await db.commit()

    service_order = await get_service_order(db, service_order_id, user)

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
        reason: Motivo do cancelamento (opcional). Quando informado, também
            substitui a Observação Interna (internal_notes) da O.S.

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

    # A pedido da operação: o motivo do cancelamento passa a ser a Observação
    # Interna da O.S., SUBSTITUINDO qualquer conteúdo anterior (fica visível na
    # listagem/edição, além de continuar registrado no histórico de status).
    if reason and reason.strip():
        service_order.internal_notes = reason.strip()

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

    # Devolve à(s) bobina(s) os metros consumidos por esta O.S. — cancelar uma O.S.
    # finalizada não pode deixar os metros debitados do estoque. Estorna o consumo
    # LÍQUIDO por bobina (soma dos consumos dos itens: +consumo e -estornos de edição),
    # cobrindo automaticamente multi-tonalidade e edições anteriores. Só estorna o que
    # sobrou positivo; O.S. sem consumo (nunca finalizada) não gera estorno.
    from sqlalchemy import func as _func

    from app.modules.inventory.models import FilmConsumption as _FilmConsumption
    from app.modules.inventory.service import release_roll_meters as _release_roll_meters

    _item_ids = [it.id for it in service_order.items]
    if _item_ids:
        _item_for_roll: dict[int, int] = {}
        for _it in service_order.items:
            if _it.film_roll_id:
                _item_for_roll.setdefault(_it.film_roll_id, _it.id)
        _net_rows = await db.execute(
            select(
                _FilmConsumption.film_roll_id,
                _func.sum(_FilmConsumption.meters_consumed),
            )
            .where(_FilmConsumption.service_order_item_id.in_(_item_ids))
            .group_by(_FilmConsumption.film_roll_id)
        )
        for _roll_id, _net in _net_rows.all():
            if _roll_id is not None and _net and float(_net) > 1e-9:
                await _release_roll_meters(
                    db, _roll_id, _item_for_roll.get(_roll_id, _item_ids[0]), float(_net)
                )
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

    # Indicadores agregam receita/consumo/status da O.S. cancelada (incl.
    # cancelamento sem estorno) → marca para invalidar o cache de analytics
    # pós-commit
    db.info["bump_analytics"] = True

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


async def get_same_brand_store_ids(db: AsyncSession, store_id: int | None) -> list[int] | None:
    """Retorna os ids das lojas que compartilham a MARCA de `store_id`.

    Usado no fluxo de retorno: a O.S. de origem pode ter sido aberta em outra
    concessionária da mesma marca (ex.: original na BYD Unidade 05, retorno na BYDUnidade 07). Retorna None se `store_id` for None ou a loja não existir — nesse
    caso o chamador mantém o fallback pelo escopo de loja do usuário.
    """
    if store_id is None:
        return None
    brand_subq = select(Store.brand_id).where(Store.id == store_id).scalar_subquery()
    result = await db.execute(select(Store.id).where(Store.brand_id == brand_subq))
    store_ids = list(result.scalars().all())
    return store_ids or None


async def get_vehicle_history(
    db: AsyncSession,
    plate: str,
    user: User,
    brand_store_ids: list[int] | None = None,
) -> list[ServiceOrder]:
    """
    Retorna todas as OSs abertas para um veículo identificado pela placa/chassi.

    Por padrão aplica filtro de loja baseado nas permissões do usuário. Quando
    `brand_store_ids` é fornecido (fluxo de retorno cross-loja pela mesma marca),
    filtra por esse conjunto de lojas em vez do escopo do usuário.
    Limita a 50 registros, ordenados por entry_time DESC.

    Args:
        db: Sessão do banco de dados
        plate: Placa ou chassi do veículo (será convertido para maiúsculas)
        user: Usuário que está consultando
        brand_store_ids: Se fornecido, restringe às lojas dessa marca (opt-in)

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

    if brand_store_ids is not None:
        query = query.where(ServiceOrder.store_id.in_(brand_store_ids))
    else:
        query = apply_store_filter(query, user, ServiceOrder.store_id)

    result = await db.execute(query)
    return list(result.scalars().all())


async def suggest_return_origin(
    db: AsyncSession,
    plate: str,
    user: User,
    exclude_os_id: int | None = None,
    store_id: int | None = None,
    department: str | None = None,
) -> "ServiceOrder | None":
    """Sugere a O.S. de origem de um retorno: última O.S. finalizada e não-retorno
    da mesma placa/chassi.

    Quando `store_id` (loja onde o retorno está sendo aberto) é fornecido, amplia
    a busca para todas as lojas da mesma marca dessa loja; caso contrário, respeita
    o filtro de loja do usuário.

    Quando `department` é informado, a busca é ESTRITA por departamento: só
    sugere uma O.S. de origem do MESMO departamento. Se não houver nenhuma,
    retorna None (evita vincular um retorno a uma O.S. de outro departamento —
    o mesmo veículo pode ter O.S. finalizadas em departamentos distintos com o
    mesmo nº concessionária).
    """
    brand_store_ids = await get_same_brand_store_ids(db, store_id)
    history = await get_vehicle_history(db, plate, user, brand_store_ids=brand_store_ids)
    for so in history:  # já vem ordenado por entry_time desc
        if so.id == exclude_os_id:
            continue
        if department and so.department != department:
            continue
        if so.status == "completed" and not so.is_return:
            return so
    return None


# Status de O.S. "a fazer" que aceitam Finalizar. Espelha o conjunto `em_execucao`
# do compute_display_status (scheduling): `wrong` ("Lançado Errado") é rótulo
# exclusivo da Conferência e IMUNE ao Agendamento (ADR 0014/0016) — uma O.S. `wrong`
# NUNCA finalizada aparece como `em_execucao` e oferece Finalizar. O recorte "nunca
# finalizada" (completion_time vazio) é aplicado na trava, pois depende da instância.
# Terminais reais (completed/cancelled/duplicate) ficam de fora.
FINALIZAVEL_OS_STATUSES = {
    OSStatus.IN_PROGRESS.value,
    OSStatus.WAITING.value,
    OSStatus.WRONG.value,
}


async def finalize_service_order(
    db: AsyncSession,
    service_order_id: int,
    data: FinalizeOrderRequest,
    user: User,
    request: Request | None = None,
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

    # S1 — lock pessimista: adquire FOR UPDATE antes de qualquer leitura de negócio.
    # Isso garante que duas finalizações concorrentes não passem ambas pela guarda de
    # status (que verificaria in_progress em ambas antes de qualquer commit), o que
    # causaria consumo duplo de bobina e workers duplicados.
    # A segunda chamada bloqueia no SELECT FOR UPDATE e, ao ser liberada, relê o status
    # já atualizado para "completed" — caindo na guarda abaixo e sendo rejeitada.
    _lock_result = await db.execute(
        select(ServiceOrder.id, ServiceOrder.status)
        .where(ServiceOrder.id == service_order_id)
        .with_for_update()
    )
    _locked_row = _lock_result.first()
    if _locked_row is None:
        raise NotFoundError(resource="Ordem de Serviço")

    # Carrega com eager loading e valida permissões de acesso (loja/galpão).
    service_order = await get_service_order(db, service_order_id, user)

    # Trava de status: só finaliza O.S. "a fazer" (FINALIZAVEL_OS_STATUSES). O `wrong`
    # entra aqui SÓ enquanto nunca foi finalizada (completion_time vazio) — mesma régua
    # do compute_display_status: `wrong` com completion_time já aparece como "finalizado"
    # no Agendamento e é assunto do undo_wrong, NÃO do Finalizar (evita re-finalização:
    # reescrita de instaladores + reconsumo de bobina). Terminais reais seguem barrados.
    _wrong_ja_finalizada = (
        service_order.status == OSStatus.WRONG.value and service_order.completion_time is not None
    )
    if service_order.status not in FINALIZAVEL_OS_STATUSES or _wrong_ja_finalizada:
        raise ValidationError("Apenas O.S. em andamento ou aguardando podem ser finalizadas")

    # #1: foto da chancela + bobina (película comum) são obrigatórias ao finalizar.
    # Owner é isento (limpeza de backlog de carros já feitos). Antes esta regra só
    # existia no FinalizeOSModal — o backend aceitava finalizar sem nada.
    if not is_owner(user):
        if not data.completion_photos:
            raise ValidationError("Adicione ao menos 1 foto da chancela para finalizar")
        assigned_service_ids = {a.service_id for a in data.film_roll_assignments}
        for item in service_order.items:
            item_dept = item.service_department or service_order.department
            # Aceita rolo já atribuído por tonalidade (itens multi-tonalidade) além
            # do film_roll_id legado e de um assignment novo neste finalize.
            has_applied_roll = any(
                (app or {}).get("film_roll_id") or (app or {}).get("used_scrap")
                for app in (item.film_applications or [])
            )
            if (
                item_dept == "film"
                and item.film_roll_id is None
                and not item.used_scrap
                and not has_applied_roll
                and item.service_id not in assigned_service_ids
            ):
                raise ValidationError("Selecione uma bobina para cada serviço de película")

    # Atribuir bobinas aos itens de película.
    # Item legado (tonalidade única): 1 assignment por serviço, consumo integral.
    # Item com film_applications (tonalidades por região): 1 assignment POR
    # TONALIDADE distinta; cada bobina consome metros/K (K = tonalidades
    # distintas — divisão igual, aproximação aceita para regiões assimétricas).
    if data.film_roll_assignments:
        from app.modules.inventory.models import FilmRoll
        from app.modules.inventory.service import (
            compute_visual_id,
            consume_roll,
            get_meters_for_service,
            record_scrap_use,
            release_item_consumption,
        )

        # Dedup do movimento de 0m: 1 linha por (item, bobina de origem). Sem isso um
        # item multi-tonalidade com 2 regiões na MESMA tonalidade grava a linha de
        # retalho duplicada (as duas aplicações casam com o mesmo assignment).
        _scrap_recorded: set[tuple[int, int]] = set()

        async def _record_scrap_once(source_roll_id: int, item_id: int) -> None:
            if (item_id, source_roll_id) in _scrap_recorded:
                return
            await record_scrap_use(db, source_roll_id, item_id)
            _scrap_recorded.add((item_id, source_roll_id))

        # C-04 é aplicado no ponto de estrangulamento, não aqui: consume_roll (consumo)
        # e record_scrap_use (bobina de origem do retalho) chamam
        # _assert_roll_store_matches_order. Lojas co-localizadas que COMPARTILHAM
        # estoque físico (ex.: BYD e Fiat Unidade 11, consumo cruzado alto) precisam
        # de StoreInventoryLink (ou a O.S. ser de galpão) para o cruzamento passar —
        # senão ~55% dos consumos legítimos delas seriam barrados.

        # 1. Batch fetch de bobinas (Zero N+1)
        roll_ids_to_fetch = {
            a.film_roll_id
            for a in data.film_roll_assignments
            if not a.used_scrap and a.film_roll_id is not None
        }
        rolls_by_id = {}
        if roll_ids_to_fetch:
            rolls_result = await db.execute(
                select(FilmRoll)
                .options(selectinload(FilmRoll.film_type))
                .where(FilmRoll.id.in_(roll_ids_to_fetch))
            )
            rolls_by_id = {r.id: r for r in rolls_result.scalars().all()}

        roll_assignments_by_service: dict[int, list] = {}
        for assignment in data.film_roll_assignments:
            roll_assignments_by_service.setdefault(assignment.service_id, []).append(assignment)

        # 2. Uso dos itens já carregados no relacionamento service_order (O(1) lookup)
        items_by_service = {item.service_id: item for item in service_order.items}

        for service_id, assignments in roll_assignments_by_service.items():
            item = items_by_service.get(service_id)
            if item is None:
                continue

            if item.film_applications:
                distinct_tonalities: list[str] = []
                for app in item.film_applications:
                    app_ton = normalize_tonality(app.get("tonality"))
                    if app_ton and app_ton not in distinct_tonalities:
                        distinct_tonalities.append(app_ton)
                k = max(len(distinct_tonalities), 1)

                by_tonality: dict[str, object] = {}
                for a in assignments:
                    assignment_tonality = normalize_tonality(a.tonality)
                    if assignment_tonality is None:
                        raise ValidationError(
                            "Esta O.S. tem tonalidades por região — atualize o "
                            "aplicativo para finalizar"
                        )
                    by_tonality[assignment_tonality] = a
                unknown_tonalities = sorted(t for t in by_tonality if t not in distinct_tonalities)
                if unknown_tonalities:
                    raise ValidationError(
                        f"Tonalidade {', '.join(unknown_tonalities)} não pertence a este serviço"
                    )
                # Tonalidade já resolvida = tem bobina OU foi feita com retalho.
                pending = [
                    t
                    for t in distinct_tonalities
                    if not any(
                        normalize_tonality(app.get("tonality")) == t
                        and (app.get("film_roll_id") or app.get("used_scrap"))
                        for app in item.film_applications
                    )
                ]
                missing = sorted(set(pending) - set(by_tonality))
                if missing:
                    raise ValidationError(
                        f"Selecione uma bobina para cada tonalidade (faltam: {', '.join(missing)})"
                    )

                # Consumo é POR TONALIDADE distinta, não por região: um item com a
                # mesma tonalidade em N regiões (ex.: G20 em 4 vidros) tem N aplicações
                # mas UMA bobina, e deve descontar metros/k UMA vez — senão gastaria
                # N×metros e a bobina esgotava no meio do laço (erro "bobina esgotada").
                consumed_tonalities: set[str] = set()
                new_applications: list[dict] = []
                for app in item.film_applications:
                    app = dict(app)
                    app_tonality = normalize_tonality(app.get("tonality"))
                    a = by_tonality.get(app_tonality)
                    if (
                        a is not None
                        and a.used_scrap
                        and not app.get("film_roll_id")
                        and not app.get("used_scrap")
                    ):
                        # Retalho: nada a consumir — a sobra já saiu da bobina no
                        # corte anterior. Só marca a aplicação e, se a origem for
                        # conhecida, registra o movimento de 0m no extrato dela.
                        app["used_scrap"] = True
                        app["scrap_source_roll_id"] = a.scrap_source_roll_id
                        if a.scrap_source_roll_id:
                            await _record_scrap_once(a.scrap_source_roll_id, item.id)
                        new_applications.append(app)
                        continue
                    if a is not None and not a.used_scrap and not app.get("film_roll_id"):
                        roll = rolls_by_id.get(a.film_roll_id)
                        if roll:
                            roll_tonality = normalize_tonality(roll.tonality)
                            if roll_tonality and roll_tonality != app_tonality:
                                raise ValidationError(
                                    f"A bobina selecionada é {roll_tonality}, mas a "
                                    f"aplicação exige {app_tonality}"
                                )
                            film_type_name = roll.film_type.name if roll.film_type else ""
                            app["film_roll_id"] = a.film_roll_id
                            app["roll_code"] = compute_visual_id(
                                film_type_name,
                                roll.tonality,
                                roll.receipt_date,
                                roll.total_meters,
                            )
                            # Consumo 1x por tonalidade: só busca os metros e debita na
                            # 1ª região da tonalidade (evita N SELECTs iguais em item
                            # multi-região da mesma tonalidade — mantém o Zero N+1).
                            if app_tonality not in consumed_tonalities:
                                meters = await get_meters_for_service(
                                    db, roll.film_type_id, service_id
                                )
                                if meters:
                                    await consume_roll(
                                        db, a.film_roll_id, item.id, float(meters) / k
                                    )
                                    consumed_tonalities.add(app_tonality)
                    new_applications.append(app)
                # Reatribuição (não mutação in-place) para o SQLAlchemy persistir o JSON
                item.film_applications = new_applications
                # Espelho legado: primeira aplicação com bobina
                first_assigned = next(
                    (app for app in new_applications if app.get("film_roll_id")), None
                )
                if first_assigned and item.film_roll_id is None:
                    item.film_roll_id = first_assigned["film_roll_id"]
                    item.roll_code = first_assigned.get("roll_code")
                # Espelho legado do retalho: primeira aplicação feita com sobra
                first_scrap = next((app for app in new_applications if app.get("used_scrap")), None)
                if first_scrap and not item.used_scrap:
                    item.used_scrap = True
                    item.scrap_source_roll_id = first_scrap.get("scrap_source_roll_id")
                continue

            assignment = assignments[0]
            if assignment.used_scrap:
                # Retalho declarado no Finalizar. Se o item JÁ trazia bobina debitada
                # (O.S. que recebeu bobina numa edição antes de finalizar), estorna
                # esse consumo — os metros que a marcação existe para não gastar
                # voltam — e, quando nenhuma origem foi informada, converte a bobina
                # revertida em origem do retalho. Sem isso a marcação era descartada
                # em silêncio e a bobina ficava debitada assim mesmo.
                if item.film_roll_id is not None:
                    await release_item_consumption(db, item.id, item.film_roll_id)
                    if assignment.scrap_source_roll_id is None:
                        assignment.scrap_source_roll_id = item.film_roll_id
                    item.film_roll_id = None
                    item.roll_code = None
                if not item.used_scrap:
                    item.used_scrap = True
                    item.scrap_source_roll_id = assignment.scrap_source_roll_id
                    if assignment.scrap_source_roll_id:
                        await _record_scrap_once(assignment.scrap_source_roll_id, item.id)
                continue
            if item.film_roll_id is None:
                item.film_roll_id = assignment.film_roll_id
                roll = rolls_by_id.get(assignment.film_roll_id)
                if roll:
                    film_type_name = roll.film_type.name if roll.film_type else ""
                    item.roll_code = compute_visual_id(
                        film_type_name, roll.tonality, roll.receipt_date, roll.total_meters
                    )
                    meters = await get_meters_for_service(db, roll.film_type_id, service_id)
                    if meters:
                        await consume_roll(db, assignment.film_roll_id, item.id, meters)

    # Armazenar fotos da chancela
    if data.completion_photos:
        _validate_photo_urls(data.completion_photos, field="Foto de finalização")
        service_order.completion_photos = json.dumps(data.completion_photos)

    # Relato técnico do instalador: só sobrescreve se o campo veio no request —
    # um finalize disparado sem execution_notes (clientes antigos, retry) não
    # pode apagar um relato já registrado.
    if "execution_notes" in data.model_fields_set:
        service_order.execution_notes = data.execution_notes

    # Substituir workers (se fornecidos)
    # Departamentos de película exigem instalador POR SERVIÇO (rastreabilidade
    # quando dois instaladores fazem o mesmo carro). Demais departamentos e
    # clientes antigos seguem com employee_ids (funcionários da O.S. inteira).
    film_installer_depts = {"film", "security_film", "ppf"}
    if service_order.department in film_installer_depts and not data.employee_assignments:
        if not data.employee_ids:
            raise ValidationError("Informe o instalador de cada serviço para finalizar")

    if data.employee_ids or data.employee_assignments:
        items_by_service = {it.service_id: it for it in service_order.items}

        if data.employee_assignments:
            unknown = [
                a.service_id
                for a in data.employee_assignments
                if a.service_id not in items_by_service
            ]
            if unknown:
                raise ValidationError("Serviço informado não pertence a esta O.S.")
            if service_order.department in film_installer_depts:
                assigned = {a.service_id for a in data.employee_assignments}
                if any(sid not in assigned for sid in items_by_service):
                    raise ValidationError("Selecione o instalador de cada serviço")

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
        # N instaladores por serviço (produção dividida igualmente no Desempenho);
        # entradas repetidas do mesmo service_id viram união, com dedupe por instalador
        installers_by_service: dict[int, list[int]] = {}
        for assignment in data.employee_assignments:
            bucket = installers_by_service.setdefault(assignment.service_id, [])
            for eid in assignment.employee_ids:
                if eid not in bucket:
                    bucket.append(eid)
        for service_id, employee_ids in installers_by_service.items():
            for eid in employee_ids:
                db.add(
                    ServiceOrderWorker(
                        service_order_id=service_order_id,
                        employee_id=eid,
                        service_order_item_id=items_by_service[service_id].id,
                    )
                )

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

    # S2 — trilha de auditoria: finalização é a operação mais sensível do sistema
    # (muda status para completed + consome estoque + atribui instaladores) e não
    # tinha registro de auditoria, diferente de cancel/verify/change_status.
    _roll_ids = (
        [a.film_roll_id for a in data.film_roll_assignments if a.film_roll_id is not None]
        if data.film_roll_assignments
        else []
    )
    _scrap_service_ids = (
        [a.service_id for a in data.film_roll_assignments if a.used_scrap]
        if data.film_roll_assignments
        else []
    )
    _employee_ids = list(data.employee_ids) if data.employee_ids else []
    for _ea in data.employee_assignments or []:
        for _eid in _ea.employee_ids:
            if _eid not in _employee_ids:
                _employee_ids.append(_eid)
    await log_audit(
        db=db,
        action="finalize",
        resource_type="service_order",
        user_id=user.id,
        resource_id=service_order_id,
        old_value={"status": original_status},
        new_value={
            "status": OSStatus.COMPLETED.value,
            "film_roll_ids": _roll_ids,
            "scrap_service_ids": _scrap_service_ids,
            "employee_ids": _employee_ids,
        },
        request=request,
    )

    # Indicadores agregam status/consumo/receita da O.S. finalizada → marca para
    # invalidar o cache de analytics pós-commit (idempotente mesmo com N
    # consume_roll/record_scrap_use já tendo marcado a mesma flag acima)
    db.info["bump_analytics"] = True

    # O negócio (status + consumo + instaladores) é fechado ANTES de qualquer coisa
    # best-effort. Se a notificação abaixo falhar no banco, ela envenenaria esta
    # transação e o commit levaria junto a finalização inteira — exatamente o que
    # não pode acontecer na operação mais crítica do sistema.
    await db.commit()

    # Freio contra marcar retalho demais: avisa os Owners quando o instalador cruza
    # o limiar do mês. Em SAVEPOINT próprio — se falhar, o rollback atinge só a
    # notificação, nunca a finalização já commitada.
    try:
        from app.modules.inventory.service import notify_scrap_ratio_if_crossed

        async with db.begin_nested():
            await notify_scrap_ratio_if_crossed(db, service_order_id)
        await db.commit()
    except Exception:
        logging.getLogger(__name__).warning(
            "Alerta de uso de retalho falhou para a O.S. %s (finalização preservada)",
            service_order_id,
            exc_info=True,
        )
        await db.rollback()

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
