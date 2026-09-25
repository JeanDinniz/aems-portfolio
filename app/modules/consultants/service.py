"""
Consultant service - Business logic for consultant management.
"""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.exceptions import ConflictError, NotFoundError
from app.core.pagination import paginate
from app.core.permissions import apply_store_filter, require_resource_access
from app.modules.auth.models import User
from app.modules.consultants.models import Consultant
from app.modules.consultants.schemas import ConsultantCreate, ConsultantUpdate
from app.modules.dealerships.models import Dealership
from app.modules.dealerships.service import get_dealership
from app.modules.stores.service import get_store_by_id


async def _get_or_create_default_dealership(db: AsyncSession, store_id: int) -> Dealership:
    """Retorna uma concessionária ativa da loja; se não houver, cria a "Geral".

    A criação é resiliente a corrida: a UNIQUE parcial `uq_dealership_geral_per_store`
    garante no máximo uma "Geral" por loja. Se outra transação criou primeiro, o
    IntegrityError é absorvido (via savepoint) e a "Geral" existente é reusada —
    evitando as concessionárias "Geral" fantasma duplicadas.
    """
    result = await db.execute(
        select(Dealership)
        .where(Dealership.store_id == store_id, Dealership.is_active.is_(True))
        .limit(1)
    )
    dealership = result.scalar_one_or_none()
    if dealership is not None:
        return dealership

    store = await get_store_by_id(db, store_id)
    name = store.name if store else f"Loja {store_id}"
    try:
        async with db.begin_nested():
            dealership = Dealership(name=name, brand="Geral", store_id=store_id, is_active=True)
            db.add(dealership)
            await db.flush()
        return dealership
    except IntegrityError:
        # Corrida OU já existe uma "Geral" (o índice parcial conta inclusive as
        # inativas). Reusa a existente; se estiver inativa, reativa — a "Geral" é
        # o encaixe genérico e deve estar ativa para não vincular consultor a
        # concessionária inativa.
        result = await db.execute(
            select(Dealership)
            .where(Dealership.store_id == store_id, Dealership.brand == "Geral")
            .limit(1)
        )
        existing = result.scalar_one()
        if not existing.is_active:
            existing.is_active = True
            await db.flush()
        return existing


async def get_consultant_by_id(db: AsyncSession, consultant_id: int) -> Consultant | None:
    """Busca consultor por ID."""
    result = await db.execute(select(Consultant).where(Consultant.id == consultant_id))
    return result.scalar_one_or_none()


async def list_consultants(
    db: AsyncSession,
    user: User,
    dealership_id: int | None = None,
    store_id: int | None = None,
    is_active: bool | None = None,
    search: str | None = None,
    page: int = 1,
    limit: int = 20,
) -> tuple[list[Consultant], int]:
    """
    Lista consultores com base nas permissões do usuário.

    Args:
        db: Sessão do banco de dados
        user: Usuário que está listando
        dealership_id: Filtro por concessionária (opcional)
        store_id: Filtro por loja (opcional)
        is_active: Filtro por status ativo
        search: Busca por nome (ILIKE) ou email (ILIKE)
        page: Página atual
        limit: Itens por página

    Returns:
        Tuple com lista de consultores e total de itens
    """
    from sqlalchemy import or_
    from sqlalchemy.orm import selectinload

    query = select(Consultant).join(Consultant.dealership).options(selectinload(Consultant.store))

    # Filtro por loja baseado em permissões (via join com Dealership)
    query = apply_store_filter(query, user, Dealership.store_id)

    # Filtro adicional por dealership_id se fornecido
    if dealership_id is not None:
        query = query.where(Consultant.dealership_id == dealership_id)

    # Filtro adicional por store_id se fornecido
    if store_id is not None:
        query = query.where(Consultant.store_id == store_id)

    # Filtro por status
    if is_active is not None:
        query = query.where(Consultant.is_active == is_active)

    # Busca por nome ou email
    if search:
        pattern = f"%{search}%"
        query = query.where(
            or_(
                Consultant.name.ilike(pattern),
                Consultant.email.ilike(pattern),
            )
        )

    return await paginate(db, query, page, limit, order_by=Consultant.name)


