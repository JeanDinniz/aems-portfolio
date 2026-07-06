"""
Employee service - Business logic for employee management.
"""

from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit
from app.core.exceptions import ConflictError, NotFoundError
from app.core.pagination import paginate
from app.modules.employees.models import Employee, EmployeeMovement
from app.modules.employees.schemas import EmployeeCreate, EmployeeUpdate, MovementCreate

if TYPE_CHECKING:
    from app.modules.auth.models import User


async def list_employees(
    db: AsyncSession,
    store_id: int | None = None,
    is_active: bool | None = None,
    hr_status: str | None = None,
    search: str | None = None,
    department: str | None = None,
    position: str | None = None,
    is_volante: bool | None = None,
    for_galpon: bool = False,
    page: int = 1,
    limit: int = 20,
) -> tuple[list[Employee], int]:
    """
    Lista funcionários com filtros opcionais.

    Args:
        db: Sessão do banco de dados
        store_id: Filtro por loja — inclui também funcionários volantes de outras lojas
        is_active: Filtro por status ativo (opcional) — se True e hr_status=None, filtra hr_status='active'
        hr_status: Filtro por hr_status ('active'|'away'|'dismissed') — tem precedência sobre is_active
        search: Busca por nome (ILIKE, opcional)
        department: Filtro por departamento — inclui também funcionários sem departamento (opcional)
        position: Filtro por cargo exato (opcional)
        is_volante: Filtro por funcionário volante (opcional)
        for_galpon: Quando True, retorna works_in_galpon=True OU is_volante=True (ignora store_id)
        page: Página atual
        limit: Itens por página

    Returns:
        Tuple com lista de funcionários e total de itens
    """
    from sqlalchemy import or_

    query = select(Employee).options(selectinload(Employee.store))

    # HML-128: filtro galpão tem precedência sobre store_id
    if for_galpon:
        query = query.where(or_(Employee.works_in_galpon.is_(True), Employee.is_volante.is_(True)))
    elif store_id is not None:
        # HML-126: funcionários volantes aparecem em todas as lojas
        query = query.where(or_(Employee.store_id == store_id, Employee.is_volante.is_(True)))

    if hr_status is not None:
        query = query.where(Employee.hr_status == hr_status)
    elif is_active is not None:
        if is_active:
            query = query.where(Employee.hr_status == "active")
        else:
            query = query.where(Employee.is_active == is_active)

    if search:
        pattern = f"%{search}%"
        query = query.where(Employee.name.ilike(pattern))

    if department is not None:
        # Funcionários sem departamento aparecem em todos os filtros
        query = query.where(or_(Employee.department == department, Employee.department.is_(None)))

    if position is not None:
        query = query.where(Employee.position == position)

    # HML-126: filtro direto por flag volante
    if is_volante is not None:
        query = query.where(Employee.is_volante == is_volante)

    return await paginate(db, query, page, limit, order_by=Employee.name)


async def get_employee(db: AsyncSession, employee_id: int) -> Employee:
    """
    Obtém um funcionário por ID com loja carregada via selectinload.

    Args:
        db: Sessão do banco de dados
        employee_id: ID do funcionário

    Returns:
        Employee encontrado

    Raises:
        NotFoundError: Funcionário não encontrado
    """
    result = await db.execute(
        select(Employee).options(selectinload(Employee.store)).where(Employee.id == employee_id)
    )
    employee = result.scalar_one_or_none()

    if not employee:
        raise NotFoundError(resource="Funcionário")

    return employee


