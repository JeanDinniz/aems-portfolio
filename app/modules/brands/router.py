"""
Brand router - API endpoints for brand management.
"""

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import UserRole, require_roles
from app.core.security import get_current_user
from app.db.session import get_db
from app.dependencies import PaginatedResponse
from app.modules.brands import service
from app.modules.brands.schemas import (
    BrandCreate,
    BrandListResponse,
    BrandResponse,
    BrandUpdate,
)

router = APIRouter(prefix="/brands", tags=["Brands"])


@router.get("", response_model=BrandListResponse)
async def list_brands(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    page: int = Query(1, ge=1, description="Página atual"),
    limit: int = Query(50, ge=1, le=200, description="Itens por página"),
    is_active: bool | None = Query(None, description="Filtrar por status ativo"),
):
    """
    Lista todas as marcas cadastradas.
    Acessível a todos os usuários autenticados.
    """
    brands, total = await service.list_brands(
        db=db,
        is_active=is_active,
        page=page,
        limit=limit,
    )

    return PaginatedResponse.create(
        items=[BrandResponse.model_validate(b) for b in brands],
        total=total,
        page=page,
        limit=limit,
    )


@router.get("/{brand_id}", response_model=BrandResponse)
async def get_brand(
    brand_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Obtém detalhes de uma marca específica."""
    brand = await service.get_brand(db=db, brand_id=brand_id)
    return BrandResponse.model_validate(brand)


@router.post(
    "",
    response_model=BrandResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def create_brand(
    data: BrandCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Cria uma nova marca.
    Apenas Owners podem criar marcas.
    """
    brand = await service.create_brand(db=db, data=data)
    return BrandResponse.model_validate(brand)


@router.patch(
    "/{brand_id}",
    response_model=BrandResponse,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def update_brand(
    brand_id: int,
    data: BrandUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Atualiza uma marca existente.
    Apenas Owners podem atualizar marcas.
    """
    brand = await service.update_brand(db=db, brand_id=brand_id, data=data)
    return BrandResponse.model_validate(brand)


@router.delete(
    "/{brand_id}",
    response_model=BrandResponse,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def deactivate_brand(
    brand_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Desativa uma marca (soft delete).
    Apenas Owners podem desativar marcas.
    A marca não é excluída, apenas marcada como inativa.
    """
    brand = await service.deactivate_brand(db=db, brand_id=brand_id)
    return BrandResponse.model_validate(brand)


@router.delete(
    "/{brand_id}/permanent",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def hard_delete_brand(
    brand_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Exclui permanentemente uma marca.
    Retorna erro 409 se houver vínculos ativos.
    """
    return await service.hard_delete_brand(db=db, brand_id=brand_id)
