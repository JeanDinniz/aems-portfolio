"""
Store service - Business logic for store management.
"""

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.exceptions import ConflictError, NotFoundError
from app.core.pagination import paginate
from app.core.permissions import apply_store_filter, require_resource_access
from app.modules.auth.models import User
from app.modules.dealerships.models import Dealership
from app.modules.stores.models import Store, StoreInventoryLink
from app.modules.stores.schemas import StoreCreate, StoreUpdate


async def get_store_by_id(db: AsyncSession, store_id: int) -> Store | None:
    """Busca loja por ID."""
    result = await db.execute(select(Store).where(Store.id == store_id))
    return result.scalar_one_or_none()


async def get_store_by_code(db: AsyncSession, code: str) -> Store | None:
    """Busca loja por código."""
    result = await db.execute(select(Store).where(Store.code == code))
    return result.scalar_one_or_none()


async def list_stores(
    db: AsyncSession,
    user: User,
    page: int = 1,
    limit: int = 20,
    is_active: bool | None = None,
) -> tuple[list[Store], int]:
    """
    Lista lojas com base nas permissões do usuário.

    Args:
        db: Sessão do banco de dados
        user: Usuário que está listando
        page: Página atual
        limit: Itens por página
        is_active: Filtro por status ativo

    Returns:
        Tuple com lista de lojas e total de itens
    """
    query = select(Store)

    # Filtro por role (nota: usa Store.id, não store_id)
    query = apply_store_filter(query, user, Store.id)

    # Filtro por status
    if is_active is not None:
        query = query.where(Store.is_active == is_active)

    return await paginate(db, query, page, limit, order_by=Store.code)


async def get_store(db: AsyncSession, store_id: int, user: User) -> Store:
    """
    Obtém uma loja verificando permissões do usuário.

    Args:
        db: Sessão do banco de dados
        store_id: ID da loja
        user: Usuário que está consultando

    Returns:
        Store encontrada

    Raises:
        NotFoundError: Loja não encontrada ou sem permissão
    """
    store = await get_store_by_id(db, store_id)

    if not store:
        raise NotFoundError(resource="Loja")

    # Verificar permissão de acesso
    require_resource_access(user, store.id, "Loja")

    return store


async def create_store(
    db: AsyncSession, data: StoreCreate, created_by_id: int | None = None
) -> Store:
    """
    Cria uma nova loja.

    Args:
        db: Sessão do banco de dados
        data: Dados da nova loja

    Returns:
        Store criada

    Raises:
        ConflictError: Código de loja já existe
    """
    # Verificar se código já existe
    existing = await get_store_by_code(db, data.code)
    if existing:
        raise ConflictError(detail=f"Loja com código {data.code} já existe")

    # Verificar se nome + marca já existem
    dup = await db.scalar(
        select(Store).where(Store.name == data.name, Store.brand_id == data.brand_id)
    )
    if dup:
        raise ConflictError(detail="Já existe uma loja com este nome para esta marca.")

    store = Store(**data.model_dump())
    db.add(store)
    await db.flush()

    # Buscar o code da marca para preencher dealership.brand
    from sqlalchemy import select as _select

    from app.modules.brands.models import Brand

    brand_result = await db.execute(_select(Brand.code).where(Brand.id == store.brand_id))
    brand_code = brand_result.scalar_one_or_none()

    # Atualizar dealership_brand na loja com o code da marca
    store.dealership_brand = brand_code

    # Cria registro correspondente na tabela dealerships para a loja
    dealership = Dealership(
        name=store.name,
        store_id=store.id,
        brand=brand_code,
        address=store.address,
    )
    db.add(dealership)
    await db.flush()

    await log_audit(
        db=db,
        action="create",
        resource_type="store",
        user_id=created_by_id,
        resource_id=store.id,
        new_value={"name": store.name, "code": store.code},
    )

    await db.commit()
    await db.refresh(store)

    return store


