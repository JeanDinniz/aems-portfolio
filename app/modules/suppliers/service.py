"""
Supplier service - Business logic for supplier management.
"""

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.exceptions import ConflictError, NotFoundError
from app.core.pagination import paginate
from app.modules.auth.models import User
from app.modules.suppliers.models import Supplier
from app.modules.suppliers.schemas import SupplierCreate, SupplierUpdate


async def list_suppliers(
    db: AsyncSession,
    page: int = 1,
    limit: int = 20,
    search: str | None = None,
    is_active: bool | None = None,
) -> tuple[list[Supplier], int]:
    """
    Lista fornecedores com filtros opcionais.

    Args:
        db: Sessão do banco de dados
        page: Página atual
        limit: Itens por página
        search: Busca por nome ou CNPJ
        is_active: Filtro por status ativo

    Returns:
        Tuple com lista de fornecedores e total de itens
    """
    query = select(Supplier)

    if search is not None:
        search_term = f"%{search}%"
        query = query.where(
            or_(
                Supplier.company_name.ilike(search_term),
                Supplier.cnpj.ilike(search_term),
            )
        )

    if is_active is not None:
        query = query.where(Supplier.is_active == is_active)

    return await paginate(db, query, page, limit, order_by=Supplier.company_name.asc())


async def get_supplier(db: AsyncSession, supplier_id: int) -> Supplier:
    """
    Obtém um fornecedor por ID.

    Args:
        db: Sessão do banco de dados
        supplier_id: ID do fornecedor

    Returns:
        Supplier encontrado

    Raises:
        NotFoundError: Fornecedor não encontrado
    """
    result = await db.execute(select(Supplier).where(Supplier.id == supplier_id))
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise NotFoundError(resource="Fornecedor")
    return supplier


async def create_supplier(db: AsyncSession, data: SupplierCreate, user: User) -> Supplier:
    """
    Cria um novo fornecedor.

    Args:
        db: Sessão do banco de dados
        data: Dados do novo fornecedor
        user: Usuário que está criando

    Returns:
        Supplier criado

    Raises:
        ConflictError: CNPJ já cadastrado
    """
    # Verificar CNPJ duplicado se fornecido
    if data.cnpj:
        existing = await db.execute(select(Supplier).where(Supplier.cnpj == data.cnpj))
        if existing.scalar_one_or_none():
            raise ConflictError(detail=f"Já existe um fornecedor com o CNPJ '{data.cnpj}'")

    supplier = Supplier(**data.model_dump())
    db.add(supplier)
    await db.flush()

    await log_audit(
        db=db,
        action="create",
        resource_type="supplier",
        user_id=user.id,
        resource_id=supplier.id,
        new_value={"company_name": data.company_name, "cnpj": data.cnpj},
    )

    # C2 (auditoria): commit é do get_db (atomicidade da request).
    await db.refresh(supplier)

    return supplier


async def update_supplier(
    db: AsyncSession,
    supplier_id: int,
    data: SupplierUpdate,
    user: User,
) -> Supplier:
    """
    Atualiza um fornecedor existente.

    Args:
        db: Sessão do banco de dados
        supplier_id: ID do fornecedor
        data: Dados para atualização
        user: Usuário que está atualizando

    Returns:
        Supplier atualizado

    Raises:
        NotFoundError: Fornecedor não encontrado
        ConflictError: CNPJ já pertence a outro fornecedor
    """
    supplier = await get_supplier(db, supplier_id)

    update_data = data.model_dump(exclude_unset=True)

    # Verificar unicidade do CNPJ se está sendo alterado
    new_cnpj = update_data.get("cnpj")
    if new_cnpj and new_cnpj != supplier.cnpj:
        existing = await db.execute(
            select(Supplier).where(
                Supplier.cnpj == new_cnpj,
                Supplier.id != supplier_id,
            )
        )
        if existing.scalar_one_or_none():
            raise ConflictError(detail=f"Já existe um fornecedor com o CNPJ '{new_cnpj}'")

    old_value = {field: getattr(supplier, field, None) for field in update_data}

    for field, value in update_data.items():
        setattr(supplier, field, value)

    await db.flush()

    await log_audit(
        db=db,
        action="update",
        resource_type="supplier",
        user_id=user.id,
        resource_id=supplier.id,
        old_value=old_value,
        new_value=update_data,
    )

    # C2 (auditoria): commit é do get_db (atomicidade da request).
    await db.refresh(supplier)

    return supplier


async def deactivate_supplier(db: AsyncSession, supplier_id: int, user: User) -> Supplier:
    """
    Desativa um fornecedor (soft delete).

    Args:
        db: Sessão do banco de dados
        supplier_id: ID do fornecedor
        user: Usuário que está desativando

    Returns:
        Supplier desativado

    Raises:
        NotFoundError: Fornecedor não encontrado
    """
    supplier = await get_supplier(db, supplier_id)

    supplier.is_active = False
    await db.flush()

    await log_audit(
        db=db,
        action="deactivate",
        resource_type="supplier",
        user_id=user.id,
        resource_id=supplier.id,
        old_value={"is_active": True},
        new_value={"is_active": False},
    )

    # C2 (auditoria): commit é do get_db (atomicidade da request).
    await db.refresh(supplier)

    return supplier
