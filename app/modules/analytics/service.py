"""
Analytics service - Business logic for analytics and BI queries.
"""

from datetime import date, datetime, timedelta
from typing import Literal

from sqlalchemy import and_, case, func, literal, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import is_galpon_profile_user
from app.modules.analytics.indicators_pdf import (
    DEPARTMENT_LABELS,
    FiltersLabel,
    format_period_label,
    join_or_default,
)
from app.modules.analytics.schemas import (
    CommercialPerformanceItem,
    DashboardOverview,
    DealershipRankingItem,
    DepartmentBreakdownItem,
    EmployeeRankingItem,
    EntriesVsConsumptionPoint,
    FilmPpfStoreRankingItem,
    FinancialEvolutionPoint,
    FinancialHealth,
    FinancialKpis,
    InventoryKpis,
    KPIComparison,
    KPIValue,
    ProfitabilityItem,
    ProfitabilityResponse,
    ProfitabilityTotal,
    RevenueForecast,
    RevenueGoal,
    ServiceRankingItem,
    SLAMetrics,
    StockHealth,
    StockHealthBucket,
    StoreRankingItem,
    TimeSeriesByTypePoint,
    TimeSeriesPoint,
)
from app.modules.auth.models import User
from app.modules.brands.models import Brand
from app.modules.dealerships.models import Dealership
from app.modules.employees.models import Employee
from app.modules.employees.service import installer_position_condition
from app.modules.inventory.models import FilmConsumption, FilmRoll, FilmType
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem
from app.modules.services.models import Service
from app.modules.settings import service as settings_service
from app.modules.stores.models import Store

# Família de departamentos de película para os Indicadores (film + security_film + ppf).
FILM_DEPARTMENTS = ["film", "security_film", "ppf"]

# Sentinela de film_type_id para o grupo "Retalho" na Rentabilidade (E2) —
# nunca colide com um FilmType.id real (sempre positivo) nem com o None de
# item sem tipo resolvido. Retalho não tem film_type_id nem
# scrap_source_roll_id preenchidos de forma confiável, então não dá pra
# resolver um tipo real — agrupa tudo sob um rótulo fixo.
RETALHO_FILM_TYPE_ID = -1

# Status sempre fora de produção/receita.
CANCELLED_STATUS = "cancelled"
# Status "inválidos" que só contam QUANDO CONFERIDOS: duplicidade/erro
# conferido é valor a receber que é cobrado e sobe pro Fechamento (mesma regra
# do extrato financeiro do Fechamento). Não conferidos ficam de fora.
INVALID_UNLESS_VERIFIED = ("wrong", "duplicate")

# =============================================================================
# Helpers
# =============================================================================


def _normalize_period(start_date: datetime, end_date: datetime) -> tuple[datetime, datetime]:
    """
    Garante que o período cubra o último dia inteiro.

    O frontend envia end_date como data pura (YYYY-MM-DD), que o FastAPI
    interpreta como meia-noite — sem isso, o último dia ficaria fora de
    todas as métricas (mesmo padrão de service_orders/service.py).
    """
    if (
        end_date.hour == 0
        and end_date.minute == 0
        and end_date.second == 0
        and end_date.microsecond == 0
    ):
        end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)
    return start_date, end_date


def _period_date_filter(start_date: datetime, end_date: datetime):
    """
    Filtro de período canônico do Dashboard.

    Conta a O.S. pela data em que o serviço foi de fato executado
    (``service_date``), caindo para ``entry_time`` apenas quando ``service_date``
    é nulo. Alinha o Dashboard à Conferência e ao Resumo Diário: O.S. lançadas
    retroativamente (serviço num mês, cadastro em outro) entram no mês do
    SERVIÇO — não no do cadastro.
    """
    return or_(
        and_(
            ServiceOrder.service_date.is_(None),
            ServiceOrder.entry_time >= start_date,
            ServiceOrder.entry_time <= end_date,
        ),
        and_(
            ServiceOrder.service_date >= start_date.date(),
            ServiceOrder.service_date <= end_date.date(),
        ),
    )


def _period_bucket_date():
    """
    Expressão de data para agrupar séries temporais — mesma regra de
    :func:`_period_date_filter` (``service_date`` com fallback para ``entry_time``).
    """
    return func.coalesce(ServiceOrder.service_date, ServiceOrder.entry_time)


def _production_filter():
    """
    Filtro de O.S. que contam como produção/receita no Dashboard.

    Regra alinhada ao Fechamento: cancelada NUNCA conta; ``wrong``/``duplicate``
    contam APENAS quando conferidas (``is_verified``) — duplicidade/erro
    conferido é valor a receber que é cobrado e sobe pro Fechamento. As não
    conferidas ficam de fora.
    """
    return and_(
        ServiceOrder.status != CANCELLED_STATUS,
        or_(
            ServiceOrder.status.notin_(INVALID_UNLESS_VERIFIED),
            ServiceOrder.is_verified.is_(True),
        ),
    )


def _delta(current: float, previous: float) -> float | None:
    """Calcula delta percentual. Retorna None quando previous == 0."""
    if previous == 0:
        return None
    return round((current - previous) / previous * 100, 1)


def _kpi(current: float, previous: float) -> KPIComparison:
    """Monta KPIComparison com delta calculado."""
    return KPIComparison(current=current, previous=previous, delta_pct=_delta(current, previous))


def _prev_period(start_date: datetime, end_date: datetime) -> tuple[datetime, datetime]:
    """Calcula o período imediatamente anterior com a mesma duração, sem gap."""
    duration = end_date - start_date
    prev_end = start_date - timedelta(microseconds=1)
    prev_start = prev_end - duration
    return prev_start, prev_end


def _resolve_compare_period(
    start_date: datetime,
    end_date: datetime,
    compare_start_date: datetime | None,
    compare_end_date: datetime | None,
) -> tuple[datetime, datetime]:
    """
    Período de comparação dos KPIs. Quando o usuário escolhe um mês livre em
    "Comparar com", vêm ``compare_start_date``/``compare_end_date`` e são usados
    tal e qual (normalizados para cobrir o último dia inteiro). Sem eles, cai no
    comportamento padrão: período imediatamente anterior de mesma duração
    (``_prev_period``).
    """
    if compare_start_date is not None and compare_end_date is not None:
        return _normalize_period(compare_start_date, compare_end_date)
    return _prev_period(start_date, end_date)


async def _period_stats(
    db: AsyncSession,
    start_date: datetime,
    end_date: datetime,
    store_id: int | None,
    is_galpon: bool = False,
) -> dict:
    """
    Computa estatísticas para um período específico:
    - revenue (excluindo cortesia e retorno — não são cobrados)
    - total_orders
    - completed_orders (status=completed)
    - courtesy_count
    - galpon_count
    - return_count
    """
    base_filters = [
        _period_date_filter(start_date, end_date),
        _production_filter(),
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
        func.sum(
            case((ServiceOrder.is_verified == True, 1), else_=0)  # noqa: E712
        ).label("verified"),
    ).where(*base_filters)

    row = (await db.execute(counts_q)).one()
    total = int(row.total or 0)
    completed = int(row.completed or 0)
    courtesy = int(row.courtesy or 0)
    galpon = int(row.galpon or 0)
    ret = int(row.ret or 0)
    verified = int(row.verified or 0)

    # Revenue: sum(unit_price * quantity) where is_courtesy=False
    revenue_q = (
        select(func.coalesce(func.sum(ServiceOrderItem.unit_price * ServiceOrderItem.quantity), 0))
        .join(ServiceOrder, ServiceOrderItem.service_order_id == ServiceOrder.id)
        .where(
            *base_filters,
            ServiceOrder.is_courtesy == False,  # noqa: E712
            ServiceOrder.is_return == False,  # noqa: E712
        )
    )
    revenue = float((await db.execute(revenue_q)).scalar() or 0)

    return {
        "revenue": revenue,
        "total": total,
        "completed": completed,
        "courtesy": courtesy,
        "galpon": galpon,
        "return": ret,
        "verified": verified,
    }


# =============================================================================
# Dashboard Executivo
# =============================================================================


async def _count_meta_employees(db: AsyncSession, user: User, store_id: int | None) -> int:
    """
    Nº de funcionários que entram na meta: ativos, SEM instaladores (cargo).
    Respeita o escopo: loja selecionada, ou galpão para perfil de galpão, ou
    todas as lojas quando nenhum filtro se aplica.
    """
    query = select(func.count(Employee.id)).where(
        Employee.is_active.is_(True),
        Employee.hr_status == "active",
        ~installer_position_condition(),
    )
    if is_galpon_profile_user(user):
        query = query.where(Employee.works_in_galpon.is_(True))
    elif store_id is not None:
        query = query.where(Employee.store_id == store_id)
    return int((await db.execute(query)).scalar() or 0)


