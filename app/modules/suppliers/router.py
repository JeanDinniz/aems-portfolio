"""
Supplier router - API endpoints for supplier management.
"""

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import UserRole, require_roles
from app.core.security import get_current_user
from app.db.session import get_db
from app.dependencies import PaginatedResponse, get_pagination_params
from app.modules.suppliers import service
from app.modules.suppliers.schemas import (
    SupplierCreate,
    SupplierListResponse,
    SupplierResponse,
    SupplierUpdate,
)

router = APIRouter(prefix="/suppliers", tags=["Suppliers"])


@router.get("", response_model=SupplierListResponse)
async def list_suppliers(
    db: AsyncSession = Depends(get_db),
    pagination: dict = Depends(get_pagination_params),
    current_user=Depends(get_current_user),
    search: str | None = Query(None, description="Buscar por nome ou CNPJ"),
    is_active: bool | None = Query(None, description="Filtrar por status ativo"),
):
    """
    Lista todos os fornecedores com paginação e filtros opcionais.
    Acessível para qualquer usuário autenticado.
    """
    suppliers, total = await service.list_suppliers(
        db=db,
        page=pagination["page"],
        limit=pagination["limit"],
        search=search,
        is_active=is_active,
    )

    return PaginatedResponse.create(
        items=[SupplierResponse.model_validate(s) for s in suppliers],
        total=total,
        page=pagination["page"],
        limit=pagination["limit"],
    )


@router.get("/{supplier_id}", response_model=SupplierResponse)
async def get_supplier(
    supplier_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Obtém detalhes de um fornecedor específico."""
    supplier = await service.get_supplier(db=db, supplier_id=supplier_id)
    return SupplierResponse.model_validate(supplier)


@router.post(
    "",
    response_model=SupplierResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def create_supplier(
    data: SupplierCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Cria um novo fornecedor.
    Apenas Owners podem criar fornecedores.
    """
    supplier = await service.create_supplier(db=db, data=data, user=current_user)
    return SupplierResponse.model_validate(supplier)


@router.patch(
    "/{supplier_id}",
    response_model=SupplierResponse,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def update_supplier(
    supplier_id: int,
    data: SupplierUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Atualiza um fornecedor existente.
    Apenas Owners podem atualizar fornecedores.
    """
    supplier = await service.update_supplier(
        db=db, supplier_id=supplier_id, data=data, user=current_user
    )
    return SupplierResponse.model_validate(supplier)


@router.delete(
    "/{supplier_id}",
    response_model=SupplierResponse,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def deactivate_supplier(
    supplier_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Desativa um fornecedor.
    Apenas Owners podem desativar fornecedores.
    O fornecedor não é excluído, apenas marcado como inativo.
    """
    supplier = await service.deactivate_supplier(db=db, supplier_id=supplier_id, user=current_user)
    return SupplierResponse.model_validate(supplier)
