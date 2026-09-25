"""
Employee service - Business logic for employee management.
"""

from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit
from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.core.pagination import paginate
from app.core.permissions import (
    PermissionChecker,
    is_owner,
    require_resource_access,
)
from app.modules.employees.models import Employee, EmployeeMovement
from app.modules.employees.schemas import EmployeeCreate, EmployeeUpdate, MovementCreate

if TYPE_CHECKING:
    from app.modules.auth.models import User


def scope_employees_query(query, user: "User"):
    """Restringe uma query de Employee ao escopo de loja do usuário.

    Regra de negócio: funcionários VOLANTES (``is_volante``) são compartilhados
    entre lojas e permanecem visíveis a todos (HML-126). O que se bloqueia é a
    ENUMERAÇÃO do quadro fixo de outra loja por um não-owner.
    """
    from sqlalchemy import or_

    if is_owner(user):
        return query
    store_ids = PermissionChecker.get_user_store_ids(user)
    if not store_ids:
        return query.where(Employee.is_volante.is_(True))
    return query.where(or_(Employee.store_id.in_(store_ids), Employee.is_volante.is_(True)))


def require_employee_access(user: "User", employee: Employee) -> None:
    """Autoriza acesso a UM funcionário por id.

    Libera para owner e para funcionário volante (compartilhado); caso contrário
    exige acesso à loja do funcionário. Usa NotFoundError (não revela existência).
    """
    if is_owner(user) or getattr(employee, "is_volante", False):
        return
    require_resource_access(user, employee.store_id, "Funcionário")


# Critério de "instalador": funcionário cujo CARGO (position) contém "instalador".
# Usado para excluir instaladores da equipe do Resumo Diário e do Nº de
# funcionários das metas do Dashboard (decisão da operação: instaladores de
# película não entram no quadro da loja).
INSTALLER_POSITION_KEYWORD = "instalador"


def is_installer_position(position: str | None) -> bool:
    """True quando o cargo indica instalador (case-insensitive)."""
    if not position:
        return False
    return INSTALLER_POSITION_KEYWORD in position.lower()


def installer_position_condition():
    """Condição SQL: True quando o cargo do funcionário indica instalador."""
    return Employee.position.isnot(None) & Employee.position.ilike(
        f"%{INSTALLER_POSITION_KEYWORD}%"
    )


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
    has_user: bool | None = None,
    page: int = 1,
    limit: int = 20,
    user: "User | None" = None,
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
        has_user: Filtro por vínculo com usuário — True=com vínculo, False=sem vínculo (opcional)
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

    if has_user is not None:
        query = query.where(
            Employee.user_id.is_not(None) if has_user else Employee.user_id.is_(None)
        )

    # Segurança: restringe ao escopo de loja do usuário (owner vê tudo; volantes
    # permanecem visíveis). Impede enumerar o quadro de outra loja via store_id.
    if user is not None:
        query = scope_employees_query(query, user)

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

    # Segurança: não-owner só cria funcionário em loja do seu escopo.
    if created_by is not None:
        require_resource_access(created_by, data.store_id, "Loja")

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

    if data.user_id:
        await _validate_user_link(db, data.user_id)

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

    # Catálogo de funcionários é cacheado no editor de O.S. — invalida pós-commit
    # (get_db lê a flag e bumpa depois que o dado persistir).
    db.info["bump_catalogs"] = True

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
        # Ponto Eletrônico
        "user_id": getattr(employee, "user_id", None),
        "user_name": linked_user.full_name
        if (linked_user := getattr(employee, "user", None))
        else None,
        "work_start_time": getattr(employee, "work_start_time", None),
        "work_end_time": getattr(employee, "work_end_time", None),
        "created_at": employee.created_at,
        "updated_at": employee.updated_at,
    }


