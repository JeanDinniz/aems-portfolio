"""
Analytics schemas - Pydantic models for Dashboard Executivo.
"""

from pydantic import BaseModel


class KPIComparison(BaseModel):
    """KPI com comparativo período anterior e delta percentual."""

    current: float
    previous: float
    delta_pct: float | None  # None quando previous == 0


class RevenueGoal(BaseModel):
    """
    Meta de faturamento do período no escopo atual (loja/consolidado).

    Metas = valor por funcionário × Nº de funcionários ativos (sem instaladores).
    Fornece o estado pronto para o card do Dashboard: até onde o faturamento
    chegou e quanto falta para a próxima meta.
    """

    employee_count: int
    per_employee: list[float]  # [meta1, meta2, meta3] por funcionário
    targets: list[float]  # [meta1, meta2, meta3] absolutas (× nº func)
    revenue: float  # faturamento do período (mesma base do KPI de receita)
    reached_tier: int  # 0..3 — maior meta já batida
    next_tier: int | None  # 1..3 — próxima meta a bater (None se todas batidas)
    next_target: float | None  # valor absoluto da próxima meta
    remaining: float | None  # quanto falta para a próxima meta
    progress_pct: float  # % do faturamento em relação à próxima meta


class DashboardOverview(BaseModel):
    """Visão geral do dashboard executivo com KPIs comparados ao período anterior."""

    revenue: KPIComparison
    total_orders: KPIComparison
    completed_orders: KPIComparison
    verified_orders: KPIComparison
    avg_ticket: KPIComparison
    completion_rate: KPIComparison
    pct_courtesy: KPIComparison
    pct_galpon: KPIComparison
    pct_return: KPIComparison
    revenue_goal: RevenueGoal


class StoreRankingItem(BaseModel):
    """Item do ranking de lojas."""

    store_id: int
    store_name: str
    revenue: float
    orders_count: int
    avg_ticket: float
    completion_rate: float
    pct_return: float = 0.0


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
    # Fracionado: serviço feito por K instaladores conta 1/K para cada
    services_count: float = 0
    hours_worked: float
    avg_hours_per_order: float
    # Valor gerado: item do worker (por serviço) ou total da O.S. (legado)
    revenue: float = 0


class DealershipRankingItem(BaseModel):
    """Item do ranking de concessionárias parceiras."""

    dealership_id: int
    dealership_name: str
    orders_count: int
    revenue: float
    avg_ticket: float


class SLAMetrics(BaseModel):
    """Métricas de SLA (tempo de atendimento)."""

    avg_wait_minutes: float
    avg_execution_minutes: float
    pct_return: float
    pct_courtesy: float
    pct_galpon: float


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
    # Valor bruto faturado por tipo (mesma regra de receita: itens, sem cortesia)
    film_revenue: float = 0
    ppf_revenue: float = 0
    estetica_revenue: float = 0


class RevenueForecast(BaseModel):
    """Projeção de faturamento do mês corrente (run-rate por dias úteis)."""

    month: str  # YYYY-MM
    revenue_so_far: float
    forecast: float
    business_days_elapsed: int
    business_days_total: int


class FilmPpfStoreRankingItem(BaseModel):
    """Item do ranking Película x PPF por loja."""

    store_id: int
    store_name: str
    orders_count: int
    services_count: int = 0  # itens das O.S. (1 O.S. com 3 películas = 3)
    revenue: float
    loja_count: int
    galpon_count: int


# =============================================================================
# Indicadores de Películas
# =============================================================================


class KPIValue(BaseModel):
    """
    KPI com comparativo período anterior e delta percentual.

    Para KPIs de "fotografia" (snapshot no tempo, ex: estoque atual), previous
    é preenchido com o próprio current e delta_pct fica None — não faz sentido
    comparar o estoque de HOJE com "o estoque no início do período anterior"
    sem reconstruir histórico; ver docstring de cada função de serviço.
    """

    current: float
    previous: float
    delta_pct: float | None


class InventoryKpis(BaseModel):
    """KPIs de estoque de película no período (aba Estoque dos Indicadores)."""

    stock_meters: KPIValue  # snapshot atual — previous=current, delta_pct=None
    stock_value: KPIValue  # snapshot atual — previous=current, delta_pct=None
    coverage_days: KPIValue  # snapshot atual — previous=current, delta_pct=None
    consumption_meters: KPIValue
    applications_count: KPIValue
    entries_meters: KPIValue
    bobinas_count: KPIValue


class ProfitabilityItem(BaseModel):
    """Rentabilidade de um (tipo de película, tonalidade) no período."""

    film_type_id: int | None  # None = "Não classificado"
    type_name: str
    tonality: str | None
    consumption_meters: float
    cost: float
    revenue: float
    margin_pct: float | None  # None quando revenue == 0
    revenue_per_meter: float | None  # None quando consumption_meters == 0


class ProfitabilityTotal(BaseModel):
    """Totais agregados de todos os itens de rentabilidade."""

    consumption_meters: float
    cost: float
    revenue: float
    margin_pct: float | None
    revenue_per_meter: float | None


class ProfitabilityResponse(BaseModel):
    """Rentabilidade por tipo/tonalidade + totais."""

    items: list[ProfitabilityItem]
    total: ProfitabilityTotal


class StockHealthBucket(BaseModel):
    """Contagem de bobinas por status de saúde do estoque."""

    status: str  # em_estoque | em_uso | alerta | esgotada
    count: int
    percentage: float


class StockHealth(BaseModel):
    """Saúde do estoque: distribuição de bobinas por status."""

    total_bobinas: int
    coverage_days: float
    breakdown: list[StockHealthBucket]


class EntriesVsConsumptionPoint(BaseModel):
    """Ponto de série temporal: entradas x consumo de metros de película."""

    period: str  # YYYY-MM-DD | IYYY-IW | YYYY-MM
    entries_meters: float
    consumption_meters: float


class FinancialKpis(BaseModel):
    """KPIs financeiros de película no período (aba Financeiro dos Indicadores)."""

    revenue: KPIValue
    margin_pct: KPIValue  # delta_pct = diferença em p.p. (não percentual sobre percentual)
    profit: KPIValue
    avg_ticket: KPIValue
    revenue_per_meter: KPIValue
    applications_count: KPIValue


class CommercialPerformanceItem(BaseModel):
    """Desempenho comercial de película por loja no período."""

    store_id: int
    store_name: str
    types: str  # tipos de película usados, ex: "Fumê, Nano"
    meters: float
    applications: int
    revenue: float


class FinancialHealth(BaseModel):
    """Saúde financeira: estoque, custo consumido, receita, margem e ROI."""

    stock_value: float
    cost_consumed: float
    revenue: float
    margin: float
    roi: float | None  # None quando cost_consumed == 0


class FinancialEvolutionPoint(BaseModel):
    """Ponto de série temporal financeira: receita x custo x margem."""

    period: str  # YYYY-MM-DD | IYYY-IW | YYYY-MM
    revenue: float
    cost: float
    margin_pct: float | None  # None quando revenue == 0
