"""
Analytics service - Business logic for analytics and BI queries.
"""

from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import case, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import PermissionChecker, is_galpon_profile_user
from app.modules.analytics.schemas import (
    ConsultantRankingItem,
    DashboardOverview,
    DepartmentBreakdownItem,
    EmployeeRankingItem,
    FilmPpfStoreRankingItem,
    KPIComparison,
    QueueSnapshotItem,
    ServiceRankingItem,
    SLAMetrics,
    StoreRankingItem,
    TimeSeriesByTypePoint,
    TimeSeriesPoint,
)
from app.modules.auth.models import User
from app.modules.consultants.models import Consultant
from app.modules.dealerships.models import Dealership
from app.modules.employees.models import Employee
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem, ServiceOrderWorker
from app.modules.services.models import Service
from app.modules.stores.models import Store

# =============================================================================
# Helpers
# =============================================================================


def _delta(current: float, previous: float) -> float | None:
    """Calcula delta percentual. Retorna None quando previous == 0."""
    if previous == 0:
        return None
    return round((current - previous) / previous * 100, 1)


def _kpi(current: float, previous: float) -> KPIComparison:
    """Monta KPIComparison com delta calculado."""
    return KPIComparison(current=current, previous=previous, delta_pct=_delta(current, previous))


def _prev_period(start_date: datetime, end_date: datetime) -> tuple[datetime, datetime]:
    """Calcula o período anterior com a mesma duração."""
    duration = end_date - start_date
    prev_end = start_date - timedelta(days=1)
    prev_start = prev_end - duration
    return prev_start, prev_end


async def _period_stats(
    db: AsyncSession,
    start_date: datetime,
    end_date: datetime,
    store_id: int | None,
    is_galpon: bool = False,
) -> dict:
    """
    Computa estatísticas para um período específico:
    - revenue (excluindo cortesia)
    - total_orders
    - completed_orders (status=completed)
    - courtesy_count
    - galpon_count
    - return_count
    """
    base_filters = [
        ServiceOrder.entry_time >= start_date,
        ServiceOrder.entry_time <= end_date,
    ]
    if store_id is not None:
        base_filters.append(ServiceOrder.store_id == store_id)
    if is_galpon:
        base_filters.append(ServiceOrder.is_galpon.is_(True))

    # Total, completed, courtesy, galpon, return counts
    # Using case() for SQLite/PostgreSQL compatibility
    counts_q = select(
        func.count(ServiceOrder.id).label("total"),
        func.sum(case((ServiceOrder.status == "completed", 1), else_=0)).label("completed"),
        func.sum(
            case((ServiceOrder.is_courtesy == True, 1), else_=0)  # noqa: E712
        ).label("courtesy"),
        func.sum(
            case((ServiceOrder.is_galpon == True, 1), else_=0)  # noqa: E712
        ).label("galpon"),
        func.sum(
            case((ServiceOrder.is_return == True, 1), else_=0)  # noqa: E712
        ).label("ret"),
    ).where(*base_filters)

    row = (await db.execute(counts_q)).one()
    total = int(row.total or 0)
    completed = int(row.completed or 0)
    courtesy = int(row.courtesy or 0)
    galpon = int(row.galpon or 0)
    ret = int(row.ret or 0)

    # Revenue: sum(unit_price * quantity) where is_courtesy=False
    revenue_q = (
        select(func.coalesce(func.sum(ServiceOrderItem.unit_price * ServiceOrderItem.quantity), 0))
        .join(ServiceOrder, ServiceOrderItem.service_order_id == ServiceOrder.id)
        .where(*base_filters, ServiceOrder.is_courtesy == False)  # noqa: E712
    )
    revenue = float((await db.execute(revenue_q)).scalar() or 0)

    return {
        "revenue": revenue,
        "total": total,
        "completed": completed,
        "courtesy": courtesy,
        "galpon": galpon,
        "return": ret,
    }


# =============================================================================
# get_overview (original — preserved intact)
# =============================================================================


