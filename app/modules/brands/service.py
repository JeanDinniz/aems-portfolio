"""
Brand service - Business logic for brand management.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.exceptions import ConflictError, NotFoundError
from app.core.pagination import paginate
from app.modules.brands.models import Brand
from app.modules.brands.schemas import BrandCreate, BrandUpdate


async def get_brand_by_id(db: AsyncSession, brand_id: int) -> Brand | None:
    """Busca marca por ID."""
    result = await db.execute(select(Brand).where(Brand.id == brand_id))
    return result.scalar_one_or_none()


async def get_brand_by_code(db: AsyncSession, code: str) -> Brand | None:
    """Busca marca por código."""
    result = await db.execute(select(Brand).where(Brand.code == code))
    return result.scalar_one_or_none()


async def list_brands(
    db: AsyncSession,
    is_active: bool | None = None,
    page: int = 1,
    limit: int = 50,
) -> tuple[list[Brand], int]:
    """
    Lista marcas do sistema.

    Args:
        db: Sessão do banco de dados
        is_active: Filtro por status ativo (None retorna todas)
        page: Página atual
        limit: Itens por página

    Returns:
        Tuple com lista de marcas e total de itens
    """
    query = select(Brand)

    if is_active is not None:
        query = query.where(Brand.is_active == is_active)

    return await paginate(db, query, page, limit, order_by=Brand.name)


async def get_brand(db: AsyncSession, brand_id: int) -> Brand:
    """
    Obtém uma marca por ID.

    Args:
        db: Sessão do banco de dados
        brand_id: ID da marca

    Returns:
        Brand encontrada

    Raises:
        NotFoundError: Marca não encontrada
    """
    brand = await get_brand_by_id(db, brand_id)

    if not brand:
        raise NotFoundError(resource="Marca")

    return brand


async def create_brand(db: AsyncSession, data: BrandCreate) -> Brand:
    """
    Cria uma nova marca.

    Args:
        db: Sessão do banco de dados
        data: Dados da nova marca

    Returns:
        Brand criada

    Raises:
        ConflictError: Código ou nome de marca já existem
    """
    existing_code = await get_brand_by_code(db, data.code)
    if existing_code:
        raise ConflictError(detail=f"Marca com código '{data.code}' já existe")

    existing_name = await db.execute(select(Brand).where(Brand.name == data.name))
    if existing_name.scalar_one_or_none():
        raise ConflictError(detail=f"Marca com nome '{data.name}' já existe")

    brand = Brand(**data.model_dump())
    db.add(brand)
    await db.flush()

    await log_audit(
        db=db,
        action="create",
        resource_type="brand",
        user_id=None,
        resource_id=brand.id,
        new_value={"name": brand.name},
    )

    await db.refresh(brand)

    return brand


async def update_brand(
    db: AsyncSession,
    brand_id: int,
    data: BrandUpdate,
) -> Brand:
    """
    Atualiza uma marca existente.

    Args:
        db: Sessão do banco de dados
        brand_id: ID da marca
        data: Dados para atualização

    Returns:
        Brand atualizada

    Raises:
        NotFoundError: Marca não encontrada
        ConflictError: Nome já existe em outra marca
    """
    brand = await get_brand(db, brand_id)

    update_data = data.model_dump(exclude_unset=True)

    if "name" in update_data and update_data["name"] != brand.name:
        existing = await db.execute(
            select(Brand).where(
                Brand.name == update_data["name"],
                Brand.id != brand_id,
            )
        )
        if existing.scalar_one_or_none():
            raise ConflictError(detail=f"Marca com nome '{update_data['name']}' já existe")

    old_value = {field: getattr(brand, field, None) for field in update_data}

    for field, value in update_data.items():
        setattr(brand, field, value)

    await db.flush()

    await log_audit(
        db=db,
        action="update",
        resource_type="brand",
        user_id=None,
        resource_id=brand.id,
        old_value=old_value,
        new_value=update_data,
    )

    await db.refresh(brand)

    return brand


async def deactivate_brand(db: AsyncSession, brand_id: int) -> Brand:
    """
    Desativa uma marca (soft delete).

    Args:
        db: Sessão do banco de dados
        brand_id: ID da marca

    Returns:
        Brand desativada

    Raises:
        NotFoundError: Marca não encontrada
    """
    brand = await get_brand(db, brand_id)

    brand.is_active = False
    await db.flush()

    await log_audit(
        db=db,
        action="deactivate",
        resource_type="brand",
        user_id=None,
        resource_id=brand.id,
        old_value={"is_active": True},
        new_value={"is_active": False},
    )

    await db.refresh(brand)

    return brand


async def hard_delete_brand(db: AsyncSession, brand_id: int) -> dict:
    """
    Exclui permanentemente uma marca.
    Raises ConflictError se houver vínculos ativos (lojas, modelos, serviços).
    """
    from sqlalchemy.exc import IntegrityError

    brand = await get_brand(db, brand_id)
    deleted_info = {"id": brand.id, "name": brand.name}

    await log_audit(
        db=db,
        action="delete",
        resource_type="brand",
        user_id=None,
        resource_id=brand.id,
        old_value={"name": brand.name},
    )

    try:
        await db.delete(brand)
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ConflictError(
            detail="Não é possível excluir a marca pois ela possui vínculos ativos "
            "(lojas, modelos ou serviços). Remova os vínculos antes de excluir."
        ) from None

    return deleted_info