async def create_employee(
    db: AsyncSession,
    data: EmployeeCreate,
    created_by: "User | None" = None,
) -> Employee:
    """
    Cria um novo funcionário.

    Args:
        db: Sessão do banco de dados
        data: Dados do novo funcionário

    Returns:
        Employee criado com relacionamento store carregado

    Raises:
        NotFoundError: Loja não encontrada
    """
    from app.modules.stores.service import get_store_by_id

    # Verificar se a loja existe
    store = await get_store_by_id(db, data.store_id)
    if not store:
        raise NotFoundError(resource="Loja")

    # Verificar duplicidade de nome + loja
    dup = await db.scalar(
        select(Employee).where(
            Employee.name == data.name,
            Employee.store_id == data.store_id,
        )
    )
    if dup:
        raise ConflictError(detail="Já existe um funcionário com este nome nesta loja.")

    employee = Employee(**data.model_dump())
    db.add(employee)
    await db.flush()

    await log_audit(
        db=db,
        action="create",
        resource_type="employee",
        user_id=created_by.id if created_by else None,
        resource_id=employee.id,
        new_value={"name": data.name, "store_id": data.store_id, "department": data.department},
    )

    # Reload with relationship to avoid MissingGreenlet in async context
    result = await db.execute(
        select(Employee).options(selectinload(Employee.store)).where(Employee.id == employee.id)
    )
    return result.scalar_one()


def build_employee_response(employee: "Employee") -> dict:
    """
    Constrói um dicionário com os dados do funcionário prontos para serialização.

    Acessa o relacionamento ``store`` (deve estar carregado via selectinload)
    para preencher ``store_name``, mantendo essa lógica de projeção fora do router.

    Args:
        employee: Instância de Employee com o relacionamento store carregado

    Returns:
        Dict compatível com EmployeeResponse.model_validate()
    """
    return {
        "id": employee.id,
        "name": employee.name,
        "store_id": employee.store_id,
        "department": employee.department,
        "position": employee.position,
        "store_name": employee.store.name if employee.store else None,
        "is_active": employee.is_active,
        # HML-126
        "is_volante": getattr(employee, "is_volante", False),
        # HML-128
        "works_in_galpon": getattr(employee, "works_in_galpon", False),
        # HML-58
        "entry_date": getattr(employee, "entry_date", None),
        "phone": getattr(employee, "phone", None),
        "email": getattr(employee, "email", None),
        "pix_key": getattr(employee, "pix_key", None),
        "bank_account": getattr(employee, "bank_account", None),
        "address": getattr(employee, "address", None),
        "transport_allowance": getattr(employee, "transport_allowance", None),
        # HML-73
        "dismissal_date": getattr(employee, "dismissal_date", None),
        "dismissal_reason": getattr(employee, "dismissal_reason", None),
        "would_rehire": getattr(employee, "would_rehire", None),
        "vacation_month": getattr(employee, "vacation_month", None),
        # Novos campos de RH
        "last_name": getattr(employee, "last_name", None),
        "birth_date": getattr(employee, "birth_date", None),
        "hr_status": getattr(employee, "hr_status", "active"),
        "created_at": employee.created_at,
        "updated_at": employee.updated_at,
    }


async def update_employee(
    db: AsyncSession, employee_id: int, data: EmployeeUpdate, user: "User | None" = None
) -> Employee:
    """
    Atualiza um funcionário existente.

    Args:
        db: Sessão do banco de dados
        employee_id: ID do funcionário
        data: Dados para atualização
        user: Usuário que está atualizando (para verificação de permissão)

    Returns:
        Employee atualizado com relacionamento store carregado

    Raises:
        NotFoundError: Funcionário não encontrado
    """
    employee = await get_employee(db, employee_id)

    update_data = data.model_dump(exclude_unset=True)

    # Verificar duplicidade de nome + loja (ignorando o próprio registro)
    new_name = update_data.get("name", employee.name)
    new_store_id = update_data.get("store_id", employee.store_id)
    if "name" in update_data or "store_id" in update_data:
        dup = await db.scalar(
            select(Employee).where(
                Employee.name == new_name,
                Employee.store_id == new_store_id,
                Employee.id != employee_id,
            )
        )
        if dup:
            raise ConflictError(detail="Já existe um funcionário com este nome nesta loja.")

    old_values = {k: getattr(employee, k, None) for k in update_data}
    for field, value in update_data.items():
        setattr(employee, field, value)

    await db.flush()

    await log_audit(
        db=db,
        action="update",
        resource_type="employee",
        user_id=user.id if user else None,
        resource_id=employee.id,
        old_value=old_values,
        new_value=update_data,
    )

    # Reload with relationship to ensure store is available
    result = await db.execute(
        select(Employee).options(selectinload(Employee.store)).where(Employee.id == employee.id)
    )
    return result.scalar_one()