async def get_overview(
    db: AsyncSession,
    user: User,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
    store_id: int | None = None,
) -> dict:
    """
    Retorna visao geral analitica de ordens de servico.

    Args:
        db: Sessao do banco de dados
        user: Usuario autenticado (para RBAC)
        start_date: Data inicial (opcional)
        end_date: Data final (opcional)
        store_id: Filtrar por loja (opcional)

    Returns:
        Dict com total_orders, completed_orders, revenue, avg_ticket,
        orders_by_month, orders_by_status, orders_by_store.
    """
    # Base query filter — apply RBAC store restriction
    base_filters = []
    user_store_ids = PermissionChecker.get_user_store_ids(user)
    if user_store_ids:
        base_filters.append(ServiceOrder.store_id.in_(user_store_ids))
    if start_date:
        base_filters.append(ServiceOrder.entry_time >= start_date)
    if end_date:
        base_filters.append(ServiceOrder.entry_time <= end_date)
    if store_id:
        base_filters.append(ServiceOrder.store_id == store_id)
    if is_galpon_profile_user(user):
        base_filters.append(ServiceOrder.is_galpon.is_(True))

    # Total orders
    total_q = select(func.count(ServiceOrder.id)).where(*base_filters)
    total_orders: int = (await db.execute(total_q)).scalar() or 0

    # Completed orders
    completed_q = select(func.count(ServiceOrder.id)).where(
        *base_filters,
        ServiceOrder.status == "completed",
    )
    completed_orders: int = (await db.execute(completed_q)).scalar() or 0

    # Revenue
    revenue_q = (
        select(func.coalesce(func.sum(ServiceOrderItem.unit_price * ServiceOrderItem.quantity), 0))
        .join(ServiceOrder, ServiceOrderItem.service_order_id == ServiceOrder.id)
        .where(*base_filters)
    )
    revenue: float = float((await db.execute(revenue_q)).scalar() or 0)

    avg_ticket: float = round(revenue / total_orders, 2) if total_orders > 0 else 0.0

    # Orders by month
    fmt = text("'YYYY-MM'")
    month_q = (
        select(
            func.to_char(ServiceOrder.entry_time, fmt).label("month"),
            func.count(ServiceOrder.id).label("count"),
            func.coalesce(
                func.sum(ServiceOrderItem.unit_price * ServiceOrderItem.quantity), 0
            ).label("revenue"),
        )
        .outerjoin(ServiceOrderItem, ServiceOrderItem.service_order_id == ServiceOrder.id)
        .where(*base_filters)
        .group_by(func.to_char(ServiceOrder.entry_time, fmt))
        .order_by(func.to_char(ServiceOrder.entry_time, fmt))
    )
    month_rows = (await db.execute(month_q)).all()
    orders_by_month = [
        {"month": row.month, "count": row.count, "revenue": float(row.revenue)}
        for row in month_rows
    ]

    # Orders by status
    status_q = (
        select(
            ServiceOrder.status.label("status"),
            func.count(ServiceOrder.id).label("count"),
        )
        .where(*base_filters)
        .group_by(ServiceOrder.status)
    )
    status_rows = (await db.execute(status_q)).all()
    orders_by_status = {row.status: row.count for row in status_rows}

    # Orders by store
    store_q = (
        select(
            ServiceOrder.store_id.label("store_id"),
            Store.name.label("store_name"),
            func.count(ServiceOrder.id).label("count"),
        )
        .join(Store, Store.id == ServiceOrder.store_id)
        .where(*base_filters)
        .group_by(ServiceOrder.store_id, Store.name)
        .order_by(func.count(ServiceOrder.id).desc())
    )
    store_rows = (await db.execute(store_q)).all()
    orders_by_store = [
        {"store_id": row.store_id, "store_name": row.store_name, "count": row.count}
        for row in store_rows
    ]

    return {
        "total_orders": total_orders,
        "completed_orders": completed_orders,
        "revenue": revenue,
        "avg_ticket": avg_ticket,
        "orders_by_month": orders_by_month,
        "orders_by_status": orders_by_status,
        "orders_by_store": orders_by_store,
    }


# =============================================================================
# Dashboard Executivo — novas funções
# =============================================================================


