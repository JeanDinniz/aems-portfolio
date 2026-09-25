"""
Schemas do módulo Desempenho de Instaladores.

Respostas de leitura (não há persistência): relatório diário agrupado por
instalador e relatório individual detalhado por período.
"""

from datetime import date as date_type

from pydantic import BaseModel


class DailyVehicleRow(BaseModel):
    """Um veículo (O.S.) finalizado por um instalador no dia."""

    os_id: int
    order_number: str | None = None
    external_os_number: str | None = None
    plate: str
    vehicle: str | None = None  # "Modelo · Cor"
    store_name: str | None = None
    services: list[str]  # nomes/códigos dos serviços atribuídos ao instalador
    is_courtesy: bool
    is_return: bool = False
    has_shared: bool = False  # algum serviço feito por mais de um instalador
    value: float


class DailyInstallerGroup(BaseModel):
    """Bloco de um instalador no relatório diário."""

    employee_id: int
    employee_name: str
    vehicles: list[DailyVehicleRow]
    total_cars: int
    total_revenue: float


class DailyReportResponse(BaseModel):
    """Relatório diário completo (todos os instaladores do dia)."""

    report_date: date_type
    store_name: str | None = None  # None = todas as lojas (seletor global)
    groups: list[DailyInstallerGroup]
    grand_total_cars: int
    grand_total_revenue: float


class IndividualServiceRow(BaseModel):
    """Uma linha do relatório individual (uma O.S. finalizada, serviços agrupados)."""

    completion_date: date_type
    os_id: int
    order_number: str | None = None
    external_os_number: str | None = None
    plate: str
    vehicle: str | None = None
    store_name: str | None = None
    services: list[str]  # códigos dos serviços atribuídos ao instalador nesta O.S.
    is_courtesy: bool
    is_return: bool
    has_shared: bool = False  # algum serviço feito por mais de um instalador
    value: float
    points: float = 0.0


class IndividualReportResponse(BaseModel):
    """Relatório individual detalhado de um instalador no período."""

    employee_id: int
    employee_name: str
    period_start: date_type
    period_end: date_type
    store_name: str | None = None
    total_cars: int
    # Fracionado: serviço compartilhado entre K instaladores conta 1/K para cada
    total_services: float
    total_points: float
    total_revenue: float
    rows: list[IndividualServiceRow]


class SummaryRankingRow(BaseModel):
    """Uma linha do ranking do Resumo (um instalador no período)."""

    employee_id: int
    employee_name: str
    orders_count: int
    services_count: float
    cars_count: int
    points: float
    revenue: float


class SummaryTotals(BaseModel):
    """Totais agregados do período para todos os instaladores."""

    total_cars: int
    total_services: float
    total_points: float
    total_revenue: float
    film_cost: float


class SummaryReportResponse(BaseModel):
    """Resposta do relatório Resumo — ranking + totais + custo de película."""

    period_start: date_type
    period_end: date_type
    store_name: str | None = None
    totals: SummaryTotals
    rows: list[SummaryRankingRow]


class ReturnRow(BaseModel):
    """Uma linha do relatório de Retornos (O.S. de retorno × O.S. de origem)."""

    return_os_id: int
    return_date: date_type
    return_workers: list[str]
    return_notes: str | None = None
    return_services: list[str]
    origin_os_id: int | None = None
    origin_date: date_type | None = None
    origin_workers: list[str] = []
    origin_notes: str | None = None
    origin_services: list[str] = []
    model: str | None = None
    chassis: str | None = None
    color: str | None = None


class ReturnsReportResponse(BaseModel):
    """Resposta do relatório de Retornos no período."""

    period_start: date_type
    period_end: date_type
    store_name: str | None = None
    rows: list[ReturnRow]
