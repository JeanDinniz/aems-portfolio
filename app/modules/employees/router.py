"""
Employee router - API endpoints for employee management.
"""

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

if TYPE_CHECKING:
    from app.modules.employees.models import EmployeeMovement

from app.core.permissions import UserRole, require_roles
from app.core.security import get_current_user
from app.db.session import get_db
from app.dependencies import PaginatedResponse, get_pagination_params
from app.modules.employees import service
from app.modules.employees.schemas import (
    EmployeeCreate,
    EmployeeListResponse,
    EmployeeResponse,
    EmployeeStatsResponse,
    EmployeeUpdate,
    MovementCreate,
    MovementListResponse,
    MovementResponse,
)

router = APIRouter(prefix="/employees", tags=["Employees"])


@router.get("", response_model=EmployeeListResponse)
async def list_employees(
    db: AsyncSession = Depends(get_db),
    pagination: dict = Depends(get_pagination_params),
    current_user=Depends(get_current_user),
    store_id: int | None = Query(None, description="Filtrar por loja"),
    is_active: bool | None = Query(None, description="Filtrar por status ativo"),
    hr_status: str | None = Query(
        None, description="Filtrar por hr_status (active|away|dismissed)"
    ),
    search: str | None = Query(None, description="Busca por nome"),
    department: str | None = Query(
        None,
        description="Filtrar por departamento (inclui funcionários sem departamento)",
    ),
    position: str | None = Query(None, description="Filtrar por cargo exato"),
    is_volante: bool | None = Query(None, description="Filtrar por funcionário volante"),
    for_galpon: bool = Query(
        False,
        description="Filtrar funcionários do galpão (works_in_galpon ou is_volante)",
    ),
):
    """
    Lista todos os funcionários com filtros opcionais.
    - Owner: vê funcionários de todas as lojas
    - Supervisor/Operator: pode filtrar por loja específica
    Quando `department` é informado, retorna funcionários daquele departamento
    mais os que não têm departamento definido (aparecem em todos).
    Quando `store_id` é informado, inclui também funcionários volantes (is_volante=True).
    Quando `for_galpon=True`, retorna works_in_galpon=True OU is_volante=True (ignora store_id).
    """
    employees, total = await service.list_employees(
        db=db,
        store_id=store_id,
        is_active=is_active,
        hr_status=hr_status,
        search=search,
        department=department,
        position=position,
        is_volante=is_volante,
        for_galpon=for_galpon,
        page=pagination["page"],
        limit=pagination["limit"],
    )

    return PaginatedResponse.create(
        items=[
            EmployeeResponse.model_validate(service.build_employee_response(emp))
            for emp in employees
        ],
        total=total,
        page=pagination["page"],
        limit=pagination["limit"],
    )