async def get_dashboard_overview(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    store_id: int | None = None,
) -> DashboardOverview:
    """
    Retorna KPIs comparados ao período anterior de mesma duração.

    KPIs:
    - revenue: receita (excluindo cortesia)
    - total_orders: total de O.S.
    - completed_orders: O.S. entregues
    - avg_ticket: ticket médio
    - completion_rate: % de O.S. entregues
    - pct_courtesy: % de O.S. cortesia
    - pct_galpon: % de O.S. galpão
    - pct_return: % de O.S. retorno
    """
    _is_galpon = is_galpon_profile_user(user)
    curr = await _period_stats(db, start_date, end_date, store_id, is_galpon=_is_galpon)
    prev_start, prev_end = _prev_period(start_date, end_date)
    prev = await _period_stats(db, prev_start, prev_end, store_id, is_galpon=_is_galpon)

    def _pct(count: int, total: int) -> float:
        return round(count / total * 100, 2) if total > 0 else 0.0

    curr_avg = round(curr["revenue"] / curr["total"], 2) if curr["total"] > 0 else 0.0
    prev_avg = round(prev["revenue"] / prev["total"], 2) if prev["total"] > 0 else 0.0
    curr_rate = _pct(curr["completed"], curr["total"])
    prev_rate = _pct(prev["completed"], prev["total"])
    curr_crt = _pct(curr["courtesy"], curr["total"])
    prev_crt = _pct(prev["courtesy"], prev["total"])
    curr_glp = _pct(curr["galpon"], curr["total"])
    prev_glp = _pct(prev["galpon"], prev["total"])
    curr_ret = _pct(curr["return"], curr["total"])
    prev_ret = _pct(prev["return"], prev["total"])

    return DashboardOverview(
        revenue=_kpi(curr["revenue"], prev["revenue"]),
        total_orders=_kpi(float(curr["total"]), float(prev["total"])),
        completed_orders=_kpi(float(curr["completed"]), float(prev["completed"])),
        avg_ticket=_kpi(curr_avg, prev_avg),
        completion_rate=_kpi(curr_rate, prev_rate),
        pct_courtesy=_kpi(curr_crt, prev_crt),
        pct_galpon=_kpi(curr_glp, prev_glp),
        pct_return=_kpi(curr_ret, prev_ret),
    )


