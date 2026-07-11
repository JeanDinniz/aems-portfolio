"""
Analytics router - Overview and BI endpoints.
"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AuthorizationError
from app.core.permissions import UserRole, is_galpon_profile_user
from app.core.security import get_current_user
from app.db.session import get_db
from app.modules.analytics import schemas as dashboard_schemas
from app.modules.analytics import service as analytics_service
from app.modules.analytics.schemas import FilmPpfStoreRankingItem, TimeSeriesByTypePoint
from app.modules.auth.models import User

router = APIRouter(prefix="/analytics", tags=["Analytics"])

# TTL curto: agregações do dashboard são caras (varrem service_orders inteira)
# e toleram 30s de defasagem. A fila ao vivo (/dashboard/queue) fica FORA do
# cache de propósito — é a única visão que precisa ser tempo-real.
_ANALYTICS_CACHE_TTL = 30


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
    from app.core.redis import cache_json_get, cache_json_set

    if get_settings().DEBUG:
        return await compute()

    cached = await cache_json_get(key)
    if cached is not None:
        return cached
    result = await compute()
    await cache_json_set(key, jsonable_encoder(result), _ANALYTICS_CACHE_TTL)
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


@router.get("/overview", summary="Visao geral analitica")
async def get_overview(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    start_date: datetime | None = Query(None, description="Data inicial (ISO 8601)"),
    end_date: datetime | None = Query(None, description="Data final (ISO 8601)"),
    store_id: int | None = Query(None, description="Filtrar por loja (opcional)"),
) -> dict:
    """
    Retorna visao geral analitica de ordens de servico.

    Campos retornados:
    - total_orders: total de O.S. no periodo
    - completed_orders: O.S. concluidas (status 'completed')
    - revenue: receita total (soma dos itens)
    - avg_ticket: ticket medio por O.S.
    - orders_by_month: agrupamento mensal
    - orders_by_status: contagem por status
    - orders_by_store: contagem por loja
    """
    return await analytics_service.get_overview(
        db=db,
        user=current_user,
        start_date=start_date,
        end_date=end_date,
        store_id=store_id,
    )


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
    department: str | None = Query(None, description="Filtrar por departamento do funcionário"),
    limit: int = Query(10, ge=1, le=100),
    store_id: int | None = Query(None, description="Filtrar por loja (opcional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_owner_or_galpon),
) -> list[dashboard_schemas.EmployeeRankingItem]:
    """Ranking de funcionários por O.S. atendidas."""
    key = (
        f"analytics:employees_rank:{_scope(current_user)}:s{store_id}:d{department}:l{limit}:"
        f"{start_date.isoformat()}:{end_date.isoformat()}"
    )
    return await _cached(
        key,
        lambda: analytics_service.get_employees_ranking(
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
    "/dashboard/consultants",
    response_model=list[dashboard_schemas.ConsultantRankingItem],
    summary="Ranking de consultores",
)
async def get_consultants_ranking(
    start_date: datetime = Query(...),
    end_date: datetime = Query(...),
    limit: int = Query(10, ge=1, le=100),
    store_id: int | None = Query(None, description="Filtrar por loja (opcional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_owner_or_galpon),
) -> list[dashboard_schemas.ConsultantRankingItem]:
    """Ranking de consultores por receita no período."""
    key = (
        f"analytics:consultants_rank:{_scope(current_user)}:s{store_id}:l{limit}:"
        f"{start_date.isoformat()}:{end_date.isoformat()}"
    )
    return await _cached(
        key,
        lambda: analytics_service.get_consultants_ranking(
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
    "/dashboard/queue",
    response_model=list[dashboard_schemas.QueueSnapshotItem],
    summary="Snapshot ao vivo da fila",
)
async def get_live_queue(
    store_id: int | None = Query(None, description="Filtrar por loja (opcional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_owner_or_galpon),
) -> list[dashboard_schemas.QueueSnapshotItem]:
    """Snapshot em tempo real da fila de O.S. por loja."""
    return await analytics_service.get_live_queue(db=db, user=current_user, store_id=store_id)


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
