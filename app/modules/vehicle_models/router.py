"""
VehicleModel router - API endpoints for vehicle model management.
"""

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import check_profile_permission
from app.core.security import get_current_user
from app.db.session import get_db
from app.dependencies import PaginatedResponse, get_pagination_params
from app.modules.vehicle_models import service
from app.modules.vehicle_models.schemas import (
    VehicleModelCreate,
    VehicleModelListResponse,
    VehicleModelResponse,
    VehicleModelUpdate,
)

router = APIRouter(prefix="/vehicle-models", tags=["Vehicle Models"])


@router.get("", response_model=VehicleModelListResponse)
async def list_vehicle_models(
    db: AsyncSession = Depends(get_db),
    pagination: dict = Depends(get_pagination_params),
    current_user=Depends(get_current_user),
    brand_id: int | None = Query(None, description="ID da marca (filtro opcional)"),
    active_only: bool = Query(True, description="Retornar apenas modelos ativos"),
):
    """
    Lista modelos de veículos cadastrados para uma marca.

    - User com loja vinculada: se brand_id não for informado, usa a marca da própria loja.
    - Owner: brand_id na query é obrigatório quando não há loja vinculada.
    """
    effective_brand_id = await service.resolve_brand_id(db, current_user, brand_id)

    models, total = await service.list_by_brand(
        db=db,
        brand_id=effective_brand_id,
        active_only=active_only,
        page=pagination["page"],
        limit=pagination["limit"],
    )

    return PaginatedResponse.create(
        items=[VehicleModelResponse.model_validate(m) for m in models],
        total=total,
        page=pagination["page"],
        limit=pagination["limit"],
    )


@router.post("", response_model=VehicleModelResponse, status_code=status.HTTP_201_CREATED)
async def create_vehicle_model(
    data: VehicleModelCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("models", "can_edit")),
):
    """
    Cria um novo modelo de veículo para a marca.
    O brand_id é informado no body do request.
    """
    vehicle_model = await service.create(db=db, brand_id=data.brand_id, data=data)
    return VehicleModelResponse.model_validate(vehicle_model)


@router.patch("/{model_id}", response_model=VehicleModelResponse)
async def update_vehicle_model(
    model_id: int,
    data: VehicleModelUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("models", "can_edit")),
    brand_id: int = Query(..., description="ID da marca dona do modelo"),
):
    """
    Atualiza um modelo de veículo existente.
    """
    vehicle_model = await service.update(db=db, model_id=model_id, brand_id=brand_id, data=data)
    return VehicleModelResponse.model_validate(vehicle_model)


@router.delete("/{model_id}", response_model=VehicleModelResponse)
async def delete_vehicle_model(
    model_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("models", "can_delete")),
    brand_id: int = Query(..., description="ID da marca dona do modelo"),
):
    """
    Desativa um modelo de veículo (soft delete).
    """
    vehicle_model = await service.delete(db=db, model_id=model_id, brand_id=brand_id)
    return VehicleModelResponse.model_validate(vehicle_model)


@router.delete("/{model_id}/permanent", status_code=status.HTTP_200_OK)
async def hard_delete_vehicle_model(
    model_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("models", "can_delete")),
    brand_id: int = Query(..., description="ID da marca dona do modelo"),
):
    """
    Exclui permanentemente um modelo de veículo.
    """
    return await service.hard_delete(db=db, model_id=model_id, brand_id=brand_id)