async def delete_employee(db: AsyncSession, employee_id: int, user: "User | None" = None) -> dict:
    """
    Exclui permanentemente um funcionário.

    Raises:
        NotFoundError: Funcionário não encontrado
        ConflictError: Funcionário possui vínculos ativos (O.S. workers)
    """
    from sqlalchemy.exc import IntegrityError

    employee = await get_employee(db, employee_id)

    deleted_info = {"id": employee.id, "name": employee.name}

    await log_audit(
        db=db,
        action="delete",
        resource_type="employee",
        user_id=user.id if user else None,
        resource_id=employee.id,
        old_value={"name": employee.name, "store_id": employee.store_id},
    )

    try:
        await db.delete(employee)
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ConflictError(
            detail="Não é possível excluir o funcionário pois ele possui vínculos "
            "em ordens de serviço. Remova os vínculos antes de excluir."
        ) from None

    return deleted_info


async def get_employee_stats(db: AsyncSession, store_id: int | None = None) -> dict:
    """
    Retorna estatísticas de funcionários agrupadas por hr_status e férias planejadas.

    Args:
        db: Sessão do banco de dados
        store_id: Filtro por loja (opcional)

    Returns:
        Dict com total, active, away, dismissed, vacations_planned
    """
    base_q = select(Employee)
    if store_id:
        base_q = base_q.where(Employee.store_id == store_id)

    total = (await db.execute(select(func.count()).select_from(base_q.subquery()))).scalar_one()

    active_q = base_q.where(Employee.hr_status == "active")
    active = (await db.execute(select(func.count()).select_from(active_q.subquery()))).scalar_one()

    away_q = base_q.where(Employee.hr_status == "away")
    away = (await db.execute(select(func.count()).select_from(away_q.subquery()))).scalar_one()

    dismissed_q = base_q.where(Employee.hr_status == "dismissed")
    dismissed = (
        await db.execute(select(func.count()).select_from(dismissed_q.subquery()))
    ).scalar_one()

    vac_q = select(func.count(EmployeeMovement.id)).where(
        EmployeeMovement.type == "vacation",
        EmployeeMovement.movement_date >= date.today(),
    )
    if store_id:
        vac_q = vac_q.join(Employee, EmployeeMovement.employee_id == Employee.id).where(
            Employee.store_id == store_id
        )
    vacations_planned = (await db.execute(vac_q)).scalar_one()

    return {
        "total": total,
        "active": active,
        "away": away,
        "dismissed": dismissed,
        "vacations_planned": vacations_planned,
    }


async def list_movements(
    db: AsyncSession, employee_id: int, page: int = 1, limit: int = 20
) -> tuple[list, int]:
    """
    Lista movimentações de um funcionário com paginação.

    Args:
        db: Sessão do banco de dados
        employee_id: ID do funcionário
        page: Página atual
        limit: Itens por página

    Returns:
        Tuple com lista de movimentações e total

    Raises:
        NotFoundError: Funcionário não encontrado
    """
    await get_employee(db, employee_id)

    query = (
        select(EmployeeMovement)
        .where(EmployeeMovement.employee_id == employee_id)
        .order_by(
            EmployeeMovement.movement_date.desc(),
            EmployeeMovement.created_at.desc(),
        )
    )
    return await paginate(db, query, page, limit)


