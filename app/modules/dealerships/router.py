"""
Dealership router - API endpoints for dealership management.
"""

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import UserRole, require_roles
from app.core.security import get_current_user
from app.db.session import get_db
from app.dependencies import PaginatedResponse, get_pagination_params
from app.modules.dealerships import service
from app.modules.dealerships.schemas import (
    DealershipCreate,
    DealershipListResponse,
    DealershipResponse,
    DealershipUpdate,
)

router = APIRouter(prefix="/dealerships", tags=["Dealerships"])


@router.get("", response_model=DealershipListResponse)
async def list_dealerships(
    db: AsyncSession = Depends(get_db),
    pagination: dict = Depends(get_pagination_params),
    current_user=Depends(get_current_user),
    store_id: int | None = Query(None, description="Filtrar por loja"),
    is_active: bool | None = Query(None, description="Filtrar por status ativo"),
):
    """
    Lista todas as concessionárias.
    - Owner: vê todas as concessionárias
    - Demais: veem as concessionárias das lojas do seu perfil de acesso
    """
    dealerships, total = await service.list_dealerships(
        db=db,
        user=current_user,
        store_id=store_id,
        is_active=is_active,
        page=pagination["page"],
        limit=pagination["limit"],
    )

    return PaginatedResponse.create(
        items=[DealershipResponse.model_validate(d) for d in dealerships],
        total=total,
        page=pagination["page"],
        limit=pagination["limit"],
    )


@router.get("/{dealership_id}", response_model=DealershipResponse)
async def get_dealership(
    dealership_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Obtém detalhes de uma concessionária específica."""
    dealership = await service.get_dealership(db=db, dealership_id=dealership_id, user=current_user)
    return DealershipResponse.model_validate(dealership)


@router.post(
    "",
    response_model=DealershipResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def create_dealership(
    data: DealershipCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Cria uma nova concessionária (somente Proprietário, igual a editar/excluir).
    """
    dealership = await service.create_dealership(db=db, data=data, user=current_user)
    return DealershipResponse.model_validate(dealership)


@router.patch(
    "/{dealership_id}",
    response_model=DealershipResponse,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def update_dealership(
    dealership_id: int,
    data: DealershipUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Atualiza uma concessionária existente.
    Apenas Owners podem atualizar concessionárias.
    """
    dealership = await service.update_dealership(
        db=db, dealership_id=dealership_id, data=data, user=current_user
    )
    return DealershipResponse.model_validate(dealership)


@router.delete(
    "/{dealership_id}",
    response_model=DealershipResponse,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def deactivate_dealership(
    dealership_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Desativa uma concessionária.
    Apenas Owners podem desativar concessionárias.
    A concessionária não é excluída, apenas marcada como inativa.
    """
    dealership = await service.deactivate_dealership(
        db=db, dealership_id=dealership_id, user=current_user
    )
    return DealershipResponse.model_validate(dealership)
