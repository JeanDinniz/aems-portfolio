"""
Analytics router - Overview and BI endpoints.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Response
from pydantic import TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.exceptions import AuthorizationError
from app.core.permissions import UserRole, check_profile_permission, is_galpon_profile_user
from app.core.security import get_current_user
from app.db.session import get_db
from app.modules.analytics import indicators_pdf
from app.modules.analytics import schemas as dashboard_schemas
from app.modules.analytics import service as analytics_service
from app.modules.analytics.schemas import (
    CommercialPerformanceItem,
    EntriesVsConsumptionPoint,
    FilmPpfStoreRankingItem,
    FinancialEvolutionPoint,
    FinancialHealth,
    FinancialKpis,
    InventoryKpis,
    ProfitabilityResponse,
    RevenueForecast,
    StockHealth,
    TimeSeriesByTypePoint,
)
from app.modules.auth.models import User

router = APIRouter(prefix="/analytics", tags=["Analytics"])

# TTL curto: agregações do dashboard são caras (varrem service_orders inteira)
# e toleram 30s de defasagem.
_ANALYTICS_CACHE_TTL = 30

# Sub-módulo do perfil de acesso que governa os Indicadores de Películas —
# Owner tem acesso total; demais usuários precisam do perfil "indicadores".
SUB_MODULE_INDICADORES = "indicadores"

TZ_LOCAL = ZoneInfo("America/Sao_Paulo")


async def _cached(key: str, compute):
    """
    Cache de leitura fail-open para agregações do dashboard.

    A chave DEVE incluir o escopo do usuário (flag galpão) e todos os params —
    nunca cachear resultado de um perfil e servir para outro.

    Em DEBUG o cache é desligado: dev quer dado fresco e a suíte de testes
    reutiliza os mesmos períodos com dados diferentes (contaminaria).
    """
    from fastapi.encoders import jsonable_encoder

    from app.config import get_settings
    from app.core.redis import cache_get_analytics_version, cache_json_get, cache_json_set

    if get_settings().DEBUG:
        return await compute()

    # Versão embutida na chave: um bump_analytics_cache() num write torna todas
    # as chaves da versão anterior inalcançáveis de uma vez (invalidação O(1)).
    version = await cache_get_analytics_version()
    versioned_key = f"v{version}:{key}"

    cached = await cache_json_get(versioned_key)
    if cached is not None:
        return cached
    result = await compute()
    await cache_json_set(versioned_key, jsonable_encoder(result), _ANALYTICS_CACHE_TTL)
    return result


def _scope(user: User) -> str:
    """Fragmento de chave com o escopo de visibilidade do usuário."""
    return f"g{int(is_galpon_profile_user(user))}"


async def require_owner_or_galpon(
    current_user: User = Depends(get_current_user),
) -> User:
    """Permite acesso a Owner ou usuário com perfil galpão."""
    if current_user.role == UserRole.OWNER.value or is_galpon_profile_user(current_user):
        return current_user
    raise AuthorizationError(detail="Acesso restrito a Owner ou perfil galpão")


@router.get(
    "/dashboard/overview",
    response_model=dashboard_schemas.DashboardOverview,
    summary="Dashboard executivo — KPIs com comparativo período anterior",
)
async def get_dashboard_overview(
    start_date: datetime = Query(..., description="Data inicial do período atual (ISO 8601)"),
    end_date: datetime = Query(..., description="Data final do período atual (ISO 8601)"),
    store_id: int | None = Query(None, description="Filtrar por loja (opcional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_owner_or_galpon),
) -> dashboard_schemas.DashboardOverview:
    """KPIs do período comparados ao período anterior de mesma duração."""
    key = (
        f"analytics:dash_overview:{_scope(current_user)}:s{store_id}:"
        f"{start_date.isoformat()}:{end_date.isoformat()}"
    )
    return await _cached(
        key,
        lambda: analytics_service.get_dashboard_overview(
            db=db,
            user=current_user,
            start_date=start_date,
            end_date=end_date,
            store_id=store_id,
        ),
    )


@router.get(
    "/dashboard/stores",
    response_model=list[dashboard_schemas.StoreRankingItem],
    summary="Ranking de lojas por receita",
)
async def get_stores_ranking(
    start_date: datetime = Query(...),
    end_date: datetime = Query(...),
    store_id: int | None = Query(None, description="Filtrar por loja (opcional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_owner_or_galpon),
) -> list[dashboard_schemas.StoreRankingItem]:
    """Ranking de lojas por receita no período."""
    key = (
        f"analytics:stores_rank:{_scope(current_user)}:s{store_id}:"
        f"{start_date.isoformat()}:{end_date.isoformat()}"
    )
    return await _cached(
        key,
        lambda: analytics_service.get_stores_ranking(
            db=db,
            user=current_user,
            start_date=start_date,
            end_date=end_date,
            store_id=store_id,
        ),
    )


@router.get(
    "/dashboard/services",
    response_model=list[dashboard_schemas.ServiceRankingItem],
    summary="Ranking de serviços por receita",
)
async def get_services_ranking(
    start_date: datetime = Query(...),
    end_date: datetime = Query(...),
    department: str | None = Query(None, description="Filtrar por departamento"),
    limit: int = Query(10, ge=1, le=100),
    store_id: int | None = Query(None, description="Filtrar por loja (opcional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_owner_or_galpon),
) -> list[dashboard_schemas.ServiceRankingItem]:
    """Ranking de serviços por receita no período."""
    key = (
        f"analytics:services_rank:{_scope(current_user)}:s{store_id}:d{department}:l{limit}:"
        f"{start_date.isoformat()}:{end_date.isoformat()}"
    )
    return await _cached(
        key,
        lambda: analytics_service.get_services_ranking(
            db=db,
            user=current_user,
            start_date=start_date,
            end_date=end_date,
            department=department,
            limit=limit,
            store_id=store_id,
        ),
    )


@router.get(
    "/dashboard/departments",
    response_model=list[dashboard_schemas.DepartmentBreakdownItem],
    summary="Breakdown por departamento",
)
async def get_department_breakdown(
    start_date: datetime = Query(...),
    end_date: datetime = Query(...),
    store_id: int | None = Query(None, description="Filtrar por loja (opcional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_owner_or_galpon),
) -> list[dashboard_schemas.DepartmentBreakdownItem]:
    """Breakdown de O.S. e receita por departamento."""
    key = (
        f"analytics:dept_breakdown:{_scope(current_user)}:s{store_id}:"
        f"{start_date.isoformat()}:{end_date.isoformat()}"
    )
    return await _cached(
        key,
        lambda: analytics_service.get_department_breakdown(
            db=db,
            user=current_user,
            start_date=start_date,
            end_date=end_date,
            store_id=store_id,
        ),
    )


@router.get(
    "/dashboard/employees",
    response_model=list[dashboard_schemas.EmployeeRankingItem],
    summary="Ranking de funcionários",
)
async def get_employees_ranking(
    start_date: datetime = Query(...),
    end_date: datetime = Query(...),
    department: str | None = Query(
        None, description="Filtro single (legado — mobile); combinado com departments"
    ),
    departments: list[str] = Query(
        default_factory=list,
        description="Departamentos da O.S. em que o trabalho foi feito (multi)",
    ),
    limit: int = Query(10, ge=1, le=100),
    store_id: int | None = Query(None, description="Filtrar por loja (opcional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_owner_or_galpon),
) -> list[dashboard_schemas.EmployeeRankingItem]:
    """Ranking de funcionários por serviços feitos no período."""
    effective = sorted(set(departments) | ({department} if department else set()))
    key = (
        f"analytics:employees_rank:{_scope(current_user)}:s{store_id}:d{','.join(effective)}:"
        f"l{limit}:{start_date.isoformat()}:{end_date.isoformat()}"
    )
    return await _cached(
        key,
        lambda: analytics_service.get_employees_ranking(
            db=db,
            user=current_user,
            start_date=start_date,
            end_date=end_date,
            departments=effective or None,
            limit=limit,
            store_id=store_id,
        ),
    )


@router.get(
    "/dashboard/dealerships",
    response_model=list[dashboard_schemas.DealershipRankingItem],
    summary="Ranking de concessionárias por receita",
)
async def get_dealerships_ranking(
    start_date: datetime = Query(...),
    end_date: datetime = Query(...),
    limit: int = Query(10, ge=1, le=100),
    store_id: int | None = Query(None, description="Filtrar por loja (opcional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_owner_or_galpon),
) -> list[dashboard_schemas.DealershipRankingItem]:
    """Ranking de concessionárias parceiras por receita no período."""
    key = (
        f"analytics:dealerships_rank:{_scope(current_user)}:s{store_id}:l{limit}:"
        f"{start_date.isoformat()}:{end_date.isoformat()}"
    )
    return await _cached(
        key,
        lambda: analytics_service.get_dealerships_ranking(
            db=db,
            user=current_user,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            store_id=store_id,
        ),
    )


@router.get(
    "/dashboard/sla",
    response_model=dashboard_schemas.SLAMetrics,
    summary="Métricas de SLA",
)
async def get_sla_metrics(
    start_date: datetime = Query(...),
    end_date: datetime = Query(...),
    store_id: int | None = Query(None, description="Filtrar por loja (opcional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_owner_or_galpon),
) -> dashboard_schemas.SLAMetrics:
    """Métricas de tempo de atendimento (SLA)."""
    key = (
        f"analytics:sla:{_scope(current_user)}:s{store_id}:"
        f"{start_date.isoformat()}:{end_date.isoformat()}"
    )
    return await _cached(
        key,
        lambda: analytics_service.get_sla_metrics(
            db=db,
            user=current_user,
            start_date=start_date,
            end_date=end_date,
            store_id=store_id,
        ),
    )


@router.get(
    "/dashboard/timeseries",
    response_model=list[dashboard_schemas.TimeSeriesPoint],
    summary="Série temporal de O.S. e receita",
)
async def get_timeseries(
    start_date: datetime = Query(...),
    end_date: datetime = Query(...),
    granularity: Literal["day", "week", "month"] = Query("month"),
    store_id: int | None = Query(None, description="Filtrar por loja (opcional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_owner_or_galpon),
) -> list[dashboard_schemas.TimeSeriesPoint]:
    """Série temporal agrupada por dia, semana ou mês."""
    key = (
        f"analytics:timeseries:{_scope(current_user)}:s{store_id}:gr{granularity}:"
        f"{start_date.isoformat()}:{end_date.isoformat()}"
    )
    return await _cached(
        key,
        lambda: analytics_service.get_timeseries(
            db=db,
            user=current_user,
            start_date=start_date,
            end_date=end_date,
            granularity=granularity,
            store_id=store_id,
        ),
    )


@router.get(
    "/dashboard/timeseries-by-type",
    response_model=list[TimeSeriesByTypePoint],
    summary="Série temporal de O.S. por tipo (Película, PPF, Estética)",
)
async def get_timeseries_by_type(
    start_date: datetime = Query(...),
    end_date: datetime = Query(...),
    granularity: Literal["day", "week", "month"] = Query("month"),
    store_id: int | None = Query(None, description="Filtrar por loja (opcional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_owner_or_galpon),
) -> list[TimeSeriesByTypePoint]:
    """Série temporal agrupada por Película, PPF e Estética."""
    key = (
        f"analytics:timeseries_type:{_scope(current_user)}:s{store_id}:gr{granularity}:"
        f"{start_date.isoformat()}:{end_date.isoformat()}"
    )
    return await _cached(
        key,
        lambda: analytics_service.get_timeseries_by_type(
            db=db,
            user=current_user,
            start_date=start_date,
            end_date=end_date,
            granularity=granularity,
            store_id=store_id,
        ),
    )


@router.get(
    "/dashboard/revenue-forecast",
    response_model=RevenueForecast,
    summary="Previsão de faturamento do mês corrente (run-rate por dias úteis)",
)
async def get_revenue_forecast(
    store_id: int | None = Query(None, description="Filtrar por loja (opcional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_owner_or_galpon),
) -> RevenueForecast:
    """Receita do mês até hoje ÷ dias úteis decorridos × dias úteis do mês."""
    today = datetime.now().date()
    key = f"analytics:revenue_forecast:{_scope(current_user)}:s{store_id}:{today.isoformat()}"
    return await _cached(
        key,
        lambda: analytics_service.get_revenue_forecast(db=db, user=current_user, store_id=store_id),
    )


@router.get(
    "/dashboard/film-ppf-ranking",
    response_model=list[FilmPpfStoreRankingItem],
    summary="Ranking Película x PPF por loja",
)
async def get_film_ppf_ranking(
    start_date: datetime = Query(...),
    end_date: datetime = Query(...),
    store_id: int | None = Query(None, description="Filtrar por loja (opcional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_owner_or_galpon),
) -> list[FilmPpfStoreRankingItem]:
    """Ranking de lojas para O.S. de Película e PPF."""
    key = (
        f"analytics:film_ppf_rank:{_scope(current_user)}:s{store_id}:"
        f"{start_date.isoformat()}:{end_date.isoformat()}"
    )
    return await _cached(
        key,
        lambda: analytics_service.get_film_ppf_ranking(
            db=db,
            user=current_user,
            start_date=start_date,
            end_date=end_date,
            store_id=store_id,
        ),
    )


# =============================================================================
# Indicadores de Películas
# =============================================================================
#
# Permissão via perfil de acesso (submódulo "indicadores"), NÃO via
# require_owner_or_galpon — Owner pode conceder isso a qualquer perfil em
# "Perfis de Acesso" (ver app.core.permissions.check_profile_permission).


@dataclass
class IndicatorsFilters:
    """
    Filtros comuns aos 8 endpoints de leitura + ao export PDF da tela
    "Películas". Usado via ``Depends()`` — o FastAPI expande cada campo como
    query param individual (mesmos nomes/contrato de sempre, OpenAPI
    idêntico a antes; ver teste de smoke em ``ToolSearch``/conversa). Os
    parâmetros que variam por endpoint (compare_start_date/compare_end_date,
    granularity, sort_by) continuam declarados fora dele.
    """

    start_date: datetime = Query(..., description="Data inicial do período (ISO 8601)")
    end_date: datetime = Query(..., description="Data final do período (ISO 8601)")
    store_ids: list[int] = Query(default_factory=list, description="Filtrar por loja (multi)")
    brand_ids: list[int] = Query(default_factory=list, description="Filtrar por marca (multi)")
    departments: list[Literal["film", "security_film", "ppf"]] = Query(
        default_factory=list,
        description="film | security_film | ppf (multi; vazio = família Película inteira)",
    )
    film_type_ids: list[int] = Query(
        default_factory=list, description="Filtrar por tipo de película (multi)"
    )
    tonalities: list[str] = Query(
        default_factory=list, description="Filtrar por tonalidade (multi)"
    )


def _indicators_key(prefix: str, current_user: User, **params) -> str:
    """
    Chave de cache com escopo do usuário + TODOS os params relevantes.

    Listas (store_ids/brand_ids/departments) são ORDENADAS ao compor a chave:
    a mesma seleção em ordem diferente ([1,2] vs [2,1]) resolve no mesmo escopo
    (``_resolve_effective_store_ids`` faz ``sorted``), então deve compartilhar a
    entrada de cache — senão vira cache-miss redundante numa consulta cara.
    """

    def _fmt(v: object) -> str:
        return ",".join(map(str, sorted(v))) if isinstance(v, list) else str(v)

    parts = ":".join(f"{k}{_fmt(v)}" for k, v in params.items())
    return f"analytics:indicators:{prefix}:{_scope(current_user)}:{parts}"


# --- Helpers compartilhados: montam a key de cache + chamam _cached -----
#
# Usados TANTO pelos 8 endpoints de leitura QUANTO pelo export PDF — a key
# nunca diverge entre os dois consumidores porque é a MESMA função quem monta
# ela nos dois casos. `_cached` devolve um dict/list (cache hit, JSON puro)
# ou o objeto de schema já tipado (cache miss, retorno direto do service) —
# `model_validate`/`TypeAdapter` normalizam os dois casos pro tipo certo.


async def _fetch_inventory_kpis(
    db: AsyncSession,
    current_user: User,
    filters: IndicatorsFilters,
    compare_start_date: datetime | None,
    compare_end_date: datetime | None,
) -> InventoryKpis:
    key = _indicators_key(
        "inv_kpis",
        current_user,
        s=filters.store_ids,
        b=filters.brand_ids,
        dep=filters.departments,
        ft=filters.film_type_ids,
        ton=filters.tonalities,
        cs=compare_start_date.isoformat() if compare_start_date else None,
        ce=compare_end_date.isoformat() if compare_end_date else None,
        start=filters.start_date.isoformat(),
        end=filters.end_date.isoformat(),
    )
    result = await _cached(
        key,
        lambda: analytics_service.get_inventory_kpis(
            db=db,
            user=current_user,
            start_date=filters.start_date,
            end_date=filters.end_date,
            store_ids=filters.store_ids,
            brand_ids=filters.brand_ids,
            departments=filters.departments,
            film_type_ids=filters.film_type_ids,
            tonalities=filters.tonalities,
            compare_start_date=compare_start_date,
            compare_end_date=compare_end_date,
        ),
    )
    return InventoryKpis.model_validate(result)


async def _fetch_profitability(
    db: AsyncSession, current_user: User, filters: IndicatorsFilters
) -> ProfitabilityResponse:
    key = _indicators_key(
        "profitability",
        current_user,
        s=filters.store_ids,
        b=filters.brand_ids,
        dep=filters.departments,
        ft=filters.film_type_ids,
        ton=filters.tonalities,
        start=filters.start_date.isoformat(),
        end=filters.end_date.isoformat(),
    )
    result = await _cached(
        key,
        lambda: analytics_service.get_profitability(
            db=db,
            user=current_user,
            start_date=filters.start_date,
            end_date=filters.end_date,
            store_ids=filters.store_ids,
            brand_ids=filters.brand_ids,
            departments=filters.departments,
            film_type_ids=filters.film_type_ids,
            tonalities=filters.tonalities,
        ),
    )
    return ProfitabilityResponse.model_validate(result)


async def _fetch_stock_health(
    db: AsyncSession, current_user: User, filters: IndicatorsFilters
) -> StockHealth:
    key = _indicators_key(
        "stock_health",
        current_user,
        s=filters.store_ids,
        b=filters.brand_ids,
        dep=filters.departments,
        ft=filters.film_type_ids,
        ton=filters.tonalities,
        start=filters.start_date.isoformat(),
        end=filters.end_date.isoformat(),
    )
    result = await _cached(
        key,
        lambda: analytics_service.get_stock_health(
            db=db,
            user=current_user,
            start_date=filters.start_date,
            end_date=filters.end_date,
            store_ids=filters.store_ids,
            brand_ids=filters.brand_ids,
            departments=filters.departments,
            film_type_ids=filters.film_type_ids,
            tonalities=filters.tonalities,
        ),
    )
    return StockHealth.model_validate(result)


async def _fetch_entries_vs_consumption(
    db: AsyncSession,
    current_user: User,
    filters: IndicatorsFilters,
    granularity: Literal["month", "week"],
) -> list[EntriesVsConsumptionPoint]:
    key = _indicators_key(
        "entries_vs_consumption",
        current_user,
        s=filters.store_ids,
        b=filters.brand_ids,
        dep=filters.departments,
        ft=filters.film_type_ids,
        ton=filters.tonalities,
        gr=granularity,
        start=filters.start_date.isoformat(),
        end=filters.end_date.isoformat(),
    )
    result = await _cached(
        key,
        lambda: analytics_service.get_entries_vs_consumption(
            db=db,
            user=current_user,
            start_date=filters.start_date,
            end_date=filters.end_date,
            store_ids=filters.store_ids,
            brand_ids=filters.brand_ids,
            departments=filters.departments,
            film_type_ids=filters.film_type_ids,
            tonalities=filters.tonalities,
            granularity=granularity,
        ),
    )
    return TypeAdapter(list[EntriesVsConsumptionPoint]).validate_python(result)


async def _fetch_financial_kpis(
    db: AsyncSession,
    current_user: User,
    filters: IndicatorsFilters,
    compare_start_date: datetime | None,
    compare_end_date: datetime | None,
) -> FinancialKpis:
    key = _indicators_key(
        "fin_kpis",
        current_user,
        s=filters.store_ids,
        b=filters.brand_ids,
        dep=filters.departments,
        ft=filters.film_type_ids,
        ton=filters.tonalities,
        cs=compare_start_date.isoformat() if compare_start_date else None,
        ce=compare_end_date.isoformat() if compare_end_date else None,
        start=filters.start_date.isoformat(),
        end=filters.end_date.isoformat(),
    )
    result = await _cached(
        key,
        lambda: analytics_service.get_financial_kpis(
            db=db,
            user=current_user,
            start_date=filters.start_date,
            end_date=filters.end_date,
            store_ids=filters.store_ids,
            brand_ids=filters.brand_ids,
            departments=filters.departments,
            film_type_ids=filters.film_type_ids,
            tonalities=filters.tonalities,
            compare_start_date=compare_start_date,
            compare_end_date=compare_end_date,
        ),
    )
    return FinancialKpis.model_validate(result)


async def _fetch_commercial_performance(
    db: AsyncSession,
    current_user: User,
    filters: IndicatorsFilters,
    sort_by: Literal["revenue", "meters", "applications"],
) -> list[CommercialPerformanceItem]:
    key = _indicators_key(
        "commercial_perf",
        current_user,
        s=filters.store_ids,
        b=filters.brand_ids,
        dep=filters.departments,
        ft=filters.film_type_ids,
        ton=filters.tonalities,
        sort=sort_by,
        start=filters.start_date.isoformat(),
        end=filters.end_date.isoformat(),
    )
    result = await _cached(
        key,
        lambda: analytics_service.get_commercial_performance(
            db=db,
            user=current_user,
            start_date=filters.start_date,
            end_date=filters.end_date,
            store_ids=filters.store_ids,
            brand_ids=filters.brand_ids,
            departments=filters.departments,
            film_type_ids=filters.film_type_ids,
            tonalities=filters.tonalities,
            sort_by=sort_by,
        ),
    )
    return TypeAdapter(list[CommercialPerformanceItem]).validate_python(result)


async def _fetch_financial_health(
    db: AsyncSession, current_user: User, filters: IndicatorsFilters
) -> FinancialHealth:
    key = _indicators_key(
        "fin_health",
        current_user,
        s=filters.store_ids,
        b=filters.brand_ids,
        dep=filters.departments,
        ft=filters.film_type_ids,
        ton=filters.tonalities,
        start=filters.start_date.isoformat(),
        end=filters.end_date.isoformat(),
    )
    result = await _cached(
        key,
        lambda: analytics_service.get_financial_health(
            db=db,
            user=current_user,
            start_date=filters.start_date,
            end_date=filters.end_date,
            store_ids=filters.store_ids,
            brand_ids=filters.brand_ids,
            departments=filters.departments,
            film_type_ids=filters.film_type_ids,
            tonalities=filters.tonalities,
        ),
    )
    return FinancialHealth.model_validate(result)


async def _fetch_financial_evolution(
    db: AsyncSession,
    current_user: User,
    filters: IndicatorsFilters,
    granularity: Literal["day", "week", "month"],
) -> list[FinancialEvolutionPoint]:
    key = _indicators_key(
        "fin_evolution",
        current_user,
        s=filters.store_ids,
        b=filters.brand_ids,
        dep=filters.departments,
        ft=filters.film_type_ids,
        ton=filters.tonalities,
        gr=granularity,
        start=filters.start_date.isoformat(),
        end=filters.end_date.isoformat(),
    )
    result = await _cached(
        key,
        lambda: analytics_service.get_financial_evolution(
            db=db,
            user=current_user,
            start_date=filters.start_date,
            end_date=filters.end_date,
            store_ids=filters.store_ids,
            brand_ids=filters.brand_ids,
            departments=filters.departments,
            film_type_ids=filters.film_type_ids,
            tonalities=filters.tonalities,
            granularity=granularity,
        ),
    )
    return TypeAdapter(list[FinancialEvolutionPoint]).validate_python(result)


@router.get(
    "/indicators/inventory/kpis",
    response_model=InventoryKpis,
    summary="Indicadores de Películas — KPIs de Estoque",
)
async def get_indicators_inventory_kpis(
    filters: IndicatorsFilters = Depends(),
    compare_start_date: datetime | None = Query(
        None, description="Início do período de comparação (mês livre; vazio = mês anterior)"
    ),
    compare_end_date: datetime | None = Query(
        None, description="Fim do período de comparação (mês livre; vazio = mês anterior)"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission(SUB_MODULE_INDICADORES, "can_view")),
) -> InventoryKpis:
    """KPIs de estoque de película: metros/valor/cobertura (fotografia) + comparativos."""
    return await _fetch_inventory_kpis(
        db, current_user, filters, compare_start_date, compare_end_date
    )


@router.get(
    "/indicators/inventory/profitability",
    response_model=ProfitabilityResponse,
    summary="Indicadores de Películas — Rentabilidade por tipo/tonalidade",
)
async def get_indicators_inventory_profitability(
    filters: IndicatorsFilters = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission(SUB_MODULE_INDICADORES, "can_view")),
) -> ProfitabilityResponse:
    """Rentabilidade (receita, custo, margem, R$/m) por tipo de película e tonalidade."""
    return await _fetch_profitability(db, current_user, filters)


@router.get(
    "/indicators/inventory/health",
    response_model=StockHealth,
    summary="Indicadores de Películas — Saúde do estoque",
)
async def get_indicators_inventory_health(
    filters: IndicatorsFilters = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission(SUB_MODULE_INDICADORES, "can_view")),
) -> StockHealth:
    """Distribuição de bobinas por status de saúde (em_estoque/alerta/em_uso/esgotada)."""
    return await _fetch_stock_health(db, current_user, filters)


@router.get(
    "/indicators/inventory/entries-vs-consumption",
    response_model=list[EntriesVsConsumptionPoint],
    summary="Indicadores de Películas — Entradas x Consumo",
)
async def get_indicators_inventory_entries_vs_consumption(
    filters: IndicatorsFilters = Depends(),
    granularity: Literal["month", "week"] = Query("month"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission(SUB_MODULE_INDICADORES, "can_view")),
) -> list[EntriesVsConsumptionPoint]:
    """Série temporal de metros de entrada (bobinas recebidas) x metros consumidos."""
    return await _fetch_entries_vs_consumption(db, current_user, filters, granularity)


@router.get(
    "/indicators/financial/kpis",
    response_model=FinancialKpis,
    summary="Indicadores de Películas — KPIs Financeiros",
)
async def get_indicators_financial_kpis(
    filters: IndicatorsFilters = Depends(),
    compare_start_date: datetime | None = Query(
        None, description="Início do período de comparação (mês livre; vazio = mês anterior)"
    ),
    compare_end_date: datetime | None = Query(
        None, description="Fim do período de comparação (mês livre; vazio = mês anterior)"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission(SUB_MODULE_INDICADORES, "can_view")),
) -> FinancialKpis:
    """Receita, margem, lucro, ticket médio, R$/m e nº de aplicações no período."""
    return await _fetch_financial_kpis(
        db, current_user, filters, compare_start_date, compare_end_date
    )


@router.get(
    "/indicators/financial/commercial-performance",
    response_model=list[CommercialPerformanceItem],
    summary="Indicadores de Películas — Desempenho comercial por loja",
)
async def get_indicators_financial_commercial_performance(
    filters: IndicatorsFilters = Depends(),
    sort_by: Literal["revenue", "meters", "applications"] = Query("revenue"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission(SUB_MODULE_INDICADORES, "can_view")),
) -> list[CommercialPerformanceItem]:
    """Tipos, metros, aplicações e receita de película por loja."""
    return await _fetch_commercial_performance(db, current_user, filters, sort_by)


@router.get(
    "/indicators/financial/health",
    response_model=FinancialHealth,
    summary="Indicadores de Películas — Saúde financeira",
)
async def get_indicators_financial_health(
    filters: IndicatorsFilters = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission(SUB_MODULE_INDICADORES, "can_view")),
) -> FinancialHealth:
    """Valor do estoque atual, custo consumido, receita, margem e ROI no período."""
    return await _fetch_financial_health(db, current_user, filters)


@router.get(
    "/indicators/financial/evolution",
    response_model=list[FinancialEvolutionPoint],
    summary="Indicadores de Películas — Evolução financeira",
)
async def get_indicators_financial_evolution(
    filters: IndicatorsFilters = Depends(),
    granularity: Literal["day", "week", "month"] = Query("month"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission(SUB_MODULE_INDICADORES, "can_view")),
) -> list[FinancialEvolutionPoint]:
    """Série temporal de receita x custo x margem no período."""
    return await _fetch_financial_evolution(db, current_user, filters, granularity)


@router.get(
    "/indicators/export/pdf",
    summary="Indicadores de Películas — exportar PDF (relatório BI)",
)
async def export_indicators_pdf(
    filters: IndicatorsFilters = Depends(),
    compare_start_date: datetime | None = Query(
        None, description="Início do período de comparação (mês livre; vazio = mês anterior)"
    ),
    compare_end_date: datetime | None = Query(
        None, description="Fim do período de comparação (mês livre; vazio = mês anterior)"
    ),
    commercial_sort_by: Literal["revenue", "meters", "applications"] = Query("revenue"),
    evolution_granularity: Literal["day", "week", "month"] = Query("month"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission(SUB_MODULE_INDICADORES, "can_view")),
) -> Response:
    """
    Gera o PDF consolidado (BI) da tela "Películas", respeitando os mesmos
    filtros e o mesmo escopo de loja dos 8 endpoints de leitura acima.

    Reaproveita os MESMOS helpers ``_fetch_*`` (mesma key de cache, byte a
    byte, dos endpoints da tela) — bate com a tela e sai barato quando o
    card já foi visitado. A geração do PDF em si (CPU-bound, fpdf2 é
    síncrono) roda em threadpool (``run_in_threadpool``) pra não bloquear o
    event loop.
    """
    inventory_kpis = await _fetch_inventory_kpis(
        db, current_user, filters, compare_start_date, compare_end_date
    )
    profitability = await _fetch_profitability(db, current_user, filters)
    stock_health = await _fetch_stock_health(db, current_user, filters)
    entries_vs_consumption = await _fetch_entries_vs_consumption(
        db, current_user, filters, granularity="month"
    )
    financial_kpis = await _fetch_financial_kpis(
        db, current_user, filters, compare_start_date, compare_end_date
    )
    commercial_performance = await _fetch_commercial_performance(
        db, current_user, filters, commercial_sort_by
    )
    financial_health = await _fetch_financial_health(db, current_user, filters)
    financial_evolution = await _fetch_financial_evolution(
        db, current_user, filters, evolution_granularity
    )

    filters_label = await analytics_service.resolve_filters_label(
        db,
        start_date=filters.start_date,
        end_date=filters.end_date,
        compare_start_date=compare_start_date,
        compare_end_date=compare_end_date,
        store_ids=filters.store_ids,
        brand_ids=filters.brand_ids,
        departments=filters.departments,
        film_type_ids=filters.film_type_ids,
        tonalities=filters.tonalities,
    )

    data = indicators_pdf.PeliculasPdfData(
        filters=filters_label,
        generated_at=datetime.now(UTC).astimezone(TZ_LOCAL),
        generated_by=current_user.full_name,
        inventory_kpis=inventory_kpis,
        profitability=profitability,
        stock_health=stock_health,
        entries_vs_consumption=entries_vs_consumption,
        financial_kpis=financial_kpis,
        commercial_performance=commercial_performance,
        commercial_sort_by=commercial_sort_by,
        financial_health=financial_health,
        financial_evolution=financial_evolution,
        evolution_granularity=evolution_granularity,
    )
    content = await run_in_threadpool(indicators_pdf.generate_peliculas_pdf, data)
    filename = f"peliculas_{filters.start_date.strftime('%Y%m%d')}_{filters.end_date.strftime('%Y%m%d')}.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