def _build_revenue_goal(
    goals: dict[str, float], employee_count: int, revenue: float
) -> RevenueGoal:
    """Monta o estado da meta (tiers absolutos, meta batida, próxima e progresso)."""
    per_employee = [goals["tier_1"], goals["tier_2"], goals["tier_3"]]
    targets = [round(p * employee_count, 2) for p in per_employee]

    positive = [(i, t) for i, t in enumerate(targets) if t > 0]
    reached_tier = sum(1 for _, t in positive if revenue >= t)
    next_item = next(((i, t) for i, t in positive if revenue < t), None)

    if next_item is None:
        next_tier: int | None = None
        next_target: float | None = None
        remaining: float | None = None
        progress = 100.0 if positive else 0.0
    else:
        idx, tgt = next_item
        next_tier = idx + 1
        next_target = tgt
        remaining = round(max(0.0, tgt - revenue), 2)
        progress = round(revenue / tgt * 100, 1) if tgt > 0 else 0.0

    return RevenueGoal(
        employee_count=employee_count,
        per_employee=per_employee,
        targets=targets,
        revenue=round(revenue, 2),
        reached_tier=reached_tier,
        next_tier=next_tier,
        next_target=next_target,
        remaining=remaining,
        progress_pct=progress,
    )


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
    - revenue: receita (excluindo cortesia e retorno — não são cobrados)
    - total_orders: total de O.S.
    - completed_orders: O.S. entregues
    - avg_ticket: ticket médio
    - completion_rate: % de O.S. entregues
    - pct_courtesy: % de O.S. cortesia
    - pct_galpon: % de O.S. galpão
    - pct_return: % de O.S. retorno
    """
    start_date, end_date = _normalize_period(start_date, end_date)
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

    goals = await settings_service.get_revenue_goals(db)
    employee_count = await _count_meta_employees(db, user, store_id)
    revenue_goal = _build_revenue_goal(goals, employee_count, curr["revenue"])

    return DashboardOverview(
        revenue=_kpi(curr["revenue"], prev["revenue"]),
        total_orders=_kpi(float(curr["total"]), float(prev["total"])),
        completed_orders=_kpi(float(curr["completed"]), float(prev["completed"])),
        verified_orders=_kpi(float(curr["verified"]), float(prev["verified"])),
        avg_ticket=_kpi(curr_avg, prev_avg),
        completion_rate=_kpi(curr_rate, prev_rate),
        pct_courtesy=_kpi(curr_crt, prev_crt),
        pct_galpon=_kpi(curr_glp, prev_glp),
        pct_return=_kpi(curr_ret, prev_ret),
        revenue_goal=revenue_goal,
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

    Receita exclui O.S. com is_courtesy=True ou is_return=True (não são cobradas).
    completion_rate = completed_count / total_count * 100 por loja.
    pct_return = O.S. de retorno / total * 100 por loja.
    """
    start_date, end_date = _normalize_period(start_date, end_date)
    date_filters = [
        _period_date_filter(start_date, end_date),
        _production_filter(),
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
                            (ServiceOrder.is_courtesy == False)  # noqa: E712
                            & (ServiceOrder.is_return == False),  # noqa: E712
                            ServiceOrderItem.unit_price * ServiceOrderItem.quantity,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("revenue"),
            # count(distinct id) apenas das O.S. de retorno (case sem else → NULL)
            func.count(
                func.distinct(
                    case((ServiceOrder.is_return == True, ServiceOrder.id))  # noqa: E712
                )
            ).label("return_count"),
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
        return_count = int(row.return_count or 0)
        avg_ticket = round(revenue / orders_count, 2) if orders_count > 0 else 0.0
        completion_rate = round(completed / orders_count * 100, 2) if orders_count > 0 else 0.0
        pct_return = round(return_count / orders_count * 100, 2) if orders_count > 0 else 0.0

        result.append(
            StoreRankingItem(
                store_id=row.store_id,
                store_name=row.store_name,
                revenue=revenue,
                orders_count=orders_count,
                avg_ticket=avg_ticket,
                completion_rate=completion_rate,
                pct_return=pct_return,
            )
        )

    result.sort(key=lambda x: (-x.revenue, x.store_name))
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

    Receita exclui O.S. com is_courtesy=True ou is_return=True (não são cobradas).
    Filtro opcional por departamento.
    """
    start_date, end_date = _normalize_period(start_date, end_date)
    date_filters = [
        _period_date_filter(start_date, end_date),
        _production_filter(),
        ServiceOrder.is_courtesy == False,  # noqa: E712
        ServiceOrder.is_return == False,  # noqa: E712
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
        .order_by(
            func.sum(ServiceOrderItem.unit_price * ServiceOrderItem.quantity).desc(),
            Service.name.asc(),
        )
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
    Receita exclui cortesia e retorno (não são cobrados).
    """
    start_date, end_date = _normalize_period(start_date, end_date)
    date_filters = [
        _period_date_filter(start_date, end_date),
        _production_filter(),
    ]
    if store_id is not None:
        date_filters.append(ServiceOrder.store_id == store_id)
    if is_galpon_profile_user(user):
        date_filters.append(ServiceOrder.is_galpon.is_(True))

    q = (
        select(
            ServiceOrder.department.label("department"),
            # distinct: o outerjoin com itens multiplicaria a contagem por item
            func.count(func.distinct(ServiceOrder.id)).label("count"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            (ServiceOrder.is_courtesy == False)  # noqa: E712
                            & (ServiceOrder.is_return == False),  # noqa: E712
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
        .order_by(func.count(func.distinct(ServiceOrder.id)).desc(), ServiceOrder.department.asc())
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
    departments: list[str] | None = None,
    limit: int = 10,
    store_id: int | None = None,
) -> list[EmployeeRankingItem]:
    """
    Ranking de funcionários por serviços feitos no período.

    Usa a MESMA régua do módulo Desempenho de Instaladores (só O.S.
    finalizadas, data-base = completion_time, valor repartido entre os K
    instaladores do serviço) para que os números do Dashboard batam com a tela
    de Desempenho. Antes o Dashboard contava O.S. em qualquer status válido por
    entry_time e dava o valor cheio da O.S. nos vínculos legados, o que inflava
    serviços e receita frente ao Desempenho.

    departments: filtra pelo departamento da O.S. EM QUE O TRABALHO FOI FEITO
    (não pelo cadastro do funcionário — instaladores são cadastrados como
    'film' mas trabalham em security_film/ppf).
    """
    from app.modules.installer_performance.service import get_installer_ranking

    start_date, end_date = _normalize_period(start_date, end_date)
    rows = await get_installer_ranking(
        db=db,
        user=user,
        start=start_date.date(),
        end=end_date.date(),
        departments=departments,
        store_id=store_id,
        limit=limit,
    )
    return [
        EmployeeRankingItem(
            employee_id=r["employee_id"],
            employee_name=r["employee_name"],
            department=r["department"],
            orders_count=r["orders_count"],
            services_count=r["services_count"],
            hours_worked=r["hours_worked"],
            avg_hours_per_order=r["avg_hours_per_order"],
            revenue=r["revenue"],
        )
        for r in rows
    ]


async def get_dealerships_ranking(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    limit: int = 10,
    store_id: int | None = None,
) -> list[DealershipRankingItem]:
    """
    Ranking de concessionárias parceiras por receita no período.

    Receita exclui O.S. com is_courtesy=True ou is_return=True (não são cobradas).
    Considera apenas O.S. com dealership_id preenchido.
    """
    start_date, end_date = _normalize_period(start_date, end_date)
    date_filters = [
        _period_date_filter(start_date, end_date),
        _production_filter(),
        ServiceOrder.is_courtesy == False,  # noqa: E712
        ServiceOrder.is_return == False,  # noqa: E712
        ServiceOrder.dealership_id.isnot(None),
    ]
    if store_id is not None:
        date_filters.append(ServiceOrder.store_id == store_id)
    if is_galpon_profile_user(user):
        date_filters.append(ServiceOrder.is_galpon.is_(True))

    q = (
        select(
            Dealership.id.label("dealership_id"),
            Dealership.name.label("dealership_name"),
            # distinct: o outerjoin com itens multiplicaria a contagem por item
            func.count(func.distinct(ServiceOrder.id)).label("orders_count"),
            func.coalesce(
                func.sum(ServiceOrderItem.unit_price * ServiceOrderItem.quantity), 0
            ).label("revenue"),
        )
        .join(ServiceOrder, ServiceOrder.dealership_id == Dealership.id)
        .outerjoin(ServiceOrderItem, ServiceOrderItem.service_order_id == ServiceOrder.id)
        .where(*date_filters)
        .group_by(Dealership.id, Dealership.name)
        .order_by(
            func.sum(ServiceOrderItem.unit_price * ServiceOrderItem.quantity).desc(),
            Dealership.name.asc(),
        )
        .limit(limit)
    )

    rows = (await db.execute(q)).all()
    result: list[DealershipRankingItem] = []
    for row in rows:
        orders_count = int(row.orders_count or 0)
        revenue = float(row.revenue or 0)
        avg_ticket = round(revenue / orders_count, 2) if orders_count > 0 else 0.0
        result.append(
            DealershipRankingItem(
                dealership_id=row.dealership_id,
                dealership_name=row.dealership_name,
                orders_count=orders_count,
                revenue=revenue,
                avg_ticket=avg_ticket,
            )
        )
    return result


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
    - avg_execution_minutes: start_time → completion_time (apenas O.S. concluídas)
    - pct_return/courtesy/galpon: em relação ao total de O.S. válidas
    """
    start_date, end_date = _normalize_period(start_date, end_date)
    date_filters = [
        _period_date_filter(start_date, end_date),
        _production_filter(),
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
        ServiceOrder.status,
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

        # Execução só conta O.S. de fato concluídas — evita timestamps
        # residuais de O.S. que mudaram de rumo no meio do fluxo.
        if row.status == "completed":
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

    Receita exclui O.S. com is_courtesy=True ou is_return=True (não são cobradas).
    """
    start_date, end_date = _normalize_period(start_date, end_date)
    fmt_map = {
        "day": "YYYY-MM-DD",
        "week": "IYYY-IW",
        "month": "YYYY-MM",
    }
    fmt_str = fmt_map[granularity]
    fmt = text(f"'{fmt_str}'")

    bucket_date = _period_bucket_date()
    date_label = func.to_char(bucket_date, fmt).label("date")

    ts_filters = [
        _period_date_filter(start_date, end_date),
        _production_filter(),
    ]
    if store_id is not None:
        ts_filters.append(ServiceOrder.store_id == store_id)
    if is_galpon_profile_user(user):
        ts_filters.append(ServiceOrder.is_galpon.is_(True))

    q = (
        select(
            date_label,
            # distinct: o outerjoin com itens multiplicaria a contagem por item
            func.count(func.distinct(ServiceOrder.id)).label("orders_count"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            (ServiceOrder.is_courtesy == False)  # noqa: E712
                            & (ServiceOrder.is_return == False),  # noqa: E712
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
        .group_by(func.to_char(bucket_date, fmt))
        .order_by(func.to_char(bucket_date, fmt))
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
    start_date, end_date = _normalize_period(start_date, end_date)
    fmt_map = {
        "day": "YYYY-MM-DD",
        "week": "IYYY-IW",
        "month": "YYYY-MM",
    }
    fmt_str = fmt_map[granularity]
    fmt = text(f"'{fmt_str}'")

    bucket_date = _period_bucket_date()
    date_label = func.to_char(bucket_date, fmt).label("date")

    ts_filters = [
        _period_date_filter(start_date, end_date),
        _production_filter(),
    ]
    if store_id is not None:
        ts_filters.append(ServiceOrder.store_id == store_id)
    if is_galpon_profile_user(user):
        ts_filters.append(ServiceOrder.is_galpon.is_(True))

    is_film = ServiceOrder.department.in_(["film", "security_film"])
    is_ppf = ServiceOrder.department == "ppf"
    is_estetica = ServiceOrder.department.notin_(["film", "security_film", "ppf"])
    item_value = ServiceOrderItem.unit_price * ServiceOrderItem.quantity
    not_courtesy = ServiceOrder.is_courtesy == False  # noqa: E712
    not_return = ServiceOrder.is_return == False  # noqa: E712

    def _type_revenue(type_cond):
        # Receita por tipo: soma dos itens sem cortesia nem retorno (não são
        # cobrados) — mesma regra do get_timeseries. Contagens não são afetadas.
        return func.coalesce(
            func.sum(case((type_cond & not_courtesy & not_return, item_value), else_=0)), 0
        )

    q = (
        select(
            date_label,
            # count(distinct) por tipo: o outerjoin com itens multiplicaria a contagem
            func.count(func.distinct(case((is_film, ServiceOrder.id)))).label("film_count"),
            func.count(func.distinct(case((is_ppf, ServiceOrder.id)))).label("ppf_count"),
            func.count(func.distinct(case((is_estetica, ServiceOrder.id)))).label("estetica_count"),
            _type_revenue(is_film).label("film_revenue"),
            _type_revenue(is_ppf).label("ppf_revenue"),
            _type_revenue(is_estetica).label("estetica_revenue"),
        )
        .outerjoin(ServiceOrderItem, ServiceOrderItem.service_order_id == ServiceOrder.id)
        .where(*ts_filters)
        .group_by(func.to_char(bucket_date, fmt))
        .order_by(func.to_char(bucket_date, fmt))
    )

    rows = (await db.execute(q)).all()
    return [
        TimeSeriesByTypePoint(
            date=row.date,
            film_count=int(row.film_count or 0),
            ppf_count=int(row.ppf_count or 0),
            estetica_count=int(row.estetica_count or 0),
            film_revenue=float(row.film_revenue or 0),
            ppf_revenue=float(row.ppf_revenue or 0),
            estetica_revenue=float(row.estetica_revenue or 0),
        )
        for row in rows
    ]


async def get_revenue_forecast(
    db: AsyncSession,
    user: User,
    store_id: int | None = None,
    today: date | None = None,
) -> RevenueForecast:
    """
    Projeção de faturamento do MÊS CORRENTE por run-rate de dias úteis:
    receita do mês até hoje ÷ dias úteis decorridos × dias úteis totais.

    Dias úteis = seg–sex menos feriados (mesma régua do Resumo Diário;
    sem loja selecionada valem apenas os feriados globais). O card ignora
    o filtro de período do dashboard de propósito — previsão é do mês.
    """
    import calendar

    from app.modules.holidays.service import get_holiday_dates_for_store

    today = today or datetime.now().date()
    month_start = today.replace(day=1)
    last_day = calendar.monthrange(today.year, today.month)[1]
    month_end = date(today.year, today.month, last_day)

    holidays = await get_holiday_dates_for_store(db, store_id, month_start, month_end)
    holiday_dates = {h.date for h in holidays}
    business_days = [
        d
        for d in (month_start + timedelta(days=i) for i in range(last_day))
        if d.weekday() <= 4 and d not in holiday_dates  # 0=seg ... 4=sex (exclui sáb/dom)
    ]
    elapsed = [d for d in business_days if d <= today]

    rev_filters = [
        _period_date_filter(
            datetime.combine(month_start, datetime.min.time()),
            datetime.combine(today, datetime.max.time()),
        ),
        _production_filter(),
        ServiceOrder.is_courtesy == False,  # noqa: E712
        ServiceOrder.is_return == False,  # noqa: E712
    ]
    if store_id is not None:
        rev_filters.append(ServiceOrder.store_id == store_id)
    if is_galpon_profile_user(user):
        rev_filters.append(ServiceOrder.is_galpon.is_(True))

    q = (
        select(func.coalesce(func.sum(ServiceOrderItem.unit_price * ServiceOrderItem.quantity), 0))
        .select_from(ServiceOrder)
        .join(ServiceOrderItem, ServiceOrderItem.service_order_id == ServiceOrder.id)
        .where(*rev_filters)
    )
    revenue_so_far = float((await db.execute(q)).scalar() or 0)

    forecast = revenue_so_far / len(elapsed) * len(business_days) if elapsed else revenue_so_far

    return RevenueForecast(
        month=today.strftime("%Y-%m"),
        revenue_so_far=revenue_so_far,
        forecast=round(forecast, 2),
        business_days_elapsed=len(elapsed),
        business_days_total=len(business_days),
    )


async def get_film_ppf_ranking(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    store_id: int | None = None,
) -> list[FilmPpfStoreRankingItem]:
    """
    Ranking de lojas para O.S. dos departamentos Película (film) e PPF.

    Colunas: loja, qtd O.S., receita (excl. cortesia e retorno), feitos em loja (is_galpon=False),
    feitos em galpão (is_galpon=True).
    """
    start_date, end_date = _normalize_period(start_date, end_date)
    date_filters = [
        _period_date_filter(start_date, end_date),
        _production_filter(),
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
            # Serviços = itens das O.S. (uma O.S. com 3 películas = 3 serviços)
            func.count(func.distinct(ServiceOrderItem.id)).label("services_count"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            (ServiceOrder.is_courtesy == False)  # noqa: E712
                            & (ServiceOrder.is_return == False),  # noqa: E712
                            ServiceOrderItem.unit_price * ServiceOrderItem.quantity,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("revenue"),
            # count(distinct id): o outerjoin com itens multiplicaria por item
            func.count(
                func.distinct(
                    case((ServiceOrder.is_galpon == False, ServiceOrder.id))  # noqa: E712
                )
            ).label("loja_count"),
            func.count(
                func.distinct(
                    case((ServiceOrder.is_galpon == True, ServiceOrder.id))  # noqa: E712
                )
            ).label("galpon_count"),
        )
        .join(Store, Store.id == ServiceOrder.store_id)
        .outerjoin(ServiceOrderItem, ServiceOrderItem.service_order_id == ServiceOrder.id)
        .where(*date_filters)
        .group_by(ServiceOrder.store_id, Store.name)
        .order_by(func.count(ServiceOrder.id.distinct()).desc(), Store.name.asc())
    )

    rows = (await db.execute(q)).all()
    return [
        FilmPpfStoreRankingItem(
            store_id=row.store_id,
            store_name=row.store_name,
            orders_count=int(row.orders_count or 0),
            services_count=int(row.services_count or 0),
            revenue=float(row.revenue or 0),
            loja_count=int(row.loja_count or 0),
            galpon_count=int(row.galpon_count or 0),
        )
        for row in rows
    ]


# =============================================================================
# Indicadores de Películas — helpers de escopo
# =============================================================================


def _film_department_filter(departments: list[str] | None):
    """
    Filtro de departamento de O.S. para a família Película. ``departments`` é
    multi-escolha (subconjunto de FILM_DEPARTMENTS); vazio/None = família inteira.
    """
    if departments:
        return ServiceOrder.department.in_(departments)
    return ServiceOrder.department.in_(FILM_DEPARTMENTS)


def _film_type_department_filter(departments: list[str] | None):
    """Mesmo filtro de departamento (multi), para consultas ancoradas em FilmType (estoque)."""
    if departments:
        return FilmType.department.in_(departments)
    return FilmType.department.in_(FILM_DEPARTMENTS)


def _consumption_kind_filter():
    """
    Consumo real (kind='consumo') + consumo LEGADO (kind IS NULL, registros
    anteriores à migration 107, que introduziu a coluna sem backfill) —
    exclui estorno/ajuste/reconciliacao. Mesmo padrão canônico de
    app/modules/inventory/service.py (linha ~2180); sem o `is_(None)` todo
    consumo pré-migration 107 desaparece das métricas (custo/margem/ROI
    inflados por subestimar o custo consumido).
    """
    return or_(FilmConsumption.kind == "consumo", FilmConsumption.kind.is_(None))


def _film_revenue_case():
    """
    Regra C8: valor do item de O.S. só conta como receita quando a O.S. NÃO é
    cortesia e NÃO é retorno (não são cobradas) — senão soma R$0. Centralizado
    aqui para evitar divergência entre as funções de Indicadores que usam a
    mesma regra de receita.
    """
    return case(
        (
            (ServiceOrder.is_courtesy == False) & (ServiceOrder.is_return == False),  # noqa: E712
            ServiceOrderItem.unit_price * ServiceOrderItem.quantity,
        ),
        else_=0,
    )


def _qualifying_film_item_filter():
    """
    Critério ÚNICO de "item qualificado" de película para TODO o módulo de
    Indicadores (E1 applications_count, E2 tabela de Rentabilidade, E5 KPIs
    financeiros, E6 desempenho comercial, E7 saúde financeira, E8 evolução
    financeira) — um ``ServiceOrderItem`` só conta em receita/aplicações do
    módulo se satisfaz PELO MENOS UM:

    1. tem ``FilmConsumption`` vinculado (``service_order_item_id``, kind
       consumo real OU legado — ``_consumption_kind_filter()``), OU
    2. ``film_roll_id IS NOT NULL`` (bobina vinculada mesmo sem consumo
       registrado — ex.: registro legado), OU
    3. ``used_scrap IS TRUE`` (retalho — material já pago quando a bobina
       original foi debitada, não gera nova FilmConsumption).

    Item sem bobina vinculada e que NÃO é retalho não conta em NENHUM
    KPI/tabela do módulo — mesmo critério que decide o "oculto" (excluído)
    da tabela de Rentabilidade (E2). Centralizado aqui para que o KPI
    Faturamento (E5) e as demais telas BATAM com o total da tabela E2 —
    duas implementações independentes do mesmo corte divergiriam com o tempo.
    """
    consumption_exists = (
        select(FilmConsumption.id)
        .where(
            FilmConsumption.service_order_item_id == ServiceOrderItem.id,
            _consumption_kind_filter(),
        )
        .exists()
    )
    return or_(
        ServiceOrderItem.film_roll_id.isnot(None),
        ServiceOrderItem.used_scrap.is_(True),
        consumption_exists,
    )


async def _resolve_effective_store_ids(
    db: AsyncSession, store_ids: list[int] | None, brand_ids: list[int] | None
) -> list[int] | None:
    """
    Resolve o conjunto de lojas em escopo a partir dos filtros multi-escolha
    Marca (``brand_ids``) e Loja (``store_ids``).

    - Só Loja: as lojas escolhidas.
    - Só Marca: todas as lojas dessas marcas (``Store.brand_id``).
    - Ambos: INTERSEÇÃO (loja escolhida QUE seja da marca escolhida) — uma loja
      pertence a exatamente uma marca, então combinar marca+loja restringe.
    - Nenhum: ``None`` (sem filtro de loja — todas).

    Retorna lista (possivelmente VAZIA quando os filtros são contraditórios —
    ex.: marca A + loja da marca B): ``[]`` gera ``IN ()`` → resultado vazio,
    fail-safe coerente.
    """
    brand_store_ids: set[int] | None = None
    if brand_ids:
        rows = (await db.execute(select(Store.id).where(Store.brand_id.in_(brand_ids)))).all()
        brand_store_ids = {r.id for r in rows}
    chosen = set(store_ids) if store_ids else None

    if chosen is not None and brand_store_ids is not None:
        effective = chosen & brand_store_ids
    elif chosen is not None:
        effective = chosen
    elif brand_store_ids is not None:
        effective = brand_store_ids
    else:
        return None
    return sorted(effective)


async def _resolve_galpon_store_id(db: AsyncSession) -> int | None:
    """
    Id da loja que representa o galpão central (nome contém "galpão"/"galpao").

    O modelo não tem flag de loja-galpão nem vínculo O.S.→galpão: uma O.S. de
    galpão carrega apenas ``is_galpon=True`` + a loja de DESTINO em ``store_id``.
    Para os Indicadores atribuírem essa O.S. ao galpão (e não à loja destino),
    resolvemos a loja-galpão pelo nome — hoje só existe "Galpão Central".
    >1 resultado: usa a de menor id (assume galpão único). Nenhum: ``None``
    (sem remap — loja = destino, comportamento legado). Ver ADR 0026.
    """
    rows = (
        (
            await db.execute(
                select(Store.id)
                .where(or_(Store.name.ilike("%galpão%"), Store.name.ilike("%galpao%")))
                .order_by(Store.id)
            )
        )
        .scalars()
        .all()
    )
    return rows[0] if rows else None


def _os_effective_store_expr(galpon_store_id: int | None):
    """
    Loja EFETIVA de uma O.S. nos Indicadores de Películas.

    Uma O.S. de galpão (``is_galpon``) conta para a loja-galpão central (Central
    Galpão), NÃO para a loja de destino — assim o filtro de uma loja real
    (ex.: BYD Unidade 07) mostra só as O.S. dela, e as O.S. de galpão feitas para
    aquela loja aparecem sob a própria loja-galpão. Sem loja-galpão cadastrada
    (``galpon_store_id is None``), mantém o legado: loja = destino. Ver ADR 0026.
    """
    if galpon_store_id is None:
        return ServiceOrder.store_id
    return case(
        (ServiceOrder.is_galpon.is_(True), galpon_store_id),
        else_=ServiceOrder.store_id,
    )


class _Unresolved:
    """Sentinela: distingue ``galpon_store_id`` não informado de ``None`` (sem loja-galpão)."""


_GALPON_UNRESOLVED = _Unresolved()


async def _os_scope_filters(
    db: AsyncSession,
    user: User,
    effective_store_ids: list[int] | None,
    galpon_store_id: int | None | _Unresolved = _GALPON_UNRESOLVED,
) -> list:
    """
    Filtros de escopo para métricas baseadas em O.S., a partir do conjunto de
    lojas já resolvido (Marca+Loja) por :func:`_resolve_effective_store_ids`.

    O escopo de loja usa a LOJA EFETIVA (:func:`_os_effective_store_expr`), de
    modo que O.S. de galpão contam para a loja-galpão e não vazam para a loja
    de destino (ADR 0026). ``galpon_store_id`` pode ser injetado por quem já o
    resolveu (evita 2ª query); omitido, é resolvido aqui só quando há filtro de loja.
    """
    filters: list = []
    if effective_store_ids is not None:
        if isinstance(galpon_store_id, _Unresolved):
            gid = await _resolve_galpon_store_id(db)
        else:
            gid = galpon_store_id
        filters.append(_os_effective_store_expr(gid).in_(effective_store_ids))
    if is_galpon_profile_user(user):
        filters.append(ServiceOrder.is_galpon.is_(True))
    return filters


def _roll_scope_filter(effective_store_ids: list[int] | None):
    """Filtro de escopo (FilmRoll.store_id) a partir do conjunto de lojas resolvido."""
    if effective_store_ids is None:
        return None
    return FilmRoll.store_id.in_(effective_store_ids)


def _combine_roll_type_tonality_filter(
    roll_filter, film_type_ids: list[int] | None, tonalities: list[str] | None
):
    """
    Combina um filtro de escopo de bobina (``FilmRoll``) já existente — pode
    ser ``None`` — com os filtros opcionais de tipo de película/tonalidade
    (params ``film_type_ids``/``tonalities`` dos endpoints de Indicadores).
    Só aplica quando a lista correspondente não é vazia/None.
    """
    extra = []
    if film_type_ids:
        extra.append(FilmRoll.film_type_id.in_(film_type_ids))
    if tonalities:
        extra.append(FilmRoll.tonality.in_(tonalities))
    if not extra:
        return roll_filter
    return and_(roll_filter, *extra) if roll_filter is not None else and_(*extra)


def _kpi_value(current: float, previous: float) -> KPIValue:
    """Monta KPIValue com delta percentual real (via _delta)."""
    return KPIValue(current=current, previous=previous, delta_pct=_delta(current, previous))


def _kpi_snapshot(value: float) -> KPIValue:
    """
    KPIValue de "fotografia" (estoque atual, cobertura em dias): não há um
    "período anterior" reconstruível sem histórico de saldo — previous=current
    e delta_pct=None (mantém o contrato do schema sem inventar uma métrica).
    """
    return KPIValue(current=value, previous=value, delta_pct=None)


async def _consumption_meters_and_cost(
    db: AsyncSession,
    start: datetime,
    end: datetime,
    roll_filter,
    ft_dept_filter,
) -> tuple[float, float]:
    """
    Soma de metros consumidos (kind='consumo') e custo proporcional no
    intervalo [start, end], por created_at do consumo.

    Custo proporcional = meters_consumed * (roll.cost / roll.total_meters),
    somado apenas quando cost/total_meters são válidos (skip senão).
    """
    q = (
        select(FilmConsumption.meters_consumed, FilmRoll.cost, FilmRoll.total_meters)
        .select_from(FilmConsumption)
        .join(FilmRoll, FilmRoll.id == FilmConsumption.film_roll_id)
        .join(FilmType, FilmType.id == FilmRoll.film_type_id)
        .where(
            _consumption_kind_filter(),
            FilmConsumption.created_at >= start,
            FilmConsumption.created_at <= end,
            ft_dept_filter,
        )
    )
    if roll_filter is not None:
        q = q.where(roll_filter)

    rows = (await db.execute(q)).all()
    meters = sum(float(r.meters_consumed) for r in rows)
    cost = sum(
        float(r.meters_consumed) * (float(r.cost) / float(r.total_meters))
        for r in rows
        if r.cost is not None and r.total_meters and float(r.total_meters) > 0
    )
    return meters, cost


async def _os_anchored_meters_and_cost(
    db: AsyncSession,
    os_filters: list,
    os_dept_filter,
    start: datetime,
    end: datetime,
    film_type_ids: list[int] | None = None,
    tonalities: list[str] | None = None,
) -> tuple[float, float]:
    """
    Metros consumidos e custo proporcional ANCORADOS NA O.S. do período: soma o
    consumo das bobinas debitadas pelos itens de O.S. cujo período (service_date
    com fallback entry_time, ``_period_date_filter``) cai no intervalo — no mesmo
    escopo/departamento e mesma regra de produção da receita.

    Difere de :func:`_consumption_meters_and_cost` (ancorada em
    ``FilmConsumption.created_at``): aqui receita e custo compartilham a MESMA
    população de O.S., então a tabela de Rentabilidade (E2) e os KPIs financeiros
    (E5/E7/E8) fecham (receita ↔ consumo ↔ custo) mesmo com O.S. retroativa —
    serviço num mês, baixa da bobina noutro. Consumo avulso (sem item de O.S.
    vinculado, ``service_order_item_id`` nulo) NÃO entra: não há receita para
    casar. As métricas puras de estoque (KPIs de Estoque, Entradas x Consumo,
    cobertura) seguem por ``created_at`` — são movimento de estoque, não lucro.

    ``film_type_ids``/``tonalities`` (params dos endpoints de Indicadores)
    filtram pela BOBINA (``FilmRoll``) debitada — mesmo padrão de
    :func:`get_commercial_performance`.
    """
    filters = [
        _consumption_kind_filter(),
        *os_filters,
        _period_date_filter(start, end),
        _production_filter(),
        os_dept_filter,
    ]
    if film_type_ids:
        filters.append(FilmRoll.film_type_id.in_(film_type_ids))
    if tonalities:
        filters.append(FilmRoll.tonality.in_(tonalities))
    q = (
        select(FilmConsumption.meters_consumed, FilmRoll.cost, FilmRoll.total_meters)
        .select_from(FilmConsumption)
        .join(ServiceOrderItem, ServiceOrderItem.id == FilmConsumption.service_order_item_id)
        .join(ServiceOrder, ServiceOrder.id == ServiceOrderItem.service_order_id)
        .join(FilmRoll, FilmRoll.id == FilmConsumption.film_roll_id)
        .where(*filters)
    )
    rows = (await db.execute(q)).all()
    meters = sum(float(r.meters_consumed) for r in rows)
    cost = sum(
        float(r.meters_consumed) * (float(r.cost) / float(r.total_meters))
        for r in rows
        if r.cost is not None and r.total_meters and float(r.total_meters) > 0
    )
    return meters, cost


async def _avg_daily_consumption_30d(
    db: AsyncSession, end: datetime, roll_filter, ft_dept_filter
) -> float:
    """Média diária de metros consumidos nos últimos 30 dias a partir de ``end``."""
    window_start = end - timedelta(days=30)
    meters, _cost = await _consumption_meters_and_cost(
        db, window_start, end, roll_filter, ft_dept_filter
    )
    return meters / 30.0


def _coverage_days(stock_meters: float, avg_daily_consumption: float) -> float:
    """Dias de cobertura = estoque atual / consumo médio diário (0 se sem consumo)."""
    if avg_daily_consumption <= 0:
        return 0.0
    return round(stock_meters / avg_daily_consumption, 1)


async def _current_stock_meters_and_value(
    db: AsyncSession, roll_filter, ft_dept_filter
) -> tuple[float, float]:
    """
    Estoque atual (metros e valor) — SEMPRE uma fotografia de agora, não do
    período informado (bobinas ativas: em_estoque + em_uso).
    """
    q = (
        select(FilmRoll.remaining_meters, FilmRoll.cost, FilmRoll.total_meters)
        .select_from(FilmRoll)
        .join(FilmType, FilmType.id == FilmRoll.film_type_id)
        .where(FilmRoll.status.in_(["em_estoque", "em_uso"]), ft_dept_filter)
    )
    if roll_filter is not None:
        q = q.where(roll_filter)

    rows = (await db.execute(q)).all()
    stock_meters = sum(float(r.remaining_meters) for r in rows)
    stock_value = sum(
        float(r.remaining_meters) * (float(r.cost) / float(r.total_meters))
        for r in rows
        if r.cost is not None and r.total_meters and float(r.total_meters) > 0
    )
    return stock_meters, stock_value


async def _film_revenue_slices(
    db: AsyncSession,
    os_filters: list,
    os_dept_filter,
    start: datetime,
    end: datetime,
    bucket_fmt=None,
) -> tuple[
    list[tuple[int, str, int | None, str | None, float]],
    dict[tuple[int | None, str | None], dict[str, float]],
]:
    """
    Resolve a receita de película por (tipo, tonalidade) no período, ANCORADA
    NA BOBINA CONSUMIDA — fonte ÚNICA de atribuição de receita por tipo/
    tonalidade pra TODA a família Faturamento (E2 Rentabilidade, E1/E5 KPIs,
    E7 Saúde financeira, E8 Evolução). Extraído de ``get_profitability``
    (que a partir de agora só consome este helper) pra evitar duas
    implementações divergentes da mesma regra.

    NÃO usa ``ServiceOrderItem.film_type_id`` pra classificar — no lançamento
    da O.S. esse campo quase nunca é preenchido (``create_service_order``
    busca o tipo da bobina só pra calcular metros e consumir o rolo, mas não
    copia de volta pro item); filtrar a receita por ele faz o Faturamento
    colapsar pra ~R$0 sob qualquer filtro de Tipo. O tipo real mora na
    BOBINA consumida:

    1. Caminho principal (item COM consumo vinculado): rateia a receita do
       item (regra C8) entre as bobinas que ele consumiu
       (``FilmConsumption.service_order_item_id``), proporcional aos metros
       de cada bobina — a soma das fatias bate com a receita do item, sem
       dupla contagem. Um item que consumiu 2 bobinas de tipos diferentes
       vira 2 FATIAS (uma por bobina).
    2. Fallback (item COM receita mas SEM nenhum consumo vinculado — ex.:
       retalho, PPF sem consumo, registro legado). Resolve nesta ordem:
       a) ``COALESCE(item.film_type_id, item.film_roll_id → FilmType)`` +
          tonalidade análoga — se resolveu um tipo real, vira 1 fatia normal
          desse tipo.
       b) Se NÃO resolveu tipo real E ``item.used_scrap`` — 1 fatia sob o
          rótulo fixo "Retalho" (``film_type_id=RETALHO_FILM_TYPE_ID``).
       c) Se não resolveu tipo real E não é retalho — não há como atribuir
          a nenhum tipo: o item é EXCLUÍDO (nenhuma fatia). Na prática não
          dispara: quem chega aqui já passou por ``_qualifying_film_item_filter``,
          que exige bobina vinculada OU retalho OU consumo.
       Um item entra em UM só desses caminhos, nunca em mais de um.

    Retorna ``(slices, cons_map)``:
    - ``slices``: uma fatia ``(service_order_id, bucket, film_type_id,
      tonality, revenue)`` por combinação (item, bobina/fallback). ``bucket``
      é a string formatada de ``_period_bucket_date()`` via ``bucket_fmt``
      (``func.to_char``, ex. ``text("'YYYY-MM'")``) quando informado — senão
      o literal ``"ALL"`` (chamador que só quer o total do período, sem
      agrupar por tempo). Some ``revenue`` das fatias filtradas (ver
      ``_filter_revenue_slices``) pra obter receita/aplicações (nº de
      ``service_order_id`` distintos) sob um recorte de tipo/tonalidade.
    - ``cons_map``: metros/custo consumidos no período, agrupados por
      (``FilmRoll.film_type_id``, ``FilmRoll.tonality``) — INDEPENDENTE da
      atribuição de receita acima (mesma população de itens, mas soma toda
      a bobina debitada por eles). Usado só pela tabela de Rentabilidade
      (E2); os KPIs financeiros de custo/estoque usam
      ``_os_anchored_meters_and_cost``/``_current_stock_meters_and_value``
      (não mexidos por este helper).

    LIMITAÇÃO conhecida (retalho): numa O.S. de retalho (item vendido como
    tipo X, mas ``used_scrap`` — não debita bobina nova), a fatia de receita
    cai no rótulo "Retalho", enquanto eventual custo/estoque filtrado (que
    olha só ``FilmRoll``) não teria como enxergar esse tipo X — um filtro de
    Tipo pode então mostrar receita sem custo correspondente (ou vice-versa)
    nesse recorte. Não é bug de código, é limite semântico do filtro
    dividido em duas fontes (item vendido x bobina debitada).
    """
    bucket_col = (
        func.to_char(_period_bucket_date(), bucket_fmt).label("bucket")
        if bucket_fmt is not None
        else literal("ALL").label("bucket")
    )
    item_q = (
        select(
            ServiceOrderItem.id.label("item_id"),
            ServiceOrder.id.label("service_order_id"),
            bucket_col,
            ServiceOrderItem.film_type_id.label("item_film_type_id"),
            ServiceOrderItem.film_roll_id.label("item_film_roll_id"),
            ServiceOrderItem.tonality.label("item_tonality"),
            ServiceOrderItem.used_scrap.label("item_used_scrap"),
            _film_revenue_case().label("revenue"),
        )
        .select_from(ServiceOrderItem)
        .join(ServiceOrder, ServiceOrder.id == ServiceOrderItem.service_order_id)
        .where(
            *os_filters,
            _period_date_filter(start, end),
            _production_filter(),
            os_dept_filter,
            _qualifying_film_item_filter(),
        )
    )
    item_rows = (await db.execute(item_q)).all()

    item_revenue: dict[int, float] = {r.item_id: float(r.revenue or 0) for r in item_rows}
    item_film_type: dict[int, int | None] = {r.item_id: r.item_film_type_id for r in item_rows}
    item_film_roll: dict[int, int | None] = {r.item_id: r.item_film_roll_id for r in item_rows}
    item_tonality: dict[int, str | None] = {r.item_id: r.item_tonality for r in item_rows}
    item_used_scrap: dict[int, bool] = {r.item_id: bool(r.item_used_scrap) for r in item_rows}
    item_so: dict[int, int] = {r.item_id: r.service_order_id for r in item_rows}
    item_bucket: dict[int, str] = {r.item_id: r.bucket for r in item_rows}
    item_ids = list(item_revenue.keys())

    cons_by_item: dict[int, list[tuple[float, int | None, str | None]]] = {}
    cons_map: dict[tuple[int | None, str | None], dict[str, float]] = {}
    if item_ids:
        link_q = (
            select(
                FilmConsumption.service_order_item_id.label("item_id"),
                FilmConsumption.meters_consumed,
                FilmRoll.film_type_id.label("roll_film_type_id"),
                FilmRoll.tonality.label("roll_tonality"),
                FilmRoll.cost.label("roll_cost"),
                FilmRoll.total_meters.label("roll_total_meters"),
            )
            .select_from(FilmConsumption)
            .join(FilmRoll, FilmRoll.id == FilmConsumption.film_roll_id)
            .where(
                _consumption_kind_filter(),
                FilmConsumption.service_order_item_id.in_(item_ids),
            )
        )
        for r in (await db.execute(link_q)).all():
            cons_by_item.setdefault(r.item_id, []).append(
                (float(r.meters_consumed), r.roll_film_type_id, r.roll_tonality)
            )
            key = (r.roll_film_type_id, r.roll_tonality)
            entry = cons_map.setdefault(key, {"meters": 0.0, "cost": 0.0})
            entry["meters"] += float(r.meters_consumed)
            if r.roll_cost is not None and r.roll_total_meters and float(r.roll_total_meters) > 0:
                entry["cost"] += float(r.meters_consumed) * (
                    float(r.roll_cost) / float(r.roll_total_meters)
                )

    slices: list[tuple[int, str, int | None, str | None, float]] = []
    fallback_item_ids: list[int] = []

    for iid in item_ids:
        rows = cons_by_item.get(iid) or []
        total_meters = sum(m for m, _, _ in rows)
        if not rows or total_meters <= 0:
            fallback_item_ids.append(iid)
            continue
        rev = item_revenue.get(iid, 0.0)
        so_id = item_so[iid]
        bucket = item_bucket[iid]
        for meters, ft_id, ton in rows:
            slices.append((so_id, bucket, ft_id, ton, rev * (meters / total_meters)))

    if fallback_item_ids:
        roll_ids_needed = {
            item_film_roll[iid] for iid in fallback_item_ids if item_film_roll.get(iid) is not None
        }
        roll_info: dict[int, tuple[int | None, str | None]] = {}
        if roll_ids_needed:
            rrows = (
                await db.execute(
                    select(FilmRoll.id, FilmRoll.film_type_id, FilmRoll.tonality).where(
                        FilmRoll.id.in_(roll_ids_needed)
                    )
                )
            ).all()
            roll_info = {r.id: (r.film_type_id, r.tonality) for r in rrows}

        for iid in fallback_item_ids:
            ft_id = item_film_type.get(iid)
            ton = item_tonality.get(iid)
            roll_id = item_film_roll.get(iid)
            if roll_id is not None:
                roll_ft, roll_ton = roll_info.get(roll_id, (None, None))
                if ft_id is None:
                    ft_id = roll_ft
                if ton is None:
                    ton = roll_ton

            if ft_id is not None:
                key_ft: int | None = ft_id
            elif item_used_scrap.get(iid, False):
                # Retalho: não debita bobina de novo, então não tem como
                # resolver tipo real — agrupa por tonalidade sob o rótulo fixo.
                key_ft = RETALHO_FILM_TYPE_ID
            else:
                # Sem bobina vinculada e não é retalho: não há como atribuir
                # a nenhum tipo — excluído do resultado (defensivo — ver
                # docstring, não deveria disparar na prática).
                continue
            slices.append((item_so[iid], item_bucket[iid], key_ft, ton, item_revenue.get(iid, 0.0)))

    return slices, cons_map


def _filter_revenue_slices(
    slices: list[tuple[int, str, int | None, str | None, float]],
    film_type_ids: list[int] | None,
    tonalities: list[str] | None,
) -> list[tuple[int, str, int | None, str | None, float]]:
    """
    Pós-filtro por (film_type_id, tonality) sobre as fatias já resolvidas
    pela bobina consumida (:func:`_film_revenue_slices`) — mesmo padrão de
    ``get_profitability``: filtrar a chave JÁ RESOLVIDA, não a coluna crua
    de ``ServiceOrderItem``. Vazio/None nos dois params = sem filtro
    (devolve todas as fatias, idêntico ao total do período).
    """
    if not film_type_ids and not tonalities:
        return slices
    ft_set = set(film_type_ids) if film_type_ids else None
    ton_set = set(tonalities) if tonalities else None
    return [
        s
        for s in slices
        if (ft_set is None or s[2] in ft_set) and (ton_set is None or s[3] in ton_set)
    ]


def _period_labels(start: datetime, end: datetime, granularity: str) -> list[str]:
    """
    Gera os rótulos de período (dia/semana/mês) cobrindo TODO o intervalo
    [start, end], para preencher lacunas com zero nas séries temporais.

    Formatos espelham o to_char do Postgres usado no restante do módulo:
    dia=YYYY-MM-DD, semana=IYYY-IW (ISO), mês=YYYY-MM.
    """
    labels: list[str] = []
    if granularity == "day":
        cur = start.date()
        last = end.date()
        while cur <= last:
            labels.append(cur.strftime("%Y-%m-%d"))
            cur += timedelta(days=1)
    elif granularity == "week":
        cur = start.date()
        last = end.date()
        seen: set[str] = set()
        while cur <= last:
            iso_year, iso_week, _ = cur.isocalendar()
            label = f"{iso_year:04d}-{iso_week:02d}"
            if label not in seen:
                seen.add(label)
                labels.append(label)
            cur += timedelta(days=1)
    else:  # month
        cur = date(start.year, start.month, 1)
        last = date(end.year, end.month, 1)
        while cur <= last:
            labels.append(cur.strftime("%Y-%m"))
            cur = date(cur.year + 1, 1, 1) if cur.month == 12 else date(cur.year, cur.month + 1, 1)
    return labels


# =============================================================================
# Indicadores de Películas — Estoque
# =============================================================================


async def get_inventory_kpis(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    store_ids: list[int] | None = None,
    brand_ids: list[int] | None = None,
    departments: list[str] | None = None,
    film_type_ids: list[int] | None = None,
    tonalities: list[str] | None = None,
    compare_start_date: datetime | None = None,
    compare_end_date: datetime | None = None,
) -> InventoryKpis:
    """
    KPIs de estoque de película no período.

    stock_meters/stock_value/coverage_days são FOTOGRAFIAS do estoque atual
    (não é possível reconstruir o saldo no início do período anterior sem
    histórico de saldo) — previous=current, delta_pct=None por contrato.
    As demais (consumption/applications/entries/bobinas) comparam com o
    período anterior de mesma duração normalmente.

    film_type_ids/tonalities: componentes de BOBINA (estoque, consumo,
    entradas, contagem de bobinas) filtram por ``FilmRoll``; applications_count
    ancora a resolução de tipo/tonalidade na BOBINA CONSUMIDA por cada item
    (``_film_revenue_slices``/``_filter_revenue_slices`` — mesma lógica de
    ``get_profitability``), NÃO em ``ServiceOrderItem.film_type_id`` (quase
    sempre nulo no lançamento real — filtrar por ele faria a contagem
    colapsar sob qualquer filtro de Tipo). Mesmo padrão de
    ``_financial_period_stats``, pra bater com o KPI Faturamento (E5).
    """
    start_date, end_date = _normalize_period(start_date, end_date)
    effective_store_ids = await _resolve_effective_store_ids(db, store_ids, brand_ids)
    os_filters = await _os_scope_filters(db, user, effective_store_ids)
    os_dept_filter = _film_department_filter(departments)
    roll_filter = _roll_scope_filter(effective_store_ids)
    roll_filter = _combine_roll_type_tonality_filter(roll_filter, film_type_ids, tonalities)
    ft_dept_filter = _film_type_department_filter(departments)

    stock_meters, stock_value = await _current_stock_meters_and_value(
        db, roll_filter, ft_dept_filter
    )
    avg_daily = await _avg_daily_consumption_30d(db, end_date, roll_filter, ft_dept_filter)
    coverage_days = _coverage_days(stock_meters, avg_daily)

    prev_start, prev_end = _resolve_compare_period(
        start_date, end_date, compare_start_date, compare_end_date
    )

    consumption_curr, _cost_curr = await _consumption_meters_and_cost(
        db, start_date, end_date, roll_filter, ft_dept_filter
    )
    consumption_prev, _cost_prev = await _consumption_meters_and_cost(
        db, prev_start, prev_end, roll_filter, ft_dept_filter
    )

    async def _entries(s: datetime, e: datetime) -> tuple[float, int]:
        q = (
            select(
                func.coalesce(func.sum(FilmRoll.total_meters), 0.0),
                func.count(FilmRoll.id),
            )
            .select_from(FilmRoll)
            .join(FilmType, FilmType.id == FilmRoll.film_type_id)
            .where(
                FilmRoll.receipt_date >= s.date(), FilmRoll.receipt_date <= e.date(), ft_dept_filter
            )
        )
        if roll_filter is not None:
            q = q.where(roll_filter)
        row = (await db.execute(q)).one()
        return float(row[0] or 0), int(row[1] or 0)

    entries_curr, bobinas_curr = await _entries(start_date, end_date)
    entries_prev, bobinas_prev = await _entries(prev_start, prev_end)

    async def _applications(s: datetime, e: datetime) -> int:
        # Mesmo critério de "item qualificado" do módulo inteiro (ver
        # _qualifying_film_item_filter) — O.S. só conta como aplicação se tem
        # >=1 item com bobina vinculada, consumo real/legado ou retalho.
        if not film_type_ids and not tonalities:
            # Caminho quente (sem filtro de Tipo/Tonalidade — o caso mais
            # comum): 1 COUNT DISTINCT agregado no banco, sem materializar
            # item+consumo em Python. PERF: _film_revenue_slices só entra
            # quando o filtro está ativo — ver ramo abaixo (container da API
            # roda com 512M em PROD; já teve OOM/502 por endpoint pesado).
            q = (
                select(func.count(func.distinct(ServiceOrder.id)))
                .select_from(ServiceOrder)
                .outerjoin(ServiceOrderItem, ServiceOrderItem.service_order_id == ServiceOrder.id)
                .where(
                    *os_filters,
                    _period_date_filter(s, e),
                    _production_filter(),
                    os_dept_filter,
                    _qualifying_film_item_filter(),
                )
            )
            return int((await db.execute(q)).scalar() or 0)

        # Com filtro de Tipo/Tonalidade: só conta se ALGUMA fatia de receita
        # (bobina consumida ou fallback resolvido) casa com o filtro — mesma
        # ancoragem por bobina de _film_revenue_slices/get_profitability.
        slices, _cons_map = await _film_revenue_slices(db, os_filters, os_dept_filter, s, e)
        filtered = _filter_revenue_slices(slices, film_type_ids, tonalities)
        return len({so_id for so_id, _bucket, _ft, _ton, _rev in filtered})

    applications_curr = await _applications(start_date, end_date)
    applications_prev = await _applications(prev_start, prev_end)

    return InventoryKpis(
        stock_meters=_kpi_snapshot(round(stock_meters, 2)),
        stock_value=_kpi_snapshot(round(stock_value, 2)),
        coverage_days=_kpi_snapshot(coverage_days),
        consumption_meters=_kpi_value(round(consumption_curr, 2), round(consumption_prev, 2)),
        applications_count=_kpi_value(float(applications_curr), float(applications_prev)),
        entries_meters=_kpi_value(round(entries_curr, 2), round(entries_prev, 2)),
        bobinas_count=_kpi_value(float(bobinas_curr), float(bobinas_prev)),
    )


async def get_profitability(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    store_ids: list[int] | None = None,
    brand_ids: list[int] | None = None,
    departments: list[str] | None = None,
    film_type_ids: list[int] | None = None,
    tonalities: list[str] | None = None,
) -> ProfitabilityResponse:
    """
    Rentabilidade por (tipo de película, tonalidade) no período.

    Receita ancorada na BOBINA consumida (não em ``ServiceOrderItem.film_type_id``,
    quase sempre nulo no lançamento real) — resolução completa, rateio C8 e
    lógica de fallback/Retalho documentados em :func:`_film_revenue_slices`
    (helper compartilhado com toda a família Faturamento: E1/E5 KPIs, E7
    Saúde financeira, E8 Evolução — esta função é só quem CONSOME o helper).

    Consumo/custo (``cons_map``) continuam vindo INDEPENDENTEMENTE de
    FilmConsumption, agrupados por (FilmRoll.film_type_id, FilmRoll.tonality)
    — mesclados em Python pela mesma chave da receita.

    film_type_ids/tonalities (filtros multi-escolha do endpoint) são aplicados
    como PÓS-filtro sobre as CHAVES (ft_id, ton) já resolvidas — filtrar a SQL
    da receita por ServiceOrderItem.film_type_id não funcionaria (é o próprio
    campo que causava a classificação errada). Vazio/None = sem filtro (todos).
    """
    start_date, end_date = _normalize_period(start_date, end_date)
    effective_store_ids = await _resolve_effective_store_ids(db, store_ids, brand_ids)
    os_filters = await _os_scope_filters(db, user, effective_store_ids)
    os_dept_filter = _film_department_filter(departments)

    slices, cons_map = await _film_revenue_slices(
        db, os_filters, os_dept_filter, start_date, end_date
    )

    revenue_map: dict[tuple[int | None, str | None], float] = {}
    for _so_id, _bucket, ft_id, ton, rev in slices:
        key = (ft_id, ton)
        revenue_map[key] = revenue_map.get(key, 0.0) + rev

    # --- Pós-filtro por film_type_ids/tonalities (params do endpoint) -----
    all_keys = set(revenue_map) | set(cons_map)
    if film_type_ids:
        ft_set = set(film_type_ids)
        all_keys = {k for k in all_keys if k[0] in ft_set}
    if tonalities:
        ton_set = set(tonalities)
        all_keys = {k for k in all_keys if k[1] in ton_set}

    type_ids = {k[0] for k in all_keys if k[0] is not None and k[0] != RETALHO_FILM_TYPE_ID}
    type_names: dict[int, str] = {}
    if type_ids:
        trows = (
            await db.execute(select(FilmType.id, FilmType.name).where(FilmType.id.in_(type_ids)))
        ).all()
        type_names = {t.id: t.name for t in trows}

    items: list[ProfitabilityItem] = []
    for key in all_keys:
        ft_id, ton = key
        revenue = revenue_map.get(key, 0.0)
        cons = cons_map.get(key, {"meters": 0.0, "cost": 0.0})
        meters = cons["meters"]
        cost = cons["cost"]
        margin_pct = round((revenue - cost) / revenue * 100, 2) if revenue > 0 else None
        revenue_per_meter = round(revenue / meters, 2) if meters > 0 else None
        if ft_id == RETALHO_FILM_TYPE_ID:
            type_name = "Retalho"
        elif ft_id is not None:
            type_name = type_names.get(ft_id, "Não classificado")
        else:
            # Defensivo: cons_map nunca produz ft_id None (FilmRoll.film_type_id
            # é NOT NULL) e o fallback agora só entra em revenue_map com tipo
            # real ou sentinela de Retalho — este ramo não deveria disparar.
            type_name = "Não classificado"

        items.append(
            ProfitabilityItem(
                film_type_id=ft_id,
                type_name=type_name,
                tonality=ton,
                consumption_meters=round(meters, 2),
                cost=round(cost, 2),
                revenue=round(revenue, 2),
                margin_pct=margin_pct,
                revenue_per_meter=revenue_per_meter,
            )
        )

    items.sort(key=lambda i: -i.revenue)

    total_revenue = sum(i.revenue for i in items)
    total_cost = sum(i.cost for i in items)
    total_meters = sum(i.consumption_meters for i in items)
    total = ProfitabilityTotal(
        consumption_meters=round(total_meters, 2),
        cost=round(total_cost, 2),
        revenue=round(total_revenue, 2),
        margin_pct=round((total_revenue - total_cost) / total_revenue * 100, 2)
        if total_revenue > 0
        else None,
        revenue_per_meter=round(total_revenue / total_meters, 2) if total_meters > 0 else None,
    )

    return ProfitabilityResponse(items=items, total=total)


async def get_stock_health(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    store_ids: list[int] | None = None,
    brand_ids: list[int] | None = None,
    departments: list[str] | None = None,
    film_type_ids: list[int] | None = None,
    tonalities: list[str] | None = None,
) -> StockHealth:
    """
    Saúde do estoque: distribuição de bobinas por status.

    Classificação alinhada ao semáforo canônico de estoque
    (``app/modules/inventory/service.py`` — ``get_color``): ALERTA é a
    bobina ABERTA (``em_uso``) abaixo do limiar amarelo — uma bobina lacrada
    (``em_estoque``) não está em uso, então não faz sentido soar alarme nela.

    - em_estoque: status='em_estoque' (lacrada, qualquer saldo)
    - em_uso: status='em_uso' e remaining_meters > yellow_threshold_meters
    - alerta: status='em_uso' e remaining_meters <= yellow_threshold_meters
    - esgotada: status='esgotada'

    coverage_days usa a mesma fórmula dos KPIs de Estoque (fotografia atual).
    """
    start_date, end_date = _normalize_period(start_date, end_date)
    effective_store_ids = await _resolve_effective_store_ids(db, store_ids, brand_ids)
    roll_filter = _roll_scope_filter(effective_store_ids)
    roll_filter = _combine_roll_type_tonality_filter(roll_filter, film_type_ids, tonalities)
    ft_dept_filter = _film_type_department_filter(departments)

    q = (
        select(FilmRoll.status, FilmRoll.remaining_meters, FilmType.yellow_threshold_meters)
        .select_from(FilmRoll)
        .join(FilmType, FilmType.id == FilmRoll.film_type_id)
        .where(ft_dept_filter)
    )
    if roll_filter is not None:
        q = q.where(roll_filter)
    rows = (await db.execute(q)).all()

    counts = {"em_estoque": 0, "em_uso": 0, "alerta": 0, "esgotada": 0}
    stock_meters = 0.0
    for r in rows:
        if r.status == "esgotada":
            counts["esgotada"] += 1
        elif r.status == "em_uso":
            stock_meters += float(r.remaining_meters)
            if float(r.remaining_meters) <= float(r.yellow_threshold_meters):
                counts["alerta"] += 1
            else:
                counts["em_uso"] += 1
        elif r.status == "em_estoque":
            counts["em_estoque"] += 1
            stock_meters += float(r.remaining_meters)

    total = len(rows)
    breakdown = [
        StockHealthBucket(
            status=status,
            count=count,
            percentage=round(count / total * 100, 2) if total > 0 else 0.0,
        )
        for status, count in counts.items()
    ]

    avg_daily = await _avg_daily_consumption_30d(db, end_date, roll_filter, ft_dept_filter)
    coverage_days = _coverage_days(stock_meters, avg_daily)

    return StockHealth(total_bobinas=total, coverage_days=coverage_days, breakdown=breakdown)


async def get_entries_vs_consumption(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    store_ids: list[int] | None = None,
    brand_ids: list[int] | None = None,
    departments: list[str] | None = None,
    film_type_ids: list[int] | None = None,
    tonalities: list[str] | None = None,
    granularity: Literal["month", "week"] = "month",
) -> list[EntriesVsConsumptionPoint]:
    """
    Série temporal de entradas (FilmRoll.receipt_date) x consumo
    (FilmConsumption.created_at, kind='consumo'), com lacunas preenchidas
    com zero em todo o intervalo do período.
    """
    start_date, end_date = _normalize_period(start_date, end_date)
    effective_store_ids = await _resolve_effective_store_ids(db, store_ids, brand_ids)
    roll_filter = _roll_scope_filter(effective_store_ids)
    roll_filter = _combine_roll_type_tonality_filter(roll_filter, film_type_ids, tonalities)
    ft_dept_filter = _film_type_department_filter(departments)

    fmt_map = {"month": "YYYY-MM", "week": "IYYY-IW"}
    fmt = text(f"'{fmt_map[granularity]}'")

    entries_q = (
        select(
            func.to_char(FilmRoll.receipt_date, fmt).label("period"),
            func.coalesce(func.sum(FilmRoll.total_meters), 0).label("meters"),
        )
        .select_from(FilmRoll)
        .join(FilmType, FilmType.id == FilmRoll.film_type_id)
        .where(
            FilmRoll.receipt_date >= start_date.date(),
            FilmRoll.receipt_date <= end_date.date(),
            ft_dept_filter,
        )
        .group_by(func.to_char(FilmRoll.receipt_date, fmt))
    )
    if roll_filter is not None:
        entries_q = entries_q.where(roll_filter)
    entries_rows = (await db.execute(entries_q)).all()
    entries_map = {r.period: float(r.meters or 0) for r in entries_rows}

    cons_q = (
        select(
            func.to_char(FilmConsumption.created_at, fmt).label("period"),
            func.coalesce(func.sum(FilmConsumption.meters_consumed), 0).label("meters"),
        )
        .select_from(FilmConsumption)
        .join(FilmRoll, FilmRoll.id == FilmConsumption.film_roll_id)
        .join(FilmType, FilmType.id == FilmRoll.film_type_id)
        .where(
            _consumption_kind_filter(),
            FilmConsumption.created_at >= start_date,
            FilmConsumption.created_at <= end_date,
            ft_dept_filter,
        )
        .group_by(func.to_char(FilmConsumption.created_at, fmt))
    )
    if roll_filter is not None:
        cons_q = cons_q.where(roll_filter)
    cons_rows = (await db.execute(cons_q)).all()
    cons_map = {r.period: float(r.meters or 0) for r in cons_rows}

    labels = _period_labels(start_date, end_date, granularity)
    return [
        EntriesVsConsumptionPoint(
            period=label,
            entries_meters=round(entries_map.get(label, 0.0), 2),
            consumption_meters=round(cons_map.get(label, 0.0), 2),
        )
        for label in labels
    ]


# =============================================================================
# Indicadores de Películas — Financeiro
# =============================================================================


async def _financial_period_stats(
    db: AsyncSession,
    os_filters: list,
    os_dept_filter,
    start: datetime,
    end: datetime,
    film_type_ids: list[int] | None = None,
    tonalities: list[str] | None = None,
) -> tuple[float, int, float, float]:
    """
    Retorna (revenue, applications_count, consumption_meters, cost) do
    período. revenue/applications só contam ITEM QUALIFICADO
    (``_qualifying_film_item_filter()``) — mesmo critério da tabela de
    Rentabilidade (E2), pra o KPI Faturamento bater com o total da tabela.

    consumo/custo são ancorados na O.S. do período (``_os_anchored_meters_and_cost``,
    mesma população da receita) — não em ``FilmConsumption.created_at`` — pra
    lucro/margem/ROI/R$m baterem linha a linha com a Rentabilidade (E2).

    film_type_ids/tonalities: receita/aplicações ancoram a resolução de tipo/
    tonalidade na BOBINA CONSUMIDA por cada item, via
    ``_film_revenue_slices``/``_filter_revenue_slices`` — a MESMA lógica de
    ``get_profitability`` (E2), não em ``ServiceOrderItem.film_type_id``
    (quase sempre nulo no lançamento real — filtrar por ele faria o
    Faturamento colapsar pra ~R$0 sob qualquer filtro de Tipo). Consumo/custo
    (ancorados na bobina debitada) filtram por
    ``FilmRoll.film_type_id``/``tonality`` dentro de
    ``_os_anchored_meters_and_cost`` — fonte independente da receita. Numa
    O.S. de RETALHO (item vendido como tipo X, mas sem bobina nova debitada
    do mesmo tipo) essas duas fontes podem discordar — ver nota em
    ``get_financial_health``.
    """
    slices, _cons_map = await _film_revenue_slices(db, os_filters, os_dept_filter, start, end)
    filtered = _filter_revenue_slices(slices, film_type_ids, tonalities)
    revenue = sum(s[4] for s in filtered)
    applications = len({s[0] for s in filtered})

    meters, cost = await _os_anchored_meters_and_cost(
        db, os_filters, os_dept_filter, start, end, film_type_ids, tonalities
    )
    return revenue, applications, meters, cost


async def get_financial_kpis(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    store_ids: list[int] | None = None,
    brand_ids: list[int] | None = None,
    departments: list[str] | None = None,
    film_type_ids: list[int] | None = None,
    tonalities: list[str] | None = None,
    compare_start_date: datetime | None = None,
    compare_end_date: datetime | None = None,
) -> FinancialKpis:
    """
    KPIs financeiros de película no período, comparados ao período anterior.

    margin_pct.delta_pct é a diferença em PONTOS PERCENTUAIS entre as margens
    (não o delta percentual sobre a margem) — margem já é um percentual.

    film_type_ids/tonalities valem TAMBÉM no período de comparação (mesmo
    filtro nas duas chamadas de ``_financial_period_stats`` abaixo) — senão
    o delta % compararia um recorte filtrado com o total global, incoerente.
    """
    start_date, end_date = _normalize_period(start_date, end_date)
    effective_store_ids = await _resolve_effective_store_ids(db, store_ids, brand_ids)
    os_filters = await _os_scope_filters(db, user, effective_store_ids)
    os_dept_filter = _film_department_filter(departments)

    rev_curr, apps_curr, meters_curr, cost_curr = await _financial_period_stats(
        db, os_filters, os_dept_filter, start_date, end_date, film_type_ids, tonalities
    )
    prev_start, prev_end = _resolve_compare_period(
        start_date, end_date, compare_start_date, compare_end_date
    )
    rev_prev, apps_prev, meters_prev, cost_prev = await _financial_period_stats(
        db, os_filters, os_dept_filter, prev_start, prev_end, film_type_ids, tonalities
    )

    profit_curr = rev_curr - cost_curr
    profit_prev = rev_prev - cost_prev
    margin_curr = round(profit_curr / rev_curr * 100, 2) if rev_curr > 0 else 0.0
    margin_prev = round(profit_prev / rev_prev * 100, 2) if rev_prev > 0 else 0.0
    avg_ticket_curr = round(rev_curr / apps_curr, 2) if apps_curr > 0 else 0.0
    avg_ticket_prev = round(rev_prev / apps_prev, 2) if apps_prev > 0 else 0.0
    rev_per_meter_curr = round(rev_curr / meters_curr, 2) if meters_curr > 0 else 0.0
    rev_per_meter_prev = round(rev_prev / meters_prev, 2) if meters_prev > 0 else 0.0

    return FinancialKpis(
        revenue=_kpi_value(round(rev_curr, 2), round(rev_prev, 2)),
        margin_pct=KPIValue(
            current=margin_curr, previous=margin_prev, delta_pct=round(margin_curr - margin_prev, 2)
        ),
        profit=_kpi_value(round(profit_curr, 2), round(profit_prev, 2)),
        avg_ticket=_kpi_value(avg_ticket_curr, avg_ticket_prev),
        revenue_per_meter=_kpi_value(rev_per_meter_curr, rev_per_meter_prev),
        applications_count=_kpi_value(float(apps_curr), float(apps_prev)),
    )


async def get_commercial_performance(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    store_ids: list[int] | None = None,
    brand_ids: list[int] | None = None,
    departments: list[str] | None = None,
    film_type_ids: list[int] | None = None,
    tonalities: list[str] | None = None,
    sort_by: Literal["revenue", "meters", "applications"] = "revenue",
) -> list[CommercialPerformanceItem]:
    """
    Desempenho comercial de película por loja no período: tipos usados,
    metros consumidos, nº de aplicações e receita.

    A loja de cada linha é a LOJA EFETIVA (:func:`_os_effective_store_expr`):
    O.S. de galpão contam para a loja-galpão (Galpão Central), não para a loja
    de destino (ADR 0026). meters vem do consumo (FilmConsumption) atribuído à
    loja efetiva da O.S. do item vinculado; sem item vinculado, cai para a loja
    da bobina.
    """
    start_date, end_date = _normalize_period(start_date, end_date)
    effective_store_ids = await _resolve_effective_store_ids(db, store_ids, brand_ids)
    galpon_store_id = await _resolve_galpon_store_id(db)
    os_filters = await _os_scope_filters(db, user, effective_store_ids, galpon_store_id)
    eff_os_store = _os_effective_store_expr(galpon_store_id)
    os_dept_filter = _film_department_filter(departments)
    ft_dept_filter = _film_type_department_filter(departments)

    item_value = _film_revenue_case()

    # Receita/aplicações só de item qualificado (mesmo critério de E2/E5) —
    # metros continuam vindo de FilmConsumption, sem mudar de fonte.
    rev_filters = [
        *os_filters,
        _period_date_filter(start_date, end_date),
        _production_filter(),
        os_dept_filter,
        _qualifying_film_item_filter(),
    ]
    if film_type_ids:
        rev_filters.append(ServiceOrderItem.film_type_id.in_(film_type_ids))
    if tonalities:
        rev_filters.append(ServiceOrderItem.tonality.in_(tonalities))

    # Agrupa pela LOJA EFETIVA (galpão → loja-galpão), e junta o nome dessa loja
    # (Store.id == loja efetiva), não da loja de destino — ADR 0026.
    rev_q = (
        select(
            eff_os_store.label("store_id"),
            Store.name.label("store_name"),
            func.count(func.distinct(ServiceOrder.id)).label("applications"),
            func.coalesce(func.sum(item_value), 0).label("revenue"),
        )
        .select_from(ServiceOrder)
        .join(Store, Store.id == eff_os_store)
        .outerjoin(ServiceOrderItem, ServiceOrderItem.service_order_id == ServiceOrder.id)
        .where(*rev_filters)
        .group_by(eff_os_store, Store.name)
    )
    rev_rows = (await db.execute(rev_q)).all()
    store_map: dict[int, dict] = {
        r.store_id: {
            "store_name": r.store_name,
            "applications": int(r.applications or 0),
            "revenue": float(r.revenue or 0),
        }
        for r in rev_rows
    }

    cons_filters = [
        _consumption_kind_filter(),
        FilmConsumption.created_at >= start_date,
        FilmConsumption.created_at <= end_date,
        ft_dept_filter,
        # Quando o consumo está vinculado a um item de O.S. (join não nulo),
        # aplica a MESMA regra de produção da receita — senão O.S.
        # cancelada/errada-não-conferida vazaria nos metros do card. Consumo
        # avulso (sem item vinculado, atribuído à loja da bobina) não tem
        # O.S. para checar — passa direto.
        or_(ServiceOrderItem.id.is_(None), _production_filter()),
    ]
    if film_type_ids:
        cons_filters.append(FilmRoll.film_type_id.in_(film_type_ids))
    if tonalities:
        cons_filters.append(FilmRoll.tonality.in_(tonalities))
    if is_galpon_profile_user(user):
        # Mesmo isolamento galpão da receita: consumo vinculado a O.S. fora
        # do galpão fica de fora; consumo avulso (sem O.S.) passa direto.
        cons_filters.append(or_(ServiceOrderItem.id.is_(None), ServiceOrder.is_galpon.is_(True)))

    # Loja do consumo = loja EFETIVA da O.S. do item (galpão → loja-galpão);
    # sem item vinculado, cai para a loja da bobina (galpão já mora na store 15).
    store_expr = func.coalesce(eff_os_store, FilmRoll.store_id)

    # Coluna "Tipo": nomes de FilmType das BOBINAS consumidas por loja — NÃO
    # de ServiceOrderItem.film_type_id (quase sempre nulo no lançamento; ver
    # docstring de get_profitability sobre a mesma limitação).
    types_q = (
        select(store_expr.label("store_id"), FilmType.name.label("type_name"))
        .select_from(FilmConsumption)
        .join(FilmRoll, FilmRoll.id == FilmConsumption.film_roll_id)
        .join(FilmType, FilmType.id == FilmRoll.film_type_id)
        .outerjoin(ServiceOrderItem, ServiceOrderItem.id == FilmConsumption.service_order_item_id)
        .outerjoin(ServiceOrder, ServiceOrder.id == ServiceOrderItem.service_order_id)
        .where(*cons_filters)
        .distinct()
    )
    if effective_store_ids is not None:
        types_q = types_q.where(store_expr.in_(effective_store_ids))
    types_rows = (await db.execute(types_q)).all()
    types_map: dict[int, list[str]] = {}
    for r in types_rows:
        if r.store_id is None:
            continue
        names = types_map.setdefault(r.store_id, [])
        if r.type_name not in names:
            names.append(r.type_name)

    meters_q = (
        select(
            store_expr.label("store_id"),
            func.coalesce(func.sum(FilmConsumption.meters_consumed), 0).label("meters"),
        )
        .select_from(FilmConsumption)
        .join(FilmRoll, FilmRoll.id == FilmConsumption.film_roll_id)
        .join(FilmType, FilmType.id == FilmRoll.film_type_id)
        .outerjoin(ServiceOrderItem, ServiceOrderItem.id == FilmConsumption.service_order_item_id)
        .outerjoin(ServiceOrder, ServiceOrder.id == ServiceOrderItem.service_order_id)
        .where(*cons_filters)
        .group_by(store_expr)
    )
    if effective_store_ids is not None:
        meters_q = meters_q.where(store_expr.in_(effective_store_ids))
    meters_rows = (await db.execute(meters_q)).all()
    meters_map = {r.store_id: float(r.meters or 0) for r in meters_rows if r.store_id is not None}

    missing_ids = set(meters_map) - set(store_map)
    if missing_ids:
        srows = (
            await db.execute(select(Store.id, Store.name).where(Store.id.in_(missing_ids)))
        ).all()
        for s in srows:
            store_map[s.id] = {"store_name": s.name, "applications": 0, "revenue": 0.0}

    items = [
        CommercialPerformanceItem(
            store_id=store_id_key,
            store_name=data["store_name"],
            types=", ".join(types_map.get(store_id_key, [])[:3]),
            meters=round(meters_map.get(store_id_key, 0.0), 2),
            applications=data["applications"],
            revenue=round(data["revenue"], 2),
        )
        for store_id_key, data in store_map.items()
    ]

    sort_key = {
        "revenue": lambda i: -i.revenue,
        "meters": lambda i: -i.meters,
        "applications": lambda i: -i.applications,
    }[sort_by]
    items.sort(key=sort_key)
    return items


async def get_financial_health(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    store_ids: list[int] | None = None,
    brand_ids: list[int] | None = None,
    departments: list[str] | None = None,
    film_type_ids: list[int] | None = None,
    tonalities: list[str] | None = None,
) -> FinancialHealth:
    """
    Saúde financeira: valor do estoque atual, custo consumido, receita, margem e ROI.

    film_type_ids/tonalities: estoque/custo filtram por ``FilmRoll`` (bobina
    debitada); receita ancora a resolução de tipo/tonalidade na BOBINA
    CONSUMIDA por cada item, via ``_film_revenue_slices``/
    ``_filter_revenue_slices`` — a MESMA lógica de ``get_profitability`` (E2),
    NÃO em ``ServiceOrderItem.film_type_id`` (quase sempre nulo no lançamento
    real — filtrar por ele faria a receita colapsar pra ~R$0 sob qualquer
    filtro de Tipo). LIMITAÇÃO conhecida: numa O.S. de RETALHO (item vendido
    como tipo X, mas ``used_scrap`` — não debita bobina nova), a fatia de
    receita cai no rótulo "Retalho" enquanto o custo/estoque (que só olha
    ``FilmRoll``) não tem como enxergar o tipo X — o filtro pode então
    incluir receita de um tipo sem o custo correspondente (ou vice-versa),
    distorcendo margin/roi nesse recorte. Não é bug — é limite semântico do
    filtro (mesma população dividida em duas fontes distintas).
    """
    start_date, end_date = _normalize_period(start_date, end_date)
    effective_store_ids = await _resolve_effective_store_ids(db, store_ids, brand_ids)
    os_filters = await _os_scope_filters(db, user, effective_store_ids)
    os_dept_filter = _film_department_filter(departments)
    roll_filter = _roll_scope_filter(effective_store_ids)
    roll_filter = _combine_roll_type_tonality_filter(roll_filter, film_type_ids, tonalities)
    ft_dept_filter = _film_type_department_filter(departments)

    _stock_meters, stock_value = await _current_stock_meters_and_value(
        db, roll_filter, ft_dept_filter
    )
    # Custo consumido ancorado na O.S. do período (mesma população da receita) —
    # bate com o total de custo da tabela de Rentabilidade e com o KPI Faturamento.
    _meters, cost_consumed = await _os_anchored_meters_and_cost(
        db, os_filters, os_dept_filter, start_date, end_date, film_type_ids, tonalities
    )

    # Receita só de item qualificado (mesmo critério de E2/E5), ancorada na
    # bobina consumida — bate com a tabela de Rentabilidade e com o KPI Faturamento.
    slices, _cons_map = await _film_revenue_slices(
        db, os_filters, os_dept_filter, start_date, end_date
    )
    revenue = sum(s[4] for s in _filter_revenue_slices(slices, film_type_ids, tonalities))

    margin = revenue - cost_consumed
    roi = round(revenue / cost_consumed, 2) if cost_consumed > 0 else None

    return FinancialHealth(
        stock_value=round(stock_value, 2),
        cost_consumed=round(cost_consumed, 2),
        revenue=round(revenue, 2),
        margin=round(margin, 2),
        roi=roi,
    )


async def get_financial_evolution(
    db: AsyncSession,
    user: User,
    start_date: datetime,
    end_date: datetime,
    store_ids: list[int] | None = None,
    brand_ids: list[int] | None = None,
    departments: list[str] | None = None,
    film_type_ids: list[int] | None = None,
    tonalities: list[str] | None = None,
    granularity: Literal["day", "week", "month"] = "month",
) -> list[FinancialEvolutionPoint]:
    """
    Série temporal de receita x custo x margem, com lacunas preenchidas com zero.

    film_type_ids/tonalities: receita por bucket ancora a resolução de tipo/
    tonalidade na BOBINA CONSUMIDA por cada item, via ``_film_revenue_slices``
    (variante com ``bucket_fmt``)/``_filter_revenue_slices`` — a MESMA lógica
    de ``get_profitability`` (E2), NÃO em ``ServiceOrderItem.film_type_id``
    (quase sempre nulo no lançamento real — filtrar por ele faria a receita
    colapsar pra ~R$0 sob qualquer filtro de Tipo). Custo por bucket continua
    filtrando pela BOBINA (``FilmRoll``) debitada. Mesma LIMITAÇÃO de
    ``get_financial_health`` em O.S. de retalho (item de um tipo, sem bobina
    nova do mesmo tipo debitada) — o corte por tipo pode distorcer a margem
    do bucket. Não é bug de código.
    """
    start_date, end_date = _normalize_period(start_date, end_date)
    effective_store_ids = await _resolve_effective_store_ids(db, store_ids, brand_ids)
    os_filters = await _os_scope_filters(db, user, effective_store_ids)
    os_dept_filter = _film_department_filter(departments)

    fmt_map = {"day": "YYYY-MM-DD", "week": "IYYY-IW", "month": "YYYY-MM"}
    fmt = text(f"'{fmt_map[granularity]}'")
    bucket_date = _period_bucket_date()

    # Receita por bucket só de item qualificado (mesmo critério de E2/E5),
    # ancorada na bobina consumida — custo (bucket abaixo) continua vindo de
    # FilmConsumption, sem mudar de fonte.
    slices, _cons_map = await _film_revenue_slices(
        db, os_filters, os_dept_filter, start_date, end_date, bucket_fmt=fmt
    )
    rev_map: dict[str, float] = {}
    for _so_id, bucket, _ft_id, _ton, rev in _filter_revenue_slices(
        slices, film_type_ids, tonalities
    ):
        rev_map[bucket] = rev_map.get(bucket, 0.0) + rev

    # Custo por bucket ancorado na O.S. do período (mesma população/regra da
    # receita acima), bucketizado pela data da O.S. (_period_bucket_date) — não
    # por FilmConsumption.created_at — pra receita e custo caírem no mesmo bucket.
    cons_filters = [
        _consumption_kind_filter(),
        *os_filters,
        _period_date_filter(start_date, end_date),
        _production_filter(),
        os_dept_filter,
    ]
    if film_type_ids:
        cons_filters.append(FilmRoll.film_type_id.in_(film_type_ids))
    if tonalities:
        cons_filters.append(FilmRoll.tonality.in_(tonalities))
    cons_q = (
        select(
            func.to_char(bucket_date, fmt).label("period"),
            FilmConsumption.meters_consumed,
            FilmRoll.cost,
            FilmRoll.total_meters,
        )
        .select_from(FilmConsumption)
        .join(ServiceOrderItem, ServiceOrderItem.id == FilmConsumption.service_order_item_id)
        .join(ServiceOrder, ServiceOrder.id == ServiceOrderItem.service_order_id)
        .join(FilmRoll, FilmRoll.id == FilmConsumption.film_roll_id)
        .where(*cons_filters)
    )
    cons_rows = (await db.execute(cons_q)).all()

    cost_map: dict[str, float] = {}
    for r in cons_rows:
        if r.cost is not None and r.total_meters and float(r.total_meters) > 0:
            cost_map[r.period] = cost_map.get(r.period, 0.0) + float(r.meters_consumed) * (
                float(r.cost) / float(r.total_meters)
            )

    labels = _period_labels(start_date, end_date, granularity)
    points: list[FinancialEvolutionPoint] = []
    for label in labels:
        revenue = round(rev_map.get(label, 0.0), 2)
        cost = round(cost_map.get(label, 0.0), 2)
        margin_pct = round((revenue - cost) / revenue * 100, 2) if revenue > 0 else None
        points.append(
            FinancialEvolutionPoint(period=label, revenue=revenue, cost=cost, margin_pct=margin_pct)
        )
    return points


# =============================================================================
# Indicadores de Películas — Export PDF
# =============================================================================


async def resolve_filters_label(
    db: AsyncSession,
    *,
    start_date: datetime,
    end_date: datetime,
    compare_start_date: datetime | None,
    compare_end_date: datetime | None,
    store_ids: list[int],
    brand_ids: list[int],
    departments: list[str],
    film_type_ids: list[int],
    tonalities: list[str],
) -> FiltersLabel:
    """
    Resolve ids de Marca/Loja/Tipo em nomes para o bloco "Filtros aplicados"
    do PDF (``indicators_pdf.generate_peliculas_pdf``). Único ponto que toca
    banco nesse fluxo — ``generate_peliculas_pdf`` continua puro.
    """
    brand_names: list[str] = []
    if brand_ids:
        rows = (await db.execute(select(Brand.name).where(Brand.id.in_(brand_ids)))).scalars().all()
        brand_names = sorted(rows)

    store_names: list[str] = []
    if store_ids:
        rows = (await db.execute(select(Store.name).where(Store.id.in_(store_ids)))).scalars().all()
        store_names = sorted(rows)

    type_names: list[str] = []
    if film_type_ids:
        rows = (
            (await db.execute(select(FilmType.name).where(FilmType.id.in_(film_type_ids))))
            .scalars()
            .all()
        )
        type_names = sorted(rows)

    dept_names = [DEPARTMENT_LABELS.get(d, d) for d in departments]

    compare_label = (
        format_period_label(compare_start_date, compare_end_date)
        if compare_start_date and compare_end_date
        else "Mês anterior"
    )

    return FiltersLabel(
        period=format_period_label(start_date, end_date),
        compare=compare_label,
        brand=join_or_default(brand_names, "Todas"),
        store=join_or_default(store_names, "Todas"),
        department=join_or_default(dept_names, "Todos"),
        film_type=join_or_default(type_names, "Todos"),
        tonality=join_or_default(sorted(tonalities), "Todas"),
    )