async def _validate_user_link(
    db: AsyncSession, user_id: int, exclude_employee_id: int | None = None
) -> None:
    """Valida o vínculo User↔Employee (usuário existe e não está em outro funcionário)."""
    from app.modules.auth.models import User as UserModel

    user = await db.scalar(select(UserModel).where(UserModel.id == user_id))
    if not user:
        raise NotFoundError(resource="Usuário")

    query = select(Employee).where(Employee.user_id == user_id)
    if exclude_employee_id is not None:
        query = query.where(Employee.id != exclude_employee_id)
    linked = await db.scalar(query)
    if linked:
        raise ConflictError(
            detail=f"Este usuário já está vinculado ao funcionário '{linked.name}'."
        )


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

    # C3 (auditoria): escopo de loja — o gate OWNER-only foi trocado por
    # employees:can_edit, então a autorização de loja passa a ser aqui.
    if user is not None:
        require_resource_access(user, employee.store_id, "Funcionário")

    update_data = data.model_dump(exclude_unset=True)

    # Ao mover de loja, exigir acesso também à loja de destino (não escapar do escopo)
    if user is not None and "store_id" in update_data:
        require_resource_access(user, update_data["store_id"], "Loja")

    # Ponto Eletrônico: vínculo de usuário (clear_user desfaz; 0/None também)
    if update_data.pop("clear_user", False):
        update_data["user_id"] = None
    if update_data.get("user_id") == 0:
        update_data["user_id"] = None
    if update_data.get("user_id"):
        await _validate_user_link(db, update_data["user_id"], exclude_employee_id=employee_id)

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

    db.info["bump_catalogs"] = True

    # Reload with relationships; populate_existing refresca a instância do identity map
    # (senão o relacionamento `user` fica stale após alterar user_id)
    result = await db.execute(
        select(Employee)
        .options(selectinload(Employee.store), selectinload(Employee.user))
        .where(Employee.id == employee.id)
        .execution_options(populate_existing=True)
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

    # C3 (auditoria): escopo de loja — gate OWNER-only trocado por employees:can_delete.
    if user is not None:
        require_resource_access(user, employee.store_id, "Funcionário")

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

    db.info["bump_catalogs"] = True

    return deleted_info


async def get_employee_stats(
    db: AsyncSession, store_id: int | None = None, user: "User | None" = None
) -> dict:
    """
    Retorna estatísticas de funcionários agrupadas por hr_status e férias planejadas.

    Args:
        db: Sessão do banco de dados
        store_id: Filtro por loja (opcional)
        user: Usuário atual — restringe as estatísticas ao seu escopo de loja

    Returns:
        Dict com total, active, away, dismissed, vacations_planned
    """
    base_q = select(Employee)
    if store_id:
        base_q = base_q.where(Employee.store_id == store_id)
    if user is not None:
        base_q = scope_employees_query(base_q, user)

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
    if store_id or user is not None:
        vac_q = vac_q.join(Employee, EmployeeMovement.employee_id == Employee.id)
        if store_id:
            vac_q = vac_q.where(Employee.store_id == store_id)
        if user is not None:
            vac_q = scope_employees_query(vac_q, user)
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

    # 🟠 (auditoria): eager-load de employee/created_by evita o N+1 do router
    # (que recarregava cada movimento individualmente para projetar a resposta).
    query = (
        select(EmployeeMovement)
        .where(EmployeeMovement.employee_id == employee_id)
        .options(
            selectinload(EmployeeMovement.employee),
            selectinload(EmployeeMovement.created_by),
        )
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

    from app.core.permissions import require_resource_access

    employee = await get_employee(db, employee_id)
    require_resource_access(current_user, employee.store_id, "Funcionário")

    # Falta precisa da data para alimentar o Resumo Diário (equipe do dia)
    if data.type == "fault":
        fault_date = (data.movement_data or {}).get("date")
        try:
            dt.strptime(str(fault_date), "%Y-%m-%d")
        except (ValueError, TypeError):
            raise ValidationError(
                detail="Data da falta é obrigatória (movement_data.date, formato YYYY-MM-DD)"
            ) from None

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
    from app.core.permissions import require_resource_access

    employee = await get_employee(db, employee_id)
    require_resource_access(user, employee.store_id, "Funcionário")

    movement = await get_movement(db, employee_id, movement_id)
    await db.delete(movement)
    await db.flush()
    return {"id": movement_id, "deleted": True}


async def list_vacation_movements(
    db: AsyncSession,
    store_id: int | None = None,
    search: str | None = None,
    position: str | None = None,
    user: "User | None" = None,
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
    if user is not None:
        query = scope_employees_query(query, user)
    if search:
        query = query.where(Employee.name.ilike(f"%{search}%"))
    if position:
        query = query.where(Employee.position == position)
    query = query.order_by(EmployeeMovement.movement_date.asc())
    result = await db.execute(query)
    return result.scalars().all()


# =============================================================================
# Status do dia — fonte única para a tela Faltas do Dia e o Resumo Diário (PDF)
# =============================================================================

DAY_STATUS_PRESENT = "presente"
DAY_STATUS_FAULT = "falta"
DAY_STATUS_VACATION = "ferias"
DAY_STATUS_ABSENCE = "afastado"

FAULT_TYPE_LABELS = {
    "injustificada": "Injustificada",
    "atestado": "Atestado",
    "folga": "Folga",
}

ABSENCE_TYPE_LABELS = {
    "atestado": "Atestado",
    "inss": "INSS",
    "licenca_maternidade": "Licença Maternidade",
    "outro": "Outro",
}


def _parse_iso_date(value) -> date | None:
    try:
        return date.fromisoformat(str(value))
    except (ValueError, TypeError):
        return None


def movement_covers_day(movement: EmployeeMovement, day: date) -> tuple[bool, str]:
    """
    Verifica se um movimento de falta/férias/afastamento cobre a data.
    Retorna (cobre, motivo legível).
    """
    from datetime import timedelta

    data = movement.movement_data or {}

    if movement.type == "fault":
        start = _parse_iso_date(data.get("date"))
        if start is None:
            return False, ""
        days = int(data.get("days_count") or 1)
        end = start + timedelta(days=max(days, 1) - 1)
        if start <= day <= end:
            label = FAULT_TYPE_LABELS.get(str(data.get("fault_type")))
            return True, f"Falta: {label}" if label else "Falta"
        return False, ""

    if movement.type == "vacation":
        start = _parse_iso_date(data.get("start_date"))
        if start is None:
            return False, ""
        # return_date = dia em que volta ao trabalho (exclusivo)
        raw_return = _parse_iso_date(data.get("return_date") or data.get("forecast_date"))
        end = raw_return - timedelta(days=1) if raw_return else start + timedelta(days=29)
        if start <= day <= end:
            return True, "Férias"
        return False, ""

    if movement.type == "absence":
        start = _parse_iso_date(data.get("start_date"))
        if start is None:
            return False, ""
        raw_return = _parse_iso_date(data.get("return_date"))
        # Sem retorno definido: afastamento em aberto a partir do início
        end = raw_return - timedelta(days=1) if raw_return else None
        if start <= day and (end is None or day <= end):
            label = ABSENCE_TYPE_LABELS.get(str(data.get("absence_type")))
            return True, f"Afastamento: {label}" if label else "Afastamento"
        return False, ""

    return False, ""


async def get_day_status(db: AsyncSession, store_id: int, day: date) -> list[dict]:
    """
    Status de cada funcionário ativo da loja em um dia:
    presente | falta | ferias | afastado.

    Regras:
    - Falta/férias/afastamento derivados dos movimentos cujas datas cobrem o dia.
    - hr_status='away' sem NENHUM afastamento datado → 'afastado' (legado).
    - hr_status='away' com afastamento datado já encerrado → 'presente'
      com needs_return=True (oferecer "Registrar retorno" para normalizar).
    """
    from datetime import timedelta

    result = await db.execute(
        select(Employee)
        .where(
            Employee.store_id == store_id,
            Employee.is_active.is_(True),
            Employee.hr_status.in_(("active", "away")),
        )
        .order_by(Employee.name)
    )
    employees = list(result.scalars().all())
    if not employees:
        return []

    # Janela larga de registro: licenças longas são registradas meses antes do dia
    emp_ids = [e.id for e in employees]
    mov_result = await db.execute(
        select(EmployeeMovement)
        .where(
            EmployeeMovement.employee_id.in_(emp_ids),
            EmployeeMovement.type.in_(("fault", "vacation", "absence")),
            EmployeeMovement.movement_date >= day - timedelta(days=366),
            EmployeeMovement.movement_date <= day + timedelta(days=1),
        )
        .order_by(EmployeeMovement.created_at)
    )
    movements_by_emp: dict[int, list[EmployeeMovement]] = {}
    for mov in mov_result.scalars().all():
        movements_by_emp.setdefault(mov.employee_id, []).append(mov)

    items: list[dict] = []
    for emp in employees:
        display = f"{emp.name} {emp.last_name}".strip() if emp.last_name else emp.name
        movs = movements_by_emp.get(emp.id, [])

        status = DAY_STATUS_PRESENT
        reason: str | None = None
        fault_movement_id: int | None = None
        attachment_url: str | None = None
        needs_return = False

        # Prioridade: falta > férias > afastamento
        for wanted, day_status in (
            ("fault", DAY_STATUS_FAULT),
            ("vacation", DAY_STATUS_VACATION),
            ("absence", DAY_STATUS_ABSENCE),
        ):
            for mov in movs:
                if mov.type != wanted:
                    continue
                covers, mov_reason = movement_covers_day(mov, day)
                if covers:
                    status = day_status
                    reason = mov_reason
                    attachment_url = mov.attachment_url
                    if wanted == "fault":
                        fault_movement_id = mov.id
                    break
            if status != DAY_STATUS_PRESENT:
                break

        if status == DAY_STATUS_PRESENT and emp.hr_status == "away":
            has_dated_absence = any(
                mov.type == "absence"
                and _parse_iso_date((mov.movement_data or {}).get("start_date"))
                for mov in movs
            )
            if has_dated_absence:
                # Afastamento datado já encerrado — pessoa voltou, cadastro desatualizado
                needs_return = True
            else:
                status = DAY_STATUS_ABSENCE
                reason = "Afastamento"

        items.append(
            {
                "employee_id": emp.id,
                "name": display,
                "position": emp.position,
                "status": status,
                "reason": reason,
                "fault_movement_id": fault_movement_id,
                "attachment_url": attachment_url,
                "needs_return": needs_return,
            }
        )

    return items


async def mark_return_from_absence(db: AsyncSession, employee_id: int) -> Employee:
    """Normaliza o cadastro após o fim de um afastamento (hr_status → active)."""
    employee = await get_employee(db, employee_id)
    if employee.hr_status != "away":
        raise ValidationError("Funcionário não está afastado")
    employee.hr_status = "active"
    await db.flush()
    await db.refresh(employee)
    return employee