async def get_consultant(db: AsyncSession, consultant_id: int, user: User) -> Consultant:
    """
    Obtém um consultor verificando permissões do usuário.

    Args:
        db: Sessão do banco de dados
        consultant_id: ID do consultor
        user: Usuário que está consultando

    Returns:
        Consultant encontrado

    Raises:
        NotFoundError: Consultor não encontrado ou sem permissão
    """

    # Get consultant with dealership and store eagerly loaded
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(Consultant)
        .join(Consultant.dealership)
        .options(selectinload(Consultant.store), selectinload(Consultant.dealership))
        .where(Consultant.id == consultant_id)
    )
    consultant = result.scalar_one_or_none()

    if not consultant:
        raise NotFoundError(resource="Consultor")

    # Verificar permissão de acesso (via dealership.store_id)
    require_resource_access(user, consultant.dealership.store_id, "Consultor")

    return consultant


async def create_consultant(db: AsyncSession, data: ConsultantCreate, user: User) -> Consultant:
    """
    Cria um novo consultor.

    Args:
        db: Sessão do banco de dados
        data: Dados do novo consultor
        user: Usuário que está criando

    Returns:
        Consultant criado

    Raises:
        NotFoundError: Concessionária ou loja não encontrada
    """
    # Verificar se a loja existe
    store = await get_store_by_id(db, data.store_id)
    if not store:
        raise NotFoundError(resource="Loja")

    # Escopo de loja: usuário só cria consultor em loja à qual tem acesso
    require_resource_access(user, data.store_id, "Consultor")

    # Se dealership_id não foi fornecido, usa a primeira dealership ativa da loja
    if data.dealership_id is not None:
        from app.core.exceptions import ValidationError

        dealership = await get_dealership(db, data.dealership_id, user)
        if dealership.store_id != data.store_id:
            raise ValidationError(
                detail=f"A concessionária pertence à loja {dealership.store_id}, "
                f"não à loja {data.store_id}"
            )
    else:
        dealership = await _get_or_create_default_dealership(db, data.store_id)

    # Verificar duplicidade de nome + loja
    dup = await db.scalar(
        select(Consultant).where(
            Consultant.name == data.name,
            Consultant.store_id == data.store_id,
        )
    )
    if dup:
        raise ConflictError(detail="Já existe um consultor com este nome nesta loja.")

    from sqlalchemy.orm import selectinload

    consultant_data = data.model_dump(exclude={"dealership_id"})
    consultant = Consultant(**consultant_data, dealership_id=dealership.id)
    db.add(consultant)
    await db.flush()

    await log_audit(
        db=db,
        action="create",
        resource_type="consultant",
        user_id=user.id,
        resource_id=consultant.id,
        new_value={"name": data.name, "store_id": data.store_id, "email": data.email},
    )

    # Catálogo de consultores é cacheado no editor de O.S. — invalida pós-commit
    # (get_db lê a flag e bumpa depois que o dado persistir).
    db.info["bump_catalogs"] = True

    # Reload with relationships to avoid lazy-load in async context
    result = await db.execute(
        select(Consultant)
        .options(selectinload(Consultant.store), selectinload(Consultant.dealership))
        .where(Consultant.id == consultant.id)
    )
    return result.scalar_one()


def build_consultant_response(consultant: "Consultant") -> dict:
    """
    Constrói um dicionário com os dados do consultor prontos para serialização.

    Acessa o relacionamento ``store`` (deve estar carregado via selectinload)
    para preencher ``store_name``, mantendo essa lógica de projeção fora do router.

    Args:
        consultant: Instância de Consultant com o relacionamento store carregado

    Returns:
        Dict compatível com ConsultantResponse.model_validate()
    """
    return {
        "id": consultant.id,
        "name": consultant.name,
        "phone": consultant.phone,
        "email": consultant.email,
        "dealership_id": consultant.dealership_id,
        "store_id": consultant.store_id,
        "store_name": consultant.store.name if consultant.store else None,
        "is_active": consultant.is_active,
        "created_at": consultant.created_at,
        "updated_at": consultant.updated_at,
    }