async def get_movement(db: AsyncSession, employee_id: int, movement_id: int) -> EmployeeMovement:
    """
    Obtém uma movimentação específica de um funcionário.

    Raises:
        NotFoundError: Movimentação não encontrada
    """
    result = await db.execute(
        select(EmployeeMovement).where(
            EmployeeMovement.id == movement_id,
            EmployeeMovement.employee_id == employee_id,
        )
    )
    movement = result.scalar_one_or_none()
    if not movement:
        raise NotFoundError("Movimentação não encontrada")
    return movement


async def create_movement(
    db: AsyncSession,
    employee_id: int,
    data: MovementCreate,
    current_user: "User",
) -> EmployeeMovement:
    """
    Cria uma movimentação de RH para o funcionário e aplica side effects conforme o tipo.

    Side effects:
    - dismissal  → hr_status='dismissed', is_active=False, atualiza dismissal_date/reason se fornecidos
    - absence    → hr_status='away'
    - transfer   → atualiza store_id se destination_store_id fornecido em movement_data
    - promotion  → atualiza position se new_position fornecido em movement_data

    Raises:
        NotFoundError: Funcionário não encontrado
    """
    from datetime import datetime as dt

    employee = await get_employee(db, employee_id)

    movement = EmployeeMovement(
        employee_id=employee_id,
        type=data.type,
        movement_date=data.movement_date,
        movement_data=data.movement_data,
        attachment_url=data.attachment_url,
        notes=data.notes,
        created_by_id=current_user.id,
    )
    db.add(movement)

    if data.type == "dismissal":
        employee.hr_status = "dismissed"
        employee.is_active = False
        if data.movement_data:
            if data.movement_data.get("dismissal_date"):
                try:
                    employee.dismissal_date = dt.strptime(
                        data.movement_data["dismissal_date"], "%Y-%m-%d"
                    ).date()
                except Exception:
                    pass
            if data.movement_data.get("reason"):
                employee.dismissal_reason = data.movement_data.get("reason")
    elif data.type == "absence":
        employee.hr_status = "away"
    elif data.type == "transfer" and data.movement_data:
        dest_store_id = data.movement_data.get("destination_store_id")
        if dest_store_id:
            employee.store_id = int(dest_store_id)
    elif data.type == "promotion" and data.movement_data:
        new_pos = data.movement_data.get("new_position")
        if new_pos:
            employee.position = new_pos

    await db.flush()
    await db.refresh(movement)
    return movement


async def delete_movement(
    db: AsyncSession, employee_id: int, movement_id: int, user: "User"
) -> dict:
    """
    Exclui uma movimentação de funcionário.

    Raises:
        NotFoundError: Movimentação não encontrada
    """
    movement = await get_movement(db, employee_id, movement_id)
    await db.delete(movement)
    await db.flush()
    return {"id": movement_id, "deleted": True}


async def list_vacation_movements(
    db: AsyncSession,
    store_id: int | None = None,
    search: str | None = None,
    position: str | None = None,
) -> list:
    """
    Lista movimentações do tipo 'vacation' com filtros opcionais.

    Args:
        db: Sessão do banco de dados
        store_id: Filtro por loja do funcionário (opcional)
        search: Busca por nome do funcionário (opcional)
        position: Filtro por cargo do funcionário (opcional)

    Returns:
        Lista de EmployeeMovement com employee carregado, ordenada por movement_date asc
    """
    query = (
        select(EmployeeMovement)
        .join(Employee, EmployeeMovement.employee_id == Employee.id)
        .where(EmployeeMovement.type == "vacation")
        .options(selectinload(EmployeeMovement.employee).selectinload(Employee.store))
    )
    if store_id:
        query = query.where(Employee.store_id == store_id)
    if search:
        query = query.where(Employee.name.ilike(f"%{search}%"))
    if position:
        query = query.where(Employee.position == position)
    query = query.order_by(EmployeeMovement.movement_date.asc())
    result = await db.execute(query)
    return result.scalars().all()
