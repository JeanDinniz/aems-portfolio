"""
Service service - Business logic for service catalog management.
"""

from sqlalchemy import func, nullslast, select
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit
from app.core.exceptions import ConflictError, NotFoundError
from app.modules.services.enums import ServiceDepartment
from app.modules.services.models import Service
from app.modules.services.schemas import ServiceCreate, ServiceUpdate


async def get_service_by_id(db: AsyncSession, service_id: int) -> Service | None:
    """Busca serviço por ID."""
    result = await db.execute(
        select(Service).options(selectinload(Service.brand)).where(Service.id == service_id)
    )
    return result.scalar_one_or_none()


async def list_services(
    db: AsyncSession,
    department: ServiceDepartment | None = None,
    is_active: bool | None = None,
    brand_id: int | None = None,
    page: int = 1,
    limit: int = 50,
) -> tuple[list[Service], int]:
    """
    Lista serviços do catálogo.

    Args:
        db: Sessão do banco de dados
        department: Filtro por departamento (opcional)
        is_active: Filtro por status ativo
        brand_id: Filtro por ID de marca
        page: Página atual
        limit: Itens por página

    Returns:
        Tuple com lista de serviços e total de itens
    """
    query = select(Service).options(selectinload(Service.brand))

    if department is not None:
        query = query.where(Service.department == department.value)

    if brand_id is not None:
        query = query.where(Service.brand_id == brand_id)

    if is_active is not None:
        query = query.where(Service.is_active == is_active)
    else:
        query = query.where(Service.is_active)

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    # Paginate
    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit).order_by(nullslast(Service.code), Service.name)
    result = await db.execute(query)
    services = list(result.scalars().all())

    return services, total


async def get_service(db: AsyncSession, service_id: int) -> Service:
    """
    Obtém um serviço.

    Args:
        db: Sessão do banco de dados
        service_id: ID do serviço

    Returns:
        Service encontrado

    Raises:
        NotFoundError: Serviço não encontrado
    """
    service = await get_service_by_id(db, service_id)

    if not service:
        raise NotFoundError(resource="Serviço")

    return service


async def _check_duplicate(
    db: AsyncSession,
    code: str | None,
    brand_id: int,
    department: str,
    exclude_id: int | None = None,
) -> None:
    """
    Verifica duplicidade de (code, brand_id, department) quando code não é None.

    Raises:
        ConflictError: Já existe serviço com o mesmo código, marca e departamento
    """
    if code is None:
        return

    query = select(Service).where(
        Service.code == code,
        Service.brand_id == brand_id,
        Service.department == department,
        Service.is_active.is_(True),
    )
    if exclude_id is not None:
        query = query.where(Service.id != exclude_id)

    existing = await db.execute(query)
    if existing.scalar_one_or_none():
        raise ConflictError(
            detail=f"Já existe um serviço com código '{code}' para esta marca e departamento"
        )


async def _check_duplicate_name(
    db: AsyncSession,
    name: str,
    brand_id: int,
    department: str,
    exclude_id: int | None = None,
) -> None:
    """
    Verifica duplicidade de (name, brand_id, department).

    Raises:
        ConflictError: Já existe serviço com o mesmo nome, marca e departamento
    """
    query = select(Service).where(
        Service.name == name,
        Service.brand_id == brand_id,
        Service.department == department,
        Service.is_active.is_(True),
    )
    if exclude_id is not None:
        query = query.where(Service.id != exclude_id)

    existing = await db.execute(query)
    if existing.scalar_one_or_none():
        raise ConflictError(
            detail=f"Já existe um serviço com o nome '{name}' para esta marca e departamento."
        )


async def create_service(db: AsyncSession, data: ServiceCreate) -> Service:
    """
    Cria um novo serviço.

    Args:
        db: Sessão do banco de dados
        data: Dados do novo serviço

    Returns:
        Service criado

    Raises:
        ConflictError: Código duplicado para mesma marca e departamento
    """
    await _check_duplicate(
        db,
        code=data.code,
        brand_id=data.brand_id,
        department=data.department.value,
    )
    await _check_duplicate_name(
        db,
        name=data.name,
        brand_id=data.brand_id,
        department=data.department.value,
    )

    service_data = data.model_dump()
    service_data["department"] = data.department.value

    service = Service(**service_data)
    db.add(service)
    await db.flush()

    await log_audit(
        db=db,
        action="create",
        resource_type="service",
        user_id=None,
        resource_id=service.id,
        new_value={"name": service.name, "department": service.department},
    )

    await db.refresh(service, attribute_names=["brand"])

    return service


async def update_service(
    db: AsyncSession,
    service_id: int,
    data: ServiceUpdate,
) -> Service:
    """
    Atualiza um serviço existente.

    Args:
        db: Sessão do banco de dados
        service_id: ID do serviço
        data: Dados para atualização

    Returns:
        Service atualizado

    Raises:
        NotFoundError: Serviço não encontrado
        ConflictError: Código duplicado para mesma marca e departamento
    """
    service = await get_service(db, service_id)

    update_data = data.model_dump(exclude_unset=True)

    # Determinar os valores efetivos para validação de duplicidade
    new_code = update_data.get("code", service.code)
    new_brand_id = update_data.get("brand_id", service.brand_id)
    new_department_raw = update_data.get("department", service.department)
    new_department = (
        new_department_raw.value if hasattr(new_department_raw, "value") else new_department_raw
    )

    if "code" in update_data or "brand_id" in update_data or "department" in update_data:
        await _check_duplicate(
            db,
            code=new_code,
            brand_id=new_brand_id,
            department=new_department,
            exclude_id=service_id,
        )

    if "name" in update_data or "brand_id" in update_data or "department" in update_data:
        await _check_duplicate_name(
            db,
            name=update_data.get("name", service.name),
            brand_id=new_brand_id,
            department=new_department,
            exclude_id=service_id,
        )

    if "department" in update_data and update_data["department"] is not None:
        update_data["department"] = update_data["department"].value

    old_value = {field: getattr(service, field, None) for field in update_data}

    for field, value in update_data.items():
        setattr(service, field, value)

    await db.flush()

    if "is_courtesy_only" in update_data:
        # Exclusividade de cortesia é do serviço lógico, não da marca: propaga
        # para as linhas irmãs (mesmo nome/departamento em outras marcas).
        await db.execute(
            sa_update(Service)
            .where(
                Service.id != service.id,
                Service.name == service.name,
                Service.department == service.department,
            )
            .values(is_courtesy_only=service.is_courtesy_only)
        )

    await log_audit(
        db=db,
        action="update",
        resource_type="service",
        user_id=None,
        resource_id=service.id,
        old_value=old_value,
        new_value=update_data,
    )

    result = await db.execute(
        select(Service).options(selectinload(Service.brand)).where(Service.id == service_id)
    )
    return result.scalar_one()


async def deactivate_service(db: AsyncSession, service_id: int) -> Service:
    """
    Desativa um serviço.

    Args:
        db: Sessão do banco de dados
        service_id: ID do serviço

    Returns:
        Service desativado

    Raises:
        NotFoundError: Serviço não encontrado
    """
    service = await get_service(db, service_id)

    service.is_active = False
    await db.flush()

    await log_audit(
        db=db,
        action="deactivate",
        resource_type="service",
        user_id=None,
        resource_id=service.id,
        old_value={"is_active": True},
        new_value={"is_active": False},
    )

    result = await db.execute(
        select(Service).options(selectinload(Service.brand)).where(Service.id == service_id)
    )
    return result.scalar_one()
