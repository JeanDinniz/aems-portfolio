"""
Analytics schemas - Pydantic models for Dashboard Executivo.
"""

from pydantic import BaseModel


class KPIComparison(BaseModel):
    """KPI com comparativo período anterior e delta percentual."""

    current: float
    previous: float
    delta_pct: float | None  # None quando previous == 0


class DashboardOverview(BaseModel):
    """Visão geral do dashboard executivo com KPIs comparados ao período anterior."""

    revenue: KPIComparison
    total_orders: KPIComparison
    completed_orders: KPIComparison
    avg_ticket: KPIComparison
    completion_rate: KPIComparison
    pct_courtesy: KPIComparison
    pct_galpon: KPIComparison
    pct_return: KPIComparison


class StoreRankingItem(BaseModel):
    """Item do ranking de lojas."""

    store_id: int
    store_name: str
    revenue: float
    orders_count: int
    avg_ticket: float
    completion_rate: float


class ServiceRankingItem(BaseModel):
    """Item do ranking de serviços."""

    service_id: int
    service_name: str
    department: str
    count: int
    revenue: float


class DepartmentBreakdownItem(BaseModel):
    """Item do breakdown por departamento."""

    department: str
    count: int
    revenue: float
    pct_revenue: float


class EmployeeRankingItem(BaseModel):
    """Item do ranking de funcionários."""

    employee_id: int
    employee_name: str
    department: str | None
    orders_count: int
    hours_worked: float
    avg_hours_per_order: float


class ConsultantRankingItem(BaseModel):
    """Item do ranking de consultores."""

    consultant_id: int
    consultant_name: str
    dealership_name: str | None
    orders_count: int
    revenue: float


class SLAMetrics(BaseModel):
    """Métricas de SLA (tempo de atendimento)."""

    avg_wait_minutes: float
    avg_execution_minutes: float
    pct_return: float
    pct_courtesy: float
    pct_galpon: float


class QueueSnapshotItem(BaseModel):
    """Snapshot ao vivo da fila de atendimento por loja."""

    store_id: int
    store_name: str
    waiting: int
    in_progress: int
    overdue: int
    completed: int


class TimeSeriesPoint(BaseModel):
    """Ponto de série temporal com agrupamento configurável."""

    date: str  # YYYY-MM-DD | YYYY-IW | YYYY-MM
    orders_count: int
    revenue: float


class TimeSeriesByTypePoint(BaseModel):
    """Ponto de série temporal agrupado por tipo (Película, PPF, Estética)."""

    date: str  # YYYY-MM-DD | YYYY-IW | YYYY-MM
    film_count: int
    ppf_count: int
    estetica_count: int


class FilmPpfStoreRankingItem(BaseModel):
    """Item do ranking Película x PPF por loja."""

    store_id: int
    store_name: str
    orders_count: int
    revenue: float
    loja_count: int
    galpon_count: int