async def update_consultant(
    db: AsyncSession,
    consultant_id: int,
    data: ConsultantUpdate,
    user: User,
) -> Consultant:
    """
    Atualiza um consultor existente.

    Args:
        db: Sessão do banco de dados
        consultant_id: ID do consultor
        data: Dados para atualização
        user: Usuário que está atualizando

    Returns:
        Consultant atualizado

    Raises:
        NotFoundError: Consultor não encontrado
    """
    from sqlalchemy.orm import selectinload

    consultant = await get_consultant(db, consultant_id, user)

    update_data = data.model_dump(exclude_unset=True)

    # Ao mover de loja, exigir acesso também à loja de destino (não escapar do
    # escopo) — simetria com update_employee (C3, auditoria).
    if "store_id" in update_data:
        require_resource_access(user, update_data["store_id"], "Loja")

    # Verificar duplicidade de nome + loja (ignorando o próprio registro)
    new_name = update_data.get("name", consultant.name)
    new_store_id = update_data.get("store_id", consultant.store_id)
    if "name" in update_data or "store_id" in update_data:
        dup = await db.scalar(
            select(Consultant).where(
                Consultant.name == new_name,
                Consultant.store_id == new_store_id,
                Consultant.id != consultant_id,
            )
        )
        if dup:
            raise ConflictError(detail="Já existe um consultor com este nome nesta loja.")

    # Se store_id está sendo alterado, atualiza dealership_id para a loja nova
    if "store_id" in update_data:
        new_dealership = await _get_or_create_default_dealership(db, update_data["store_id"])
        consultant.dealership_id = new_dealership.id

    old_values = {k: getattr(consultant, k, None) for k in update_data}
    for field, value in update_data.items():
        setattr(consultant, field, value)

    await db.flush()

    await log_audit(
        db=db,
        action="update",
        resource_type="consultant",
        user_id=user.id,
        resource_id=consultant_id,
        old_value=old_values,
        new_value=update_data,
    )

    db.info["bump_catalogs"] = True

    # Recarrega com relacionamentos para evitar lazy-load em contexto async
    result = await db.execute(
        select(Consultant)
        .options(selectinload(Consultant.store), selectinload(Consultant.dealership))
        .where(Consultant.id == consultant.id)
    )
    return result.scalar_one()


async def delete_consultant(db: AsyncSession, consultant_id: int, user: User) -> dict:
    """
    Exclui permanentemente um consultor preservando o histórico nas O.S.

    Antes de excluir, salva o nome do consultor em service_orders.consultant_name
    para todas as O.S. vinculadas a ele. Em seguida deleta o registro da tabela.

    Args:
        db: Sessão do banco de dados
        consultant_id: ID do consultor
        user: Usuário que está excluindo

    Returns:
        Dict com id e name do consultor excluído

    Raises:
        NotFoundError: Consultor não encontrado
    """
    from sqlalchemy import update

    from app.modules.service_orders.models import ServiceOrder

    consultant = await get_consultant(db, consultant_id, user)

    # Preserva o nome e desvincula o consultor nas O.S. antes de excluir
    await db.execute(
        update(ServiceOrder)
        .where(ServiceOrder.consultant_id == consultant_id)
        .values(consultant_name=consultant.name, consultant_id=None)
    )
    await db.flush()

    deleted_info = {"id": consultant.id, "name": consultant.name}

    await log_audit(
        db=db,
        action="delete",
        resource_type="consultant",
        user_id=user.id,
        resource_id=consultant_id,
        old_value={"name": consultant.name, "store_id": consultant.store_id},
    )

    await db.delete(consultant)
    await db.flush()

    db.info["bump_catalogs"] = True

    return deleted_info