async def update_store(
    db: AsyncSession,
    store_id: int,
    data: StoreUpdate,
    updated_by_id: int | None = None,
) -> Store:
    """
    Atualiza uma loja existente.

    Args:
        db: Sessão do banco de dados
        store_id: ID da loja
        data: Dados para atualização

    Returns:
        Store atualizada

    Raises:
        NotFoundError: Loja não encontrada
    """
    store = await get_store_by_id(db, store_id)

    if not store:
        raise NotFoundError(resource="Loja")

    # Separar linked_inventory_store_ids do restante dos campos (não é coluna do model)
    linked_inventory_store_ids = data.linked_inventory_store_ids
    update_data = data.model_dump(exclude_unset=True, exclude={"linked_inventory_store_ids"})

    # Verificar duplicidade de nome + marca (ignorando o próprio registro)
    new_name = update_data.get("name", store.name)
    new_brand_id = update_data.get("brand_id", store.brand_id)
    if "name" in update_data or "brand_id" in update_data:
        dup = await db.scalar(
            select(Store).where(
                Store.name == new_name,
                Store.brand_id == new_brand_id,
                Store.id != store_id,
            )
        )
        if dup:
            raise ConflictError(detail="Já existe uma loja com este nome para esta marca.")

    old_values = {k: getattr(store, k, None) for k in update_data}
    for field, value in update_data.items():
        setattr(store, field, value)

    # Se brand_id mudou, atualizar dealership_brand (campo legado) também
    if "brand_id" in update_data:
        from sqlalchemy import select as _select

        from app.modules.brands.models import Brand

        brand_result = await db.execute(_select(Brand.code).where(Brand.id == store.brand_id))
        brand_code = brand_result.scalar_one_or_none()
        store.dealership_brand = brand_code

    await db.flush()

    # Gerenciar vínculos de estoque compartilhado
    if linked_inventory_store_ids is not None:
        # Remover todos os vínculos bidirecionais existentes para esta loja
        await db.execute(
            delete(StoreInventoryLink).where(
                or_(
                    StoreInventoryLink.store_id == store.id,
                    StoreInventoryLink.linked_store_id == store.id,
                )
            )
        )
        await db.flush()

        if store.has_shared_inventory and linked_inventory_store_ids:
            for partner_id in linked_inventory_store_ids:
                db.add(StoreInventoryLink(store_id=store.id, linked_store_id=partner_id))
                db.add(StoreInventoryLink(store_id=partner_id, linked_store_id=store.id))
                # Marcar parceiro como has_shared_inventory
                partner = await db.get(Store, partner_id)
                if partner:
                    partner.has_shared_inventory = True
            await db.flush()
        elif not store.has_shared_inventory:
            # Loja desativou o compartilhamento; parceiros que ficaram sem outros
            # vínculos devem ter has_shared_inventory resetado para False.
            # Como os vínculos já foram deletados, qualquer store que não tenha
            # mais entradas em store_inventory_links deve ser atualizado.
            # Buscamos os IDs que o usuário informou como ex-parceiros.
            if linked_inventory_store_ids:
                for partner_id in linked_inventory_store_ids:
                    remaining = await db.scalar(
                        select(StoreInventoryLink).where(
                            or_(
                                StoreInventoryLink.store_id == partner_id,
                                StoreInventoryLink.linked_store_id == partner_id,
                            )
                        )
                    )
                    if remaining is None:
                        ex_partner = await db.get(Store, partner_id)
                        if ex_partner:
                            ex_partner.has_shared_inventory = False
            await db.flush()

    await log_audit(
        db=db,
        action="update",
        resource_type="store",
        user_id=updated_by_id,
        resource_id=store_id,
        old_value=old_values,
        new_value=update_data,
    )

    # Sincroniza o registro de dealership
    result = await db.execute(select(Dealership).where(Dealership.store_id == store.id))
    dealership = result.scalar_one_or_none()

    if dealership:
        # Atualiza campos que podem ter mudado
        if "name" in update_data:
            dealership.name = store.name
        if "brand_id" in update_data and store.dealership_brand:
            dealership.brand = store.dealership_brand
        if "address" in update_data:
            dealership.address = store.address
        await db.flush()
    elif store.brand_id:
        # Cria o registro de dealership caso não exista.
        # Garante brand_code mesmo que dealership_brand não tenha sido sincronizado.
        brand_code = store.dealership_brand
        if not brand_code:
            from sqlalchemy import select as _select

            from app.modules.brands.models import Brand as _Brand

            _result = await db.execute(_select(_Brand.code).where(_Brand.id == store.brand_id))
            brand_code = _result.scalar_one_or_none()
        new_dealership = Dealership(
            name=store.name,
            store_id=store.id,
            brand=brand_code,
            address=store.address,
        )
        db.add(new_dealership)
        await db.flush()

    await db.refresh(store)

    return store


async def delete_store(db: AsyncSession, store_id: int) -> dict:
    """
    Exclui permanentemente uma loja.

    Raises:
        NotFoundError: Loja não encontrada
        ConflictError: Loja possui vínculos que impedem exclusão (O.S., funcionários, etc.)
    """
    from sqlalchemy.exc import IntegrityError

    store = await get_store_by_id(db, store_id)

    if not store:
        raise NotFoundError(resource="Loja")

    deleted_info = {"id": store.id, "name": store.name, "code": store.code}

    await log_audit(
        db=db,
        action="delete",
        resource_type="store",
        user_id=None,
        resource_id=store.id,
        old_value={"name": store.name, "code": store.code},
    )

    try:
        await db.delete(store)
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ConflictError(
            detail="Não é possível excluir a loja pois ela possui vínculos ativos "
            "(ordens de serviço, funcionários ou usuários). "
            "Remova os vínculos antes de excluir."
        ) from None

    return deleted_info