async def get_stores_ranking(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    store_id: int | None = None,
) -> list[StoreRankingItem]:
    """
    Ranking de lojas por receita no período.

    Receita exclui O.S. com is_courtesy=True.
    completion_rate = completed_count / total_count * 100 por loja.
    """
    date_filters = [
        ServiceOrder.entry_time >= start_date,
        ServiceOrder.entry_time <= end_date,
    ]
    if store_id is not None:
        date_filters.append(ServiceOrder.store_id == store_id)
    if is_galpon_profile_user(user):
        date_filters.append(ServiceOrder.is_galpon.is_(True))

    # Revenue per store (excluding courtesy): use case() to zero out courtesy items
    revenue_q = (
        select(
            ServiceOrder.store_id.label("store_id"),
            Store.name.label("store_name"),
            func.count(ServiceOrder.id.distinct()).label("orders_count"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            ServiceOrder.is_courtesy == False,  # noqa: E712
                            ServiceOrderItem.unit_price * ServiceOrderItem.quantity,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("revenue"),
        )
        .join(Store, Store.id == ServiceOrder.store_id)
        .outerjoin(ServiceOrderItem, ServiceOrderItem.service_order_id == ServiceOrder.id)
        .where(*date_filters)
        .group_by(ServiceOrder.store_id, Store.name)
    )

    # Completed count per store
    completed_q = (
        select(
            ServiceOrder.store_id.label("store_id"),
            func.count(ServiceOrder.id).label("completed_count"),
        )
        .where(*date_filters, ServiceOrder.status == "completed")
        .group_by(ServiceOrder.store_id)
    )

    revenue_rows = (await db.execute(revenue_q)).all()
    completed_rows = (await db.execute(completed_q)).all()
    completed_map: dict[int, int] = {r.store_id: r.completed_count for r in completed_rows}

    result: list[StoreRankingItem] = []
    for row in revenue_rows:
        orders_count = int(row.orders_count or 0)
        revenue = float(row.revenue or 0)
        completed = completed_map.get(row.store_id, 0)
        avg_ticket = round(revenue / orders_count, 2) if orders_count > 0 else 0.0
        completion_rate = round(completed / orders_count * 100, 2) if orders_count > 0 else 0.0

        result.append(
            StoreRankingItem(
                store_id=row.store_id,
                store_name=row.store_name,
                revenue=revenue,
                orders_count=orders_count,
                avg_ticket=avg_ticket,
                completion_rate=completion_rate,
            )
        )

    result.sort(key=lambda x: x.revenue, reverse=True)
    return result


async def get_services_ranking(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    department: str | None = None,
    limit: int = 10,
    store_id: int | None = None,
) -> list[ServiceRankingItem]:
    """
    Ranking de serviços por receita no período.

    Receita exclui O.S. com is_courtesy=True.
    Filtro opcional por departamento.
    """
    date_filters = [
        ServiceOrder.entry_time >= start_date,
        ServiceOrder.entry_time <= end_date,
        ServiceOrder.is_courtesy == False,  # noqa: E712
    ]
    if department is not None:
        date_filters.append(Service.department == department)
    if store_id is not None:
        date_filters.append(ServiceOrder.store_id == store_id)
    if is_galpon_profile_user(user):
        date_filters.append(ServiceOrder.is_galpon.is_(True))

    q = (
        select(
            Service.id.label("service_id"),
            Service.name.label("service_name"),
            Service.department.label("department"),
            func.count(ServiceOrderItem.id).label("count"),
            func.coalesce(
                func.sum(ServiceOrderItem.unit_price * ServiceOrderItem.quantity), 0
            ).label("revenue"),
        )
        .join(ServiceOrderItem, ServiceOrderItem.service_id == Service.id)
        .join(ServiceOrder, ServiceOrder.id == ServiceOrderItem.service_order_id)
        .where(*date_filters)
        .group_by(Service.id, Service.name, Service.department)
        .order_by(func.sum(ServiceOrderItem.unit_price * ServiceOrderItem.quantity).desc())
        .limit(limit)
    )

    rows = (await db.execute(q)).all()
    return [
        ServiceRankingItem(
            service_id=row.service_id,
            service_name=row.service_name,
            department=row.department,
            count=int(row.count),  # type: ignore[call-overload]
            revenue=float(row.revenue),
        )
        for row in rows
    ]


async def get_department_breakdown(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    store_id: int | None = None,
) -> list[DepartmentBreakdownItem]:
    """
    Breakdown de O.S. e receita por departamento.

    pct_revenue = revenue_dept / total_revenue * 100.
    Receita exclui cortesia.
    """
    date_filters = [
        ServiceOrder.entry_time >= start_date,
        ServiceOrder.entry_time <= end_date,
    ]
    if store_id is not None:
        date_filters.append(ServiceOrder.store_id == store_id)
    if is_galpon_profile_user(user):
        date_filters.append(ServiceOrder.is_galpon.is_(True))

    q = (
        select(
            ServiceOrder.department.label("department"),
            func.count(ServiceOrder.id).label("count"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            ServiceOrder.is_courtesy == False,  # noqa: E712
                            ServiceOrderItem.unit_price * ServiceOrderItem.quantity,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("revenue"),
        )
        .outerjoin(ServiceOrderItem, ServiceOrderItem.service_order_id == ServiceOrder.id)
        .where(*date_filters)
        .group_by(ServiceOrder.department)
        .order_by(func.count(ServiceOrder.id).desc())
    )

    rows = (await db.execute(q)).all()
    total_revenue = sum(float(r.revenue or 0) for r in rows)

    result: list[DepartmentBreakdownItem] = []
    for row in rows:
        dept_revenue = float(row.revenue or 0)
        pct_revenue = round(dept_revenue / total_revenue * 100, 2) if total_revenue > 0 else 0.0
        result.append(
            DepartmentBreakdownItem(
                department=row.department,
                count=int(row.count),  # type: ignore[call-overload]
                revenue=dept_revenue,
                pct_revenue=pct_revenue,
            )
        )
    return result


async def get_employees_ranking(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    department: str | None = None,
    limit: int = 10,
    store_id: int | None = None,
) -> list[EmployeeRankingItem]:
    """
    Ranking de funcionários por O.S. atendidas no período.

    hours_worked: total de horas registradas no ServiceOrderWorker.
    avg_hours_per_order = total_hours / distinct_orders.
    Filtro opcional por Employee.department.
    """
    date_filters = [
        ServiceOrder.entry_time >= start_date,
        ServiceOrder.entry_time <= end_date,
    ]
    if store_id is not None:
        date_filters.append(ServiceOrder.store_id == store_id)
    if is_galpon_profile_user(user):
        date_filters.append(ServiceOrder.is_galpon.is_(True))
    emp_filters = []
    if department is not None:
        emp_filters.append(Employee.department == department)

    q = (
        select(
            Employee.id.label("employee_id"),
            Employee.name.label("employee_name"),
            Employee.department.label("department"),
            func.count(ServiceOrderWorker.service_order_id.distinct()).label("orders_count"),
            func.coalesce(func.sum(ServiceOrderWorker.hours_worked), 0).label("hours_worked"),
        )
        .join(ServiceOrderWorker, ServiceOrderWorker.employee_id == Employee.id)
        .join(ServiceOrder, ServiceOrder.id == ServiceOrderWorker.service_order_id)
        .where(*date_filters, *emp_filters)
        .group_by(Employee.id, Employee.name, Employee.department)
        .order_by(func.count(ServiceOrderWorker.service_order_id.distinct()).desc())
        .limit(limit)
    )

    rows = (await db.execute(q)).all()
    result: list[EmployeeRankingItem] = []
    for row in rows:
        orders_count = int(row.orders_count or 0)
        hours_worked = float(row.hours_worked or 0)
        avg_hours = round(hours_worked / orders_count, 2) if orders_count > 0 else 0.0
        result.append(
            EmployeeRankingItem(
                employee_id=row.employee_id,
                employee_name=row.employee_name,
                department=row.department,
                orders_count=orders_count,
                hours_worked=hours_worked,
                avg_hours_per_order=avg_hours,
            )
        )
    return result


async def get_consultants_ranking(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    limit: int = 10,
    store_id: int | None = None,
) -> list[ConsultantRankingItem]:
    """
    Ranking de consultores por receita no período.

    Receita exclui O.S. com is_courtesy=True.
    LEFT JOIN em Dealership para pegar dealership_name (pode ser None).
    """
    date_filters = [
        ServiceOrder.entry_time >= start_date,
        ServiceOrder.entry_time <= end_date,
        ServiceOrder.is_courtesy == False,  # noqa: E712
        ServiceOrder.consultant_id.isnot(None),
    ]
    if store_id is not None:
        date_filters.append(ServiceOrder.store_id == store_id)
    if is_galpon_profile_user(user):
        date_filters.append(ServiceOrder.is_galpon.is_(True))

    q = (
        select(
            Consultant.id.label("consultant_id"),
            Consultant.name.label("consultant_name"),
            Dealership.name.label("dealership_name"),
            func.count(ServiceOrder.id).label("orders_count"),
            func.coalesce(
                func.sum(ServiceOrderItem.unit_price * ServiceOrderItem.quantity), 0
            ).label("revenue"),
        )
        .join(ServiceOrder, ServiceOrder.consultant_id == Consultant.id)
        .outerjoin(Dealership, Dealership.id == Consultant.dealership_id)
        .outerjoin(ServiceOrderItem, ServiceOrderItem.service_order_id == ServiceOrder.id)
        .where(*date_filters)
        .group_by(Consultant.id, Consultant.name, Dealership.name)
        .order_by(func.sum(ServiceOrderItem.unit_price * ServiceOrderItem.quantity).desc())
        .limit(limit)
    )

    rows = (await db.execute(q)).all()
    return [
        ConsultantRankingItem(
            consultant_id=row.consultant_id,
            consultant_name=row.consultant_name,
            dealership_name=row.dealership_name,
            orders_count=int(row.orders_count or 0),
            revenue=float(row.revenue or 0),
        )
        for row in rows
    ]


async def get_sla_metrics(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    store_id: int | None = None,
) -> SLAMetrics:
    """
    Métricas de SLA para O.S. no período.

    Tempos calculados em Python para compatibilidade SQLite/PostgreSQL:
    - avg_wait_minutes: entry_time → start_time
    - avg_execution_minutes: start_time → completion_time
    - pct_return/courtesy/galpon: em relação ao total de O.S.
    """
    date_filters = [
        ServiceOrder.entry_time >= start_date,
        ServiceOrder.entry_time <= end_date,
    ]
    if store_id is not None:
        date_filters.append(ServiceOrder.store_id == store_id)
    if is_galpon_profile_user(user):
        date_filters.append(ServiceOrder.is_galpon.is_(True))

    # Fetch all O.S. time fields + boolean flags
    q = select(
        ServiceOrder.entry_time,
        ServiceOrder.start_time,
        ServiceOrder.completion_time,
        ServiceOrder.is_return,
        ServiceOrder.is_courtesy,
        ServiceOrder.is_galpon,
    ).where(*date_filters)

    rows = (await db.execute(q)).all()
    total = len(rows)

    def _minutes(a: datetime | None, b: datetime | None) -> float | None:
        if a is None or b is None:
            return None
        diff = b - a
        return diff.total_seconds() / 60.0

    wait_minutes: list[float] = []
    execution_minutes: list[float] = []
    return_count = 0
    courtesy_count = 0
    galpon_count = 0

    for row in rows:
        m = _minutes(row.entry_time, row.start_time)
        if m is not None:
            wait_minutes.append(m)

        m = _minutes(row.start_time, row.completion_time)
        if m is not None:
            execution_minutes.append(m)

        if row.is_return:
            return_count += 1
        if row.is_courtesy:
            courtesy_count += 1
        if row.is_galpon:
            galpon_count += 1

    def _avg(lst: list[float]) -> float:
        return round(sum(lst) / len(lst), 1) if lst else 0.0

    def _pct(count: int, total: int) -> float:
        return round(count / total * 100, 2) if total > 0 else 0.0

    return SLAMetrics(
        avg_wait_minutes=_avg(wait_minutes),
        avg_execution_minutes=_avg(execution_minutes),
        pct_return=_pct(return_count, total),
        pct_courtesy=_pct(courtesy_count, total),
        pct_galpon=_pct(galpon_count, total),
    )


async def get_live_queue(
    db: AsyncSession,
    user: User,
    store_id: int | None = None,
) -> list[QueueSnapshotItem]:
    """
    Snapshot ao vivo da fila de atendimento.

    Uma linha por loja com contagens de:
    - waiting: O.S. aguardando
    - in_progress: O.S. em andamento
    - overdue: in_progress E start_time <= NOW() - 3h
    - completed: O.S. concluídas hoje (desde meia-noite UTC)

    Retorna todas as lojas (inclusive sem O.S. ativa).
    """
    now = datetime.now(tz=UTC)
    overdue_threshold = now - timedelta(hours=3)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    _is_galpon = is_galpon_profile_user(user)

    # Aggregate active O.S. per store using case() for SQLite/PostgreSQL compatibility
    q_filters = [ServiceOrder.status.in_(["waiting", "in_progress"])]
    if store_id is not None:
        q_filters.append(ServiceOrder.store_id == store_id)
    if _is_galpon:
        q_filters.append(ServiceOrder.is_galpon.is_(True))

    q = (
        select(
            ServiceOrder.store_id.label("store_id"),
            func.sum(case((ServiceOrder.status == "waiting", 1), else_=0)).label("waiting"),
            func.sum(case((ServiceOrder.status == "in_progress", 1), else_=0)).label("in_progress"),
        )
        .where(*q_filters)
        .group_by(ServiceOrder.store_id)
    )

    # Overdue: in_progress AND start_time <= threshold
    overdue_filters = [
        ServiceOrder.status == "in_progress",
        ServiceOrder.start_time.isnot(None),
        ServiceOrder.start_time <= overdue_threshold,
    ]
    if store_id is not None:
        overdue_filters.append(ServiceOrder.store_id == store_id)
    if _is_galpon:
        overdue_filters.append(ServiceOrder.is_galpon.is_(True))

    overdue_q = (
        select(
            ServiceOrder.store_id.label("store_id"),
            func.count(ServiceOrder.id).label("overdue"),
        )
        .where(*overdue_filters)
        .group_by(ServiceOrder.store_id)
    )

    # Completed today: status='completed' AND completion_time >= today midnight UTC
    completed_filters = [
        ServiceOrder.status == "completed",
        ServiceOrder.completion_time.isnot(None),
        ServiceOrder.completion_time >= today_start,
    ]
    if store_id is not None:
        completed_filters.append(ServiceOrder.store_id == store_id)
    if _is_galpon:
        completed_filters.append(ServiceOrder.is_galpon.is_(True))

    completed_q = (
        select(
            ServiceOrder.store_id.label("store_id"),
            func.count(ServiceOrder.id).label("completed"),
        )
        .where(*completed_filters)
        .group_by(ServiceOrder.store_id)
    )

    active_rows = (await db.execute(q)).all()
    overdue_rows = (await db.execute(overdue_q)).all()
    completed_rows = (await db.execute(completed_q)).all()
    overdue_map: dict[int, int] = {r.store_id: int(r.overdue) for r in overdue_rows}
    completed_map: dict[int, int] = {r.store_id: int(r.completed) for r in completed_rows}

    active_store_ids = {r.store_id for r in active_rows}
    active_map = {r.store_id: r for r in active_rows}

    # Fetch all stores
    stores_q = select(Store.id, Store.name).order_by(Store.name)
    all_stores = (await db.execute(stores_q)).all()
    if store_id is not None:
        all_stores = [s for s in all_stores if s.id == store_id]

    result: list[QueueSnapshotItem] = []
    for store_row in all_stores:
        if store_row.id in active_store_ids:
            ar = active_map[store_row.id]
            result.append(
                QueueSnapshotItem(
                    store_id=store_row.id,
                    store_name=store_row.name,
                    waiting=int(ar.waiting or 0),
                    in_progress=int(ar.in_progress or 0),
                    overdue=overdue_map.get(store_row.id, 0),
                    completed=completed_map.get(store_row.id, 0),
                )
            )
        else:
            result.append(
                QueueSnapshotItem(
                    store_id=store_row.id,
                    store_name=store_row.name,
                    waiting=0,
                    in_progress=0,
                    overdue=0,
                    completed=completed_map.get(store_row.id, 0),
                )
            )
    return result


async def get_timeseries(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    granularity: Literal["day", "week", "month"] = "month",
    store_id: int | None = None,
) -> list[TimeSeriesPoint]:
    """
    Série temporal de O.S. e receita no período.

    Granularidade:
    - day: YYYY-MM-DD
    - week: IYYY-IW
    - month: YYYY-MM

    Receita exclui O.S. com is_courtesy=True.
    """
    fmt_map = {
        "day": "YYYY-MM-DD",
        "week": "IYYY-IW",
        "month": "YYYY-MM",
    }
    fmt_str = fmt_map[granularity]
    fmt = text(f"'{fmt_str}'")

    date_label = func.to_char(ServiceOrder.entry_time, fmt).label("date")

    ts_filters = [
        ServiceOrder.entry_time >= start_date,
        ServiceOrder.entry_time <= end_date,
    ]
    if store_id is not None:
        ts_filters.append(ServiceOrder.store_id == store_id)
    if is_galpon_profile_user(user):
        ts_filters.append(ServiceOrder.is_galpon.is_(True))

    q = (
        select(
            date_label,
            func.count(ServiceOrder.id).label("orders_count"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            ServiceOrder.is_courtesy == False,  # noqa: E712
                            ServiceOrderItem.unit_price * ServiceOrderItem.quantity,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("revenue"),
        )
        .outerjoin(ServiceOrderItem, ServiceOrderItem.service_order_id == ServiceOrder.id)
        .where(*ts_filters)
        .group_by(func.to_char(ServiceOrder.entry_time, fmt))
        .order_by(func.to_char(ServiceOrder.entry_time, fmt))
    )

    rows = (await db.execute(q)).all()
    return [
        TimeSeriesPoint(
            date=row.date,
            orders_count=int(row.orders_count),
            revenue=float(row.revenue),
        )
        for row in rows
    ]


async def get_timeseries_by_type(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    granularity: Literal["day", "week", "month"] = "month",
    store_id: int | None = None,
) -> list[TimeSeriesByTypePoint]:
    """
    Série temporal de O.S. agrupada por tipo: Película (film + security_film),
    PPF (ppf) e Estética (demais).

    Granularidade: day/week/month — mesmo comportamento do get_timeseries.
    """
    fmt_map = {
        "day": "YYYY-MM-DD",
        "week": "IYYY-IW",
        "month": "YYYY-MM",
    }
    fmt_str = fmt_map[granularity]
    fmt = text(f"'{fmt_str}'")

    date_label = func.to_char(ServiceOrder.entry_time, fmt).label("date")

    ts_filters = [
        ServiceOrder.entry_time >= start_date,
        ServiceOrder.entry_time <= end_date,
    ]
    if store_id is not None:
        ts_filters.append(ServiceOrder.store_id == store_id)
    if is_galpon_profile_user(user):
        ts_filters.append(ServiceOrder.is_galpon.is_(True))

    q = (
        select(
            date_label,
            func.sum(
                case((ServiceOrder.department.in_(["film", "security_film"]), 1), else_=0)
            ).label("film_count"),
            func.sum(case((ServiceOrder.department == "ppf", 1), else_=0)).label("ppf_count"),
            func.sum(
                case(
                    (ServiceOrder.department.notin_(["film", "security_film", "ppf"]), 1),
                    else_=0,
                )
            ).label("estetica_count"),
        )
        .where(*ts_filters)
        .group_by(func.to_char(ServiceOrder.entry_time, fmt))
        .order_by(func.to_char(ServiceOrder.entry_time, fmt))
    )

    rows = (await db.execute(q)).all()
    return [
        TimeSeriesByTypePoint(
            date=row.date,
            film_count=int(row.film_count or 0),
            ppf_count=int(row.ppf_count or 0),
            estetica_count=int(row.estetica_count or 0),
        )
        for row in rows
    ]


async def get_film_ppf_ranking(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    store_id: int | None = None,
) -> list[FilmPpfStoreRankingItem]:
    """
    Ranking de lojas para O.S. dos departamentos Película (film) e PPF.

    Colunas: loja, qtd O.S., receita (excl. cortesia), feitos em loja (is_galpon=False),
    feitos em galpão (is_galpon=True).
    """
    date_filters = [
        ServiceOrder.entry_time >= start_date,
        ServiceOrder.entry_time <= end_date,
        ServiceOrder.department.in_(["film", "security_film", "ppf"]),
    ]
    if store_id is not None:
        date_filters.append(ServiceOrder.store_id == store_id)
    if is_galpon_profile_user(user):
        date_filters.append(ServiceOrder.is_galpon.is_(True))

    q = (
        select(
            ServiceOrder.store_id.label("store_id"),
            Store.name.label("store_name"),
            func.count(ServiceOrder.id.distinct()).label("orders_count"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            ServiceOrder.is_courtesy == False,  # noqa: E712
                            ServiceOrderItem.unit_price * ServiceOrderItem.quantity,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("revenue"),
            func.sum(
                case((ServiceOrder.is_galpon == False, 1), else_=0)  # noqa: E712
            ).label("loja_count"),
            func.sum(
                case((ServiceOrder.is_galpon == True, 1), else_=0)  # noqa: E712
            ).label("galpon_count"),
        )
        .join(Store, Store.id == ServiceOrder.store_id)
        .outerjoin(ServiceOrderItem, ServiceOrderItem.service_order_id == ServiceOrder.id)
        .where(*date_filters)
        .group_by(ServiceOrder.store_id, Store.name)
        .order_by(func.count(ServiceOrder.id.distinct()).desc())
    )

    rows = (await db.execute(q)).all()
    return [
        FilmPpfStoreRankingItem(
            store_id=row.store_id,
            store_name=row.store_name,
            orders_count=int(row.orders_count or 0),
            revenue=float(row.revenue or 0),
            loja_count=int(row.loja_count or 0),
            galpon_count=int(row.galpon_count or 0),
        )
        for row in rows
    ]
