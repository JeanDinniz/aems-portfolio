"""
Consultant service - Business logic for consultant management.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.exceptions import ConflictError, NotFoundError
from app.core.pagination import paginate
from app.core.permissions import apply_store_filter, require_resource_access
from app.modules.auth.models import User
from app.modules.consultants.models import Consultant
from app.modules.consultants.schemas import ConsultantCreate, ConsultantUpdate
from app.modules.dealerships.service import get_dealership


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

    from app.modules.dealerships.models import Dealership

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
    from app.modules.dealerships.models import Dealership
    from app.modules.stores.service import get_store_by_id

    # Verificar se a loja existe
    store = await get_store_by_id(db, data.store_id)
    if not store:
        raise NotFoundError(resource="Loja")

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
        result = await db.execute(
            select(Dealership)
            .where(Dealership.store_id == data.store_id, Dealership.is_active.is_(True))
            .limit(1)
        )
        dealership = result.scalar_one_or_none()
        if not dealership:
            # Cria concessionária padrão para a loja se não existir nenhuma
            dealership = Dealership(
                name=store.name,
                brand="Geral",
                store_id=data.store_id,
                is_active=True,
            )
            db.add(dealership)
            await db.flush()

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

    from app.modules.dealerships.models import Dealership

    consultant = await get_consultant(db, consultant_id, user)

    update_data = data.model_dump(exclude_unset=True)

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
        from app.modules.stores.service import get_store_by_id

        new_store_id = update_data["store_id"]
        result = await db.execute(
            select(Dealership)
            .where(Dealership.store_id == new_store_id, Dealership.is_active.is_(True))
            .limit(1)
        )
        new_dealership = result.scalar_one_or_none()
        if not new_dealership:
            new_store = await get_store_by_id(db, new_store_id)
            new_dealership = Dealership(
                name=new_store.name if new_store else f"Loja {new_store_id}",
                brand="Geral",
                store_id=new_store_id,
                is_active=True,
            )
            db.add(new_dealership)
            await db.flush()
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

    return deleted_info


async def deactivate_consultant(db: AsyncSession, consultant_id: int, user: User) -> Consultant:
    """
    Desativa um consultor.

    Args:
        db: Sessão do banco de dados
        consultant_id: ID do consultor
        user: Usuário que está desativando

    Returns:
        Consultant desativado

    Raises:
        NotFoundError: Consultor não encontrado
    """
    from sqlalchemy.orm import selectinload

    consultant = await get_consultant(db, consultant_id, user)

    consultant.is_active = False

    await log_audit(
        db=db,
        action="deactivate",
        resource_type="consultant",
        user_id=user.id,
        resource_id=consultant.id,
        old_value={"is_active": True},
        new_value={"is_active": False},
    )

    await db.flush()

    result = await db.execute(
        select(Consultant)
        .options(selectinload(Consultant.store), selectinload(Consultant.dealership))
        .where(Consultant.id == consultant.id)
    )
    return result.scalar_one()
