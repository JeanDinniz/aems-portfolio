"""
Service router - API endpoints for service catalog management.
"""

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import UserRole, require_roles
from app.core.security import get_current_user
from app.db.session import get_db
from app.dependencies import PaginatedResponse
from app.modules.services import service
from app.modules.services.enums import ServiceDepartment
from app.modules.services.schemas import (
    ServiceCreate,
    ServiceListResponse,
    ServiceResponse,
    ServiceUpdate,
)

router = APIRouter(prefix="/services", tags=["Services"])


@router.get("", response_model=ServiceListResponse)
async def list_services(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    page: int = Query(1, ge=1, description="Página atual"),
    limit: int = Query(
        20, ge=1, le=1000, description="Itens por página (máx 1000 para catálogo completo)"
    ),
    department: ServiceDepartment | None = Query(None, description="Filtrar por departamento"),
    is_active: bool | None = Query(None, description="Filtrar por status ativo"),
    brand_id: int | None = Query(None, description="Filtrar por ID de marca"),
):
    """
    Lista todos os serviços do catálogo.
    Por padrão, retorna apenas serviços ativos.
    Quando department é fornecido, retorna serviços do departamento específico.
    """
    services, total = await service.list_services(
        db=db,
        department=department,
        is_active=is_active,
        brand_id=brand_id,
        page=page,
        limit=limit,
    )

    return PaginatedResponse.create(
        items=[ServiceResponse.model_validate(s) for s in services],
        total=total,
        page=page,
        limit=limit,
    )


@router.get("/{service_id}", response_model=ServiceResponse)
async def get_service(
    service_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Obtém detalhes de um serviço específico."""
    svc = await service.get_service(db=db, service_id=service_id)
    return ServiceResponse.model_validate(svc)


@router.post(
    "",
    response_model=ServiceResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def create_service(
    data: ServiceCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Cria um novo serviço no catálogo.
    Apenas Owners podem criar serviços.
    """
    svc = await service.create_service(db=db, data=data)
    return ServiceResponse.model_validate(svc)


@router.patch(
    "/{service_id}",
    response_model=ServiceResponse,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def update_service(
    service_id: int,
    data: ServiceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Atualiza um serviço existente.
    Apenas Owners podem atualizar serviços.
    """
    svc = await service.update_service(db=db, service_id=service_id, data=data)
    return ServiceResponse.model_validate(svc)


@router.delete(
    "/{service_id}",
    response_model=ServiceResponse,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def deactivate_service(
    service_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Desativa um serviço.
    Apenas Owners podem desativar serviços.
    O serviço não é excluído, apenas marcado como inativo.
    """
    svc = await service.deactivate_service(db=db, service_id=service_id)
    return ServiceResponse.model_validate(svc)
