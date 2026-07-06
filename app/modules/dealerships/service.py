"""
Dealership service - Business logic for dealership management.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.core.pagination import paginate
from app.core.permissions import apply_store_filter, require_resource_access
from app.modules.auth.models import User
from app.modules.dealerships.models import Dealership
from app.modules.dealerships.schemas import DealershipCreate, DealershipUpdate
from app.modules.stores.service import get_store


async def get_dealership_by_id(db: AsyncSession, dealership_id: int) -> Dealership | None:
    """Busca concessionária por ID."""
    result = await db.execute(select(Dealership).where(Dealership.id == dealership_id))
    return result.scalar_one_or_none()


async def list_dealerships(
    db: AsyncSession,
    user: User,
    store_id: int | None = None,
    is_active: bool | None = None,
    page: int = 1,
    limit: int = 20,
) -> tuple[list[Dealership], int]:
    """
    Lista concessionárias com base nas permissões do usuário.

    Args:
        db: Sessão do banco de dados
        user: Usuário que está listando
        store_id: Filtro por loja (opcional)
        is_active: Filtro por status ativo
        page: Página atual
        limit: Itens por página

    Returns:
        Tuple com lista de concessionárias e total de itens
    """
    query = select(Dealership)

    # Filtro por loja baseado em permissões
    query = apply_store_filter(query, user, Dealership.store_id)

    # Filtro adicional por store_id se fornecido
    if store_id is not None:
        query = query.where(Dealership.store_id == store_id)

    # Filtro por status
    if is_active is not None:
        query = query.where(Dealership.is_active == is_active)

    return await paginate(db, query, page, limit, order_by=Dealership.name)


async def get_dealership(db: AsyncSession, dealership_id: int, user: User) -> Dealership:
    """
    Obtém uma concessionária verificando permissões do usuário.

    Args:
        db: Sessão do banco de dados
        dealership_id: ID da concessionária
        user: Usuário que está consultando

    Returns:
        Dealership encontrada

    Raises:
        NotFoundError: Concessionária não encontrada ou sem permissão
    """
    dealership = await get_dealership_by_id(db, dealership_id)

    if not dealership:
        raise NotFoundError(resource="Concessionária")

    # Verificar permissão de acesso
    require_resource_access(user, dealership.store_id, "Concessionária")

    return dealership


async def create_dealership(db: AsyncSession, data: DealershipCreate, user: User) -> Dealership:
    """
    Cria uma nova concessionária.

    Args:
        db: Sessão do banco de dados
        data: Dados da nova concessionária
        user: Usuário que está criando

    Returns:
        Dealership criada

    Raises:
        NotFoundError: Loja não encontrada
    """
    # Verificar se a loja existe e o usuário tem acesso
    await get_store(db, data.store_id, user)

    dealership = Dealership(**data.model_dump())
    db.add(dealership)
    await db.flush()
    await db.refresh(dealership)

    return dealership


async def update_dealership(
    db: AsyncSession,
    dealership_id: int,
    data: DealershipUpdate,
    user: User,
) -> Dealership:
    """
    Atualiza uma concessionária existente.

    Args:
        db: Sessão do banco de dados
        dealership_id: ID da concessionária
        data: Dados para atualização
        user: Usuário que está atualizando

    Returns:
        Dealership atualizada

    Raises:
        NotFoundError: Concessionária não encontrada
    """
    dealership = await get_dealership(db, dealership_id, user)

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(dealership, field, value)

    await db.flush()
    await db.refresh(dealership)

    return dealership


async def deactivate_dealership(db: AsyncSession, dealership_id: int, user: User) -> Dealership:
    """
    Desativa uma concessionária.

    Args:
        db: Sessão do banco de dados
        dealership_id: ID da concessionária
        user: Usuário que está desativando

    Returns:
        Dealership desativada

    Raises:
        NotFoundError: Concessionária não encontrada
    """
    dealership = await get_dealership(db, dealership_id, user)

    dealership.is_active = False
    await db.flush()
    await db.refresh(dealership)

    return dealership