@router.get("/stats", response_model=EmployeeStatsResponse)
async def employee_stats(
    store_id: int | None = Query(None, description="Filtrar por loja"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
) -> EmployeeStatsResponse:
    """Retorna estatísticas de funcionários por hr_status e férias planejadas."""
    stats = await service.get_employee_stats(db, store_id=store_id)
    return EmployeeStatsResponse(**stats)


@router.get("/vacations")
async def vacation_movements(
    store_id: int | None = Query(None, description="Filtrar por loja"),
    search: str | None = Query(None, description="Busca por nome do funcionário"),
    position: str | None = Query(None, description="Filtrar por cargo"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Lista todas as movimentações de férias com dados do funcionário."""
    movements = await service.list_vacation_movements(
        db, store_id=store_id, search=search, position=position
    )
    result = []
    for m in movements:
        emp = m.employee
        result.append(
            {
                "id": m.id,
                "employee_id": m.employee_id,
                "employee_name": emp.name if emp else "",
                "employee_last_name": emp.last_name if emp else None,
                "employee_position": emp.position if emp else None,
                "employee_store_id": emp.store_id if emp else None,
                "employee_store_name": emp.store.name if emp and emp.store else None,
                "type": m.type,
                "movement_date": m.movement_date.isoformat() if m.movement_date else None,
                "movement_data": m.movement_data,
                "attachment_url": m.attachment_url,
                "notes": m.notes,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
        )
    return result


@router.get("/{employee_id}", response_model=EmployeeResponse)
async def get_employee(
    employee_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Obtém detalhes de um funcionário específico."""
    employee = await service.get_employee(db=db, employee_id=employee_id)
    return EmployeeResponse.model_validate(service.build_employee_response(employee))


@router.post("", response_model=EmployeeResponse, status_code=status.HTTP_201_CREATED)
async def create_employee(
    data: EmployeeCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Cria um novo funcionário.
    Todos os usuários autenticados podem criar funcionários.
    """
    employee = await service.create_employee(db=db, data=data, created_by=current_user)
    return EmployeeResponse.model_validate(service.build_employee_response(employee))


@router.patch(
    "/{employee_id}",
    response_model=EmployeeResponse,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def update_employee(
    employee_id: int,
    data: EmployeeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Atualiza um funcionário existente.
    Apenas Owners e Supervisors podem atualizar funcionários.
    """
    employee = await service.update_employee(
        db=db, employee_id=employee_id, data=data, user=current_user
    )
    return EmployeeResponse.model_validate(service.build_employee_response(employee))


@router.delete(
    "/{employee_id}",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def delete_employee(
    employee_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Exclui permanentemente um funcionário.
    Apenas Owners e Supervisors podem excluir funcionários.
    Retorna erro 409 se o funcionário possuir vínculos em ordens de serviço.
    """
    return await service.delete_employee(db=db, employee_id=employee_id, user=current_user)


# ---------------------------------------------------------------------------
# Movement endpoints — DEVEM vir após os endpoints de funcionário para que
# FastAPI resolva /{employee_id} antes de /{employee_id}/movements
# ---------------------------------------------------------------------------


async def _load_movement_full(db: AsyncSession, movement_id: int) -> "EmployeeMovement":
    """Carrega um EmployeeMovement com employee e created_by via selectinload."""
    from sqlalchemy.orm import selectinload

    from app.modules.employees.models import EmployeeMovement

    result = await db.execute(
        select(EmployeeMovement)
        .where(EmployeeMovement.id == movement_id)
        .options(
            selectinload(EmployeeMovement.employee),
            selectinload(EmployeeMovement.created_by),
        )
    )
    return result.scalar_one()


def _movement_to_response(m: "EmployeeMovement") -> MovementResponse:
    """Projeta um EmployeeMovement carregado para MovementResponse."""
    return MovementResponse(
        id=m.id,
        employee_id=m.employee_id,
        employee_name=m.employee.name if m.employee else "",
        type=m.type,
        movement_date=m.movement_date,
        movement_data=m.movement_data,
        attachment_url=m.attachment_url,
        notes=m.notes,
        created_by_id=m.created_by_id,
        created_by_name=m.created_by.full_name if m.created_by else None,
        created_at=m.created_at,
    )


@router.get("/{employee_id}/movements", response_model=MovementListResponse)
async def list_movements(
    employee_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
) -> MovementListResponse:
    """Lista movimentações de RH de um funcionário com paginação."""

    items, total = await service.list_movements(db, employee_id, page, limit)
    result = []
    for m in items:
        m_full = await _load_movement_full(db, m.id)
        result.append(_movement_to_response(m_full))
    return MovementListResponse(
        **PaginatedResponse.create(items=result, total=total, page=page, limit=limit)
    )


@router.post(
    "/{employee_id}/movements",
    response_model=MovementResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_movement(
    employee_id: int,
    data: MovementCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
) -> MovementResponse:
    """Registra uma movimentação de RH para o funcionário."""
    movement = await service.create_movement(db, employee_id, data, current_user)
    m_full = await _load_movement_full(db, movement.id)
    return _movement_to_response(m_full)


@router.get("/{employee_id}/movements/{movement_id}", response_model=MovementResponse)
async def get_movement(
    employee_id: int,
    movement_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
) -> MovementResponse:
    """Obtém uma movimentação específica de um funcionário."""
    from sqlalchemy.orm import selectinload

    from app.modules.employees.models import EmployeeMovement

    result = await db.execute(
        select(EmployeeMovement)
        .where(
            EmployeeMovement.id == movement_id,
            EmployeeMovement.employee_id == employee_id,
        )
        .options(
            selectinload(EmployeeMovement.employee),
            selectinload(EmployeeMovement.created_by),
        )
    )
    m_full = result.scalar_one_or_none()
    if not m_full:
        from app.core.exceptions import NotFoundError

        raise NotFoundError("Movimentação não encontrada")
    return _movement_to_response(m_full)


@router.delete(
    "/{employee_id}/movements/{movement_id}",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def delete_movement(
    employee_id: int,
    movement_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
) -> dict:
    """Exclui uma movimentação de RH. Apenas Owners podem excluir."""
    return await service.delete_movement(db, employee_id, movement_id, current_user)
