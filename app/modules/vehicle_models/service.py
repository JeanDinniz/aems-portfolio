"""
VehicleModel service - Business logic for vehicle model management.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.exceptions import AuthorizationError, ConflictError, NotFoundError
from app.core.pagination import paginate
from app.modules.auth.models import User
from app.modules.stores.models import Store
from app.modules.vehicle_models.models import VehicleModel
from app.modules.vehicle_models.schemas import VehicleModelCreate, VehicleModelUpdate


async def list_by_brand(
    db: AsyncSession,
    brand_id: int,
    active_only: bool = True,
    page: int = 1,
    limit: int = 100,
) -> tuple[list[VehicleModel], int]:
    """
    Lista modelos de veículos de uma marca ordenados por nome.

    Args:
        db: Sessão do banco de dados
        brand_id: ID da marca
        active_only: Se True, retorna apenas modelos ativos
        page: Página atual
        limit: Itens por página

    Returns:
        Tuple com lista de VehicleModel e total de itens
    """
    query = select(VehicleModel).where(VehicleModel.brand_id == brand_id)

    if active_only:
        query = query.where(VehicleModel.is_active.is_(True))

    return await paginate(db, query, page, limit, order_by=VehicleModel.name)


async def get_by_id(db: AsyncSession, model_id: int, brand_id: int) -> VehicleModel:
    """
    Busca um modelo de veículo pelo ID, validando que pertence à marca informada.

    Args:
        db: Sessão do banco de dados
        model_id: ID do modelo
        brand_id: ID da marca esperada

    Returns:
        VehicleModel encontrado

    Raises:
        NotFoundError: Modelo não encontrado ou não pertence à marca
    """
    result = await db.execute(
        select(VehicleModel).where(
            VehicleModel.id == model_id,
            VehicleModel.brand_id == brand_id,
        )
    )
    vehicle_model = result.scalar_one_or_none()
    if not vehicle_model:
        raise NotFoundError(resource="Modelo de veículo")
    return vehicle_model


async def create(
    db: AsyncSession,
    brand_id: int,
    data: VehicleModelCreate,
) -> VehicleModel:
    """
    Cria um novo modelo de veículo para a marca.

    Args:
        db: Sessão do banco de dados
        brand_id: ID da marca
        data: Dados do novo modelo

    Returns:
        VehicleModel criado

    Raises:
        ConflictError: Já existe um modelo com o mesmo nome nesta marca
    """
    existing = await db.execute(
        select(VehicleModel).where(
            VehicleModel.brand_id == brand_id,
            VehicleModel.name == data.name,
            VehicleModel.is_active.is_(True),
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise ConflictError(detail=f"Já existe um modelo com o nome '{data.name}' para esta marca")

    vehicle_model = VehicleModel(
        brand_id=brand_id,
        name=data.name,
        is_active=True,
    )
    db.add(vehicle_model)
    await db.flush()

    await log_audit(
        db=db,
        action="create",
        resource_type="vehicle_model",
        user_id=None,
        resource_id=vehicle_model.id,
        new_value={"name": vehicle_model.name, "brand_id": vehicle_model.brand_id},
    )

    await db.refresh(vehicle_model)
    return vehicle_model


async def update(
    db: AsyncSession,
    model_id: int,
    brand_id: int,
    data: VehicleModelUpdate,
) -> VehicleModel:
    """
    Atualiza um modelo de veículo existente da marca.

    Args:
        db: Sessão do banco de dados
        model_id: ID do modelo a atualizar
        brand_id: ID da marca (para garantir que o modelo pertence à marca)
        data: Campos a atualizar

    Returns:
        VehicleModel atualizado

    Raises:
        NotFoundError: Modelo não encontrado ou não pertence à marca
        ConflictError: Novo nome já existe em outro modelo da mesma marca
    """
    vehicle_model = await get_by_id(db, model_id, brand_id)

    update_data = data.model_dump(exclude_unset=True)

    if "name" in update_data and update_data["name"] != vehicle_model.name:
        existing = await db.execute(
            select(VehicleModel).where(
                VehicleModel.brand_id == brand_id,
                VehicleModel.name == update_data["name"],
                VehicleModel.id != model_id,
                VehicleModel.is_active.is_(True),
            )
        )
        if existing.scalar_one_or_none() is not None:
            raise ConflictError(
                detail=f"Já existe um modelo com o nome '{update_data['name']}' para esta marca"
            )

    old_value = {field: getattr(vehicle_model, field, None) for field in update_data}

    for field, value in update_data.items():
        setattr(vehicle_model, field, value)

    await db.flush()

    await log_audit(
        db=db,
        action="update",
        resource_type="vehicle_model",
        user_id=None,
        resource_id=vehicle_model.id,
        old_value=old_value,
        new_value=update_data,
    )

    await db.refresh(vehicle_model)
    return vehicle_model


async def delete(
    db: AsyncSession,
    model_id: int,
    brand_id: int,
) -> VehicleModel:
    """
    Desativa um modelo de veículo (soft delete).

    Args:
        db: Sessão do banco de dados
        model_id: ID do modelo a desativar
        brand_id: ID da marca (para garantir que o modelo pertence à marca)

    Returns:
        VehicleModel desativado

    Raises:
        NotFoundError: Modelo não encontrado ou não pertence à marca
    """
    vehicle_model = await get_by_id(db, model_id, brand_id)
    vehicle_model.is_active = False
    await db.flush()

    await log_audit(
        db=db,
        action="deactivate",
        resource_type="vehicle_model",
        user_id=None,
        resource_id=vehicle_model.id,
        old_value={"is_active": True},
        new_value={"is_active": False},
    )

    await db.refresh(vehicle_model)
    return vehicle_model


async def hard_delete(
    db: AsyncSession,
    model_id: int,
    brand_id: int,
) -> dict:
    """
    Exclui permanentemente um modelo de veículo.
    Raises ConflictError se houver O.S. vinculadas.
    """
    from sqlalchemy.exc import IntegrityError

    vehicle_model = await get_by_id(db, model_id, brand_id)
    deleted_info = {"id": vehicle_model.id, "name": vehicle_model.name}

    await log_audit(
        db=db,
        action="delete",
        resource_type="vehicle_model",
        user_id=None,
        resource_id=vehicle_model.id,
        old_value={"name": vehicle_model.name},
    )

    try:
        await db.delete(vehicle_model)
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ConflictError(
            detail="Não é possível excluir o modelo pois ele está vinculado a ordens de serviço."
        ) from None

    return deleted_info


async def get_brand_id_for_operator(db: AsyncSession, user: User) -> int:
    """
    Retorna o brand_id da loja do operador.

    Busca o store do usuário e retorna o brand_id correspondente.

    Args:
        db: Sessão do banco de dados
        user: Usuário operador

    Returns:
        brand_id da loja do operador

    Raises:
        AuthorizationError: Operador não está vinculado a uma loja ou
                            a loja não tem marca associada
    """
    if user.store_id is None:
        raise AuthorizationError(detail="Você não está vinculado a uma loja")

    result = await db.execute(select(Store.brand_id).where(Store.id == user.store_id))
    brand_id = result.scalar_one_or_none()

    if brand_id is None:
        raise AuthorizationError(detail="A loja não possui uma marca associada")

    return brand_id


async def resolve_brand_id(
    db: AsyncSession,
    user: User,
    requested_brand_id: int | None,
) -> int:
    """
    Resolve o brand_id efetivo para operações em modelos de veículos.

    - User com loja vinculada: usa a marca da própria loja se brand_id não for informado
    - Owner: usa requested_brand_id (obrigatório)

    Args:
        db: Sessão do banco de dados
        user: Usuário autenticado
        requested_brand_id: brand_id passado como query param

    Returns:
        brand_id efetivo

    Raises:
        AuthorizationError: Usuário sem loja ou loja sem marca vinculada
        ValidationError: Owner não informou brand_id
    """
    from app.core.exceptions import ValidationError

    if requested_brand_id is None:
        if user.store_id is not None:
            return await get_brand_id_for_operator(db, user)
        raise ValidationError(detail="brand_id é obrigatório")

    return requested_brand_id
