"""Router do módulo de EPI."""

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.exceptions import NotFoundError
from app.core.permissions import check_profile_permission
from app.core.security import get_current_user
from app.db.session import get_db
from app.dependencies import PaginatedResponse
from app.modules.epi import service
from app.modules.epi.schemas import (
    CargoEPICreate,
    CargoEPIListResponse,
    CargoEPIResponse,
    EntregaEPICreate,
    EntregaEPIListResponse,
    EntregaEPIResponse,
    EPICreate,
    EPIListResponse,
    EPIResponse,
    EPIUpdate,
    PendenciaListResponse,
)


def _require_epi_enabled() -> None:
    """Feature flag EPI_ENABLED: módulo desligado responde 404 (ex.: produção)."""
    if not get_settings().EPI_ENABLED:
        raise NotFoundError()


router = APIRouter(
    prefix="/epi",
    tags=["EPI"],
    dependencies=[Depends(_require_epi_enabled)],
)


# --------------------------------------------------------------------------
# Catálogo
# --------------------------------------------------------------------------
@router.get(
    "/catalog",
    response_model=EPIListResponse,
    dependencies=[Depends(check_profile_permission("epi", "can_view"))],
)
async def list_epis(
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    only_active: bool = Query(True),
):
    epis, total = await service.list_epis(db, page=page, limit=limit, only_active=only_active)
    return PaginatedResponse.create(
        items=[EPIResponse.model_validate(e) for e in epis],
        total=total,
        page=page,
        limit=limit,
    )


@router.post(
    "/catalog",
    response_model=EPIResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(check_profile_permission("epi", "can_edit"))],
)
async def create_epi(data: EPICreate, db: AsyncSession = Depends(get_db)):
    epi = await service.create_epi(db, data)
    return EPIResponse.model_validate(epi)


@router.patch(
    "/catalog/{epi_id}",
    response_model=EPIResponse,
    dependencies=[Depends(check_profile_permission("epi", "can_edit"))],
)
async def update_epi(epi_id: int, data: EPIUpdate, db: AsyncSession = Depends(get_db)):
    epi = await service.update_epi(db, epi_id, data)
    return EPIResponse.model_validate(epi)


@router.delete(
    "/catalog/{epi_id}",
    dependencies=[Depends(check_profile_permission("epi", "can_delete"))],
)
async def delete_epi(epi_id: int, db: AsyncSession = Depends(get_db)):
    return await service.deactivate_epi(db, epi_id)


# --------------------------------------------------------------------------
# Mapeamento cargo -> EPI
# --------------------------------------------------------------------------
@router.get(
    "/cargo-map",
    response_model=CargoEPIListResponse,
    dependencies=[Depends(check_profile_permission("epi", "can_view"))],
)
async def list_cargo_maps(
    db: AsyncSession = Depends(get_db),
    cargo: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
):
    maps, total = await service.list_cargo_maps(db, cargo=cargo, page=page, limit=limit)
    return PaginatedResponse.create(
        items=[service.build_cargo_epi_response(m) for m in maps],
        total=total,
        page=page,
        limit=limit,
    )


@router.post(
    "/cargo-map",
    response_model=CargoEPIResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(check_profile_permission("epi", "can_edit"))],
)
async def create_cargo_map(data: CargoEPICreate, db: AsyncSession = Depends(get_db)):
    mapping = await service.create_cargo_map(db, data)
    return service.build_cargo_epi_response(mapping)


@router.delete(
    "/cargo-map/{mapping_id}",
    dependencies=[Depends(check_profile_permission("epi", "can_delete"))],
)
async def delete_cargo_map(mapping_id: int, db: AsyncSession = Depends(get_db)):
    return await service.delete_cargo_map(db, mapping_id)


# --------------------------------------------------------------------------
# Entregas
# --------------------------------------------------------------------------
@router.post(
    "/deliveries",
    response_model=EntregaEPIResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(check_profile_permission("epi", "can_edit"))],
)
async def create_delivery(
    data: EntregaEPICreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    entrega = await service.register_delivery(db, data, current_user)
    return service.build_entrega_response(entrega)


@router.get(
    "/deliveries",
    response_model=EntregaEPIListResponse,
    dependencies=[Depends(check_profile_permission("epi", "can_view"))],
)
async def list_deliveries(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    employee_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
):
    entregas, total = await service.list_deliveries(
        db, current_user, employee_id=employee_id, page=page, limit=limit
    )
    return PaginatedResponse.create(
        items=[service.build_entrega_list_item(e) for e in entregas],
        total=total,
        page=page,
        limit=limit,
    )


# --------------------------------------------------------------------------
# Relatório de pendências
# --------------------------------------------------------------------------
@router.get(
    "/pendencias",
    response_model=PendenciaListResponse,
    dependencies=[Depends(check_profile_permission("epi", "can_view"))],
)
async def list_pendencias(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    estado: str | None = Query(None, description="PENDENTE | VENCIDO | EM_DIA"),
    store_ids: list[int] | None = Query(None),
):
    items = await service.get_pendencias(
        db, current_user, estado_filtro=estado, store_ids=store_ids
    )
    return PendenciaListResponse(items=items, total=len(items))
