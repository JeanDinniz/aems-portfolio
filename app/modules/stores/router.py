"""
Store router - API endpoints for store management.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import UserRole, require_roles
from app.core.security import get_current_user
from app.db.session import get_db
from app.dependencies import PaginatedResponse, get_pagination_params
from app.modules.stores import service
from app.modules.stores.schemas import (
    StoreCreate,
    StoreListResponse,
    StoreResponse,
    StoreUpdate,
)

router = APIRouter(prefix="/stores", tags=["Stores"])


@router.get("", response_model=StoreListResponse)
async def list_stores(
    db: AsyncSession = Depends(get_db),
    pagination: dict = Depends(get_pagination_params),
    current_user=Depends(get_current_user),
    is_active: bool | None = None,
):
    """
    Lista todas as lojas.
    - Owner: vê todas as lojas
    - Supervisor: vê apenas lojas sob sua supervisão
    - Operator: vê apenas sua loja
    """
    stores, total = await service.list_stores(
        db=db,
        user=current_user,
        page=pagination["page"],
        limit=pagination["limit"],
        is_active=is_active,
    )

    return PaginatedResponse.create(
        items=[StoreResponse.model_validate(s) for s in stores],
        total=total,
        page=pagination["page"],
        limit=pagination["limit"],
    )


@router.get("/{store_id}", response_model=StoreResponse)
async def get_store(
    store_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Obtém detalhes de uma loja específica."""
    store = await service.get_store(db=db, store_id=store_id, user=current_user)
    return StoreResponse.model_validate(store)


@router.post(
    "",
    response_model=StoreResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def create_store(
    data: StoreCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Cria uma nova loja.
    Apenas owners podem criar lojas.
    """
    store = await service.create_store(db=db, data=data, created_by_id=current_user.id)
    return StoreResponse.model_validate(store)


@router.patch(
    "/{store_id}",
    response_model=StoreResponse,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def update_store(
    store_id: int,
    data: StoreUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Atualiza uma loja existente.
    Apenas owners podem atualizar lojas.
    """
    store = await service.update_store(
        db=db, store_id=store_id, data=data, updated_by_id=current_user.id
    )
    return StoreResponse.model_validate(store)


@router.delete(
    "/{store_id}",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def delete_store(
    store_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Exclui permanentemente uma loja.
    Apenas owners podem excluir lojas.
    Retorna erro 409 se a loja possuir vínculos ativos.
    """
    return await service.delete_store(db=db, store_id=store_id)
