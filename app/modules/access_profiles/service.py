"""
Access Profile service - Business logic for access profile management.
"""

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit
from app.core.exceptions import ConflictError, NotFoundError
from app.core.pagination import paginate
from app.core.permissions import profiles_all_have_flag
from app.modules.access_profiles.models import (
    AccessProfile,
    AccessProfileModulePermission,
    access_profile_stores,
    access_profile_users,
)
from app.modules.access_profiles.schemas import (
    AccessProfileCreate,
    AccessProfileUpdate,
    UserEffectivePermission,
    UserEffectivePermissions,
)

# ---------------------------------------------------------------------------
# Helpers internos
# ---------------------------------------------------------------------------


async def _get_profile_by_id(db: AsyncSession, profile_id: int) -> AccessProfile | None:
    """Busca perfil por ID com todos os relacionamentos carregados."""
    result = await db.execute(
        select(AccessProfile)
        .where(AccessProfile.id == profile_id)
        .options(
            selectinload(AccessProfile.permissions),
            selectinload(AccessProfile.stores),
            selectinload(AccessProfile.users),
        )
    )
    return result.scalar_one_or_none()


async def _apply_permissions(
    db: AsyncSession,
    profile: AccessProfile,
    permissions_data: list,
) -> None:
    """
    Substitui todas as permissões de módulo do perfil.

    Usa Core SQL para evitar MissingGreenletError em perfis recém-criados
    cujos relacionamentos ainda não foram carregados via selectinload.
    """
    await db.execute(
        delete(AccessProfileModulePermission).where(
            AccessProfileModulePermission.profile_id == profile.id
        )
    )
    await db.flush()

    for perm in permissions_data:
        obj = AccessProfileModulePermission(
            profile_id=profile.id,
            module_group=perm.module_group,
            sub_module=perm.sub_module,
            can_view=perm.can_view,
            can_edit=perm.can_edit,
            can_delete=perm.can_delete,
        )
        db.add(obj)


async def _apply_stores(
    db: AsyncSession,
    profile: AccessProfile,
    store_ids: list[int],
) -> None:
    """
    Substitui as lojas vinculadas ao perfil.

    Usa Core SQL para evitar MissingGreenletError em perfis recém-criados
    cujo relationship `stores` ainda não foi carregado via selectinload.
    """
    await db.execute(
        delete(access_profile_stores).where(access_profile_stores.c.profile_id == profile.id)
    )
    await db.flush()

    for store_id in store_ids:
        await db.execute(
            access_profile_stores.insert().values(profile_id=profile.id, store_id=store_id)
        )


async def _apply_users(
    db: AsyncSession,
    profile: AccessProfile,
    user_ids: list[int],
) -> None:
    """
    Substitui os usuários vinculados ao perfil.

    Remove associações existentes e insere as novas.
    """
    await db.execute(
        delete(access_profile_users).where(access_profile_users.c.profile_id == profile.id)
    )
    await db.flush()

    for user_id in user_ids:
        await db.execute(
            access_profile_users.insert().values(profile_id=profile.id, user_id=user_id)
        )


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


async def get_profile(db: AsyncSession, profile_id: int) -> AccessProfile:
    """
    Obtém um perfil de acesso por ID.

    Args:
        db: Sessão do banco de dados
        profile_id: ID do perfil

    Returns:
        AccessProfile encontrado

    Raises:
        NotFoundError: Perfil não encontrado
    """
    profile = await _get_profile_by_id(db, profile_id)

    if not profile:
        raise NotFoundError(resource="Perfil de Acesso")

    return profile


async def list_profiles(
    db: AsyncSession,
    page: int = 1,
    limit: int = 20,
    is_active: bool | None = None,
    search: str | None = None,
    store_id: int | None = None,
) -> tuple[list[AccessProfile], int]:
    query = select(AccessProfile).options(
        selectinload(AccessProfile.permissions),
        selectinload(AccessProfile.stores),
        selectinload(AccessProfile.users),
    )

    if is_active is not None:
        query = query.where(AccessProfile.is_active == is_active)

    if search:
        query = query.where(AccessProfile.name.ilike(f"%{search}%"))

    if store_id is not None:
        query = query.where(
            AccessProfile.id.in_(
                select(access_profile_stores.c.profile_id).where(
                    access_profile_stores.c.store_id == store_id
                )
            )
        )

    return await paginate(db, query, page, limit, order_by=AccessProfile.name)


async def create_profile(
    db: AsyncSession,
    data: AccessProfileCreate,
    created_by_id: int | None = None,
) -> AccessProfile:
    """
    Cria um novo perfil de acesso.

    Args:
        db: Sessão do banco de dados
        data: Dados do novo perfil

    Returns:
        AccessProfile criado

    Raises:
        ConflictError: Nome de perfil já existe
    """
    existing = await db.execute(select(AccessProfile).where(AccessProfile.name == data.name))
    if existing.scalar_one_or_none():
        raise ConflictError(detail=f"Perfil com nome '{data.name}' já existe")

    profile = AccessProfile(
        name=data.name,
        description=data.description,
        is_galpon_profile=data.is_galpon_profile,
        hide_galpon_option=data.hide_galpon_option,
        scheduling_departments=data.scheduling_departments,
        is_active=data.is_active,
    )
    db.add(profile)
    await db.flush()  # Obtém o ID antes de criar as associações

    await _apply_permissions(db, profile, data.permissions)
    await _apply_stores(db, profile, data.store_ids)
    await _apply_users(db, profile, data.user_ids)

    await db.flush()

    await log_audit(
        db=db,
        action="create",
        resource_type="access_profile",
        user_id=created_by_id,
        resource_id=profile.id,
        new_value={"name": data.name},
    )

    # Recarregar com relacionamentos
    profile = await _get_profile_by_id(db, profile.id)
    return profile


async def update_profile(
    db: AsyncSession,
    profile_id: int,
    data: AccessProfileUpdate,
    updated_by_id: int | None = None,
) -> AccessProfile:
    """
    Atualiza um perfil de acesso existente.

    Substitui completamente permissions, store_ids e user_ids quando fornecidos.

    Args:
        db: Sessão do banco de dados
        profile_id: ID do perfil
        data: Dados para atualização

    Returns:
        AccessProfile atualizado

    Raises:
        NotFoundError: Perfil não encontrado
        ConflictError: Nome já existe em outro perfil
    """
    profile = await get_profile(db, profile_id)

    update_data = data.model_dump(
        exclude_unset=True, exclude={"permissions", "store_ids", "user_ids"}
    )

    if "name" in update_data and update_data["name"] != profile.name:
        existing = await db.execute(
            select(AccessProfile).where(
                AccessProfile.name == update_data["name"],
                AccessProfile.id != profile_id,
            )
        )
        if existing.scalar_one_or_none():
            raise ConflictError(detail=f"Perfil com nome '{update_data['name']}' já existe")

    for field, value in update_data.items():
        setattr(profile, field, value)

    if data.permissions is not None:
        await _apply_permissions(db, profile, data.permissions)

    if data.store_ids is not None:
        await _apply_stores(db, profile, data.store_ids)

    if data.user_ids is not None:
        await _apply_users(db, profile, data.user_ids)

    await db.flush()

    await log_audit(
        db=db,
        action="update",
        resource_type="access_profile",
        user_id=updated_by_id,
        resource_id=profile_id,
        new_value=update_data if update_data else {"permissions_updated": True},
    )

    profile = await _get_profile_by_id(db, profile_id)
    return profile


async def delete_profile(
    db: AsyncSession,
    profile_id: int,
    deleted_by_id: int | None = None,
) -> None:
    """
    Remove um perfil de acesso (hard delete).

    Args:
        db: Sessão do banco de dados
        profile_id: ID do perfil

    Raises:
        NotFoundError: Perfil não encontrado
        ConflictError: Perfil possui usuários vinculados
    """
    profile = await get_profile(db, profile_id)

    if profile.users:
        count = len(profile.users)
        raise ConflictError(
            detail=f"Perfil possui {count} usuário(s) vinculado(s). "
            "Desvincule todos os usuários antes de excluir o perfil."
        )

    await log_audit(
        db=db,
        action="delete",
        resource_type="access_profile",
        user_id=deleted_by_id,
        resource_id=profile_id,
        old_value={"name": profile.name},
    )

    await db.delete(profile)
    await db.flush()


# ---------------------------------------------------------------------------
# Gestão de usuários no perfil
# ---------------------------------------------------------------------------


async def add_users_to_profile(
    db: AsyncSession,
    profile_id: int,
    user_ids: list[int],
) -> AccessProfile:
    """
    Adiciona usuários a um perfil (sem remover os existentes).

    Args:
        db: Sessão do banco de dados
        profile_id: ID do perfil
        user_ids: IDs dos usuários a adicionar

    Returns:
        AccessProfile atualizado
    """
    profile = await get_profile(db, profile_id)

    existing_user_ids = {u.id for u in profile.users}
    new_user_ids = [uid for uid in user_ids if uid not in existing_user_ids]

    for user_id in new_user_ids:
        await db.execute(
            access_profile_users.insert().values(profile_id=profile.id, user_id=user_id)
        )

    await db.flush()

    return await _get_profile_by_id(db, profile_id)


async def remove_users_from_profile(
    db: AsyncSession,
    profile_id: int,
    user_ids: list[int],
) -> AccessProfile:
    """
    Remove usuários de um perfil.

    Args:
        db: Sessão do banco de dados
        profile_id: ID do perfil
        user_ids: IDs dos usuários a remover

    Returns:
        AccessProfile atualizado
    """
    # Verificar que o perfil existe
    await get_profile(db, profile_id)

    for user_id in user_ids:
        await db.execute(
            delete(access_profile_users).where(
                access_profile_users.c.profile_id == profile_id,
                access_profile_users.c.user_id == user_id,
            )
        )

    await db.flush()

    return await _get_profile_by_id(db, profile_id)


# ---------------------------------------------------------------------------
# Permissões efetivas do usuário
# ---------------------------------------------------------------------------


async def get_user_effective_permissions(
    db: AsyncSession,
    user_id: int,
) -> UserEffectivePermissions:
    """
    Retorna as permissões efetivas de um usuário baseadas em seus perfis ativos.

    As permissões são cumulativas: se qualquer perfil ativo concede can_view=True
    em um sub_module, o usuário tem can_view=True naquele módulo.

    Para os campos de loja:
    - store_ids: union de todos os store_ids dos perfis ativos
    - is_galpon_profile / hide_galpon_option: semântica ADITIVA — True somente se
      TODOS os perfis ativos tiverem a flag (mesma regra de
      app.core.permissions.is_galpon_profile_user/hide_galpon_user). Usuário
      misto (loja + galpão) é tratado como usuário normal.

    Args:
        db: Sessão do banco de dados
        user_id: ID do usuário

    Returns:
        UserEffectivePermissions com dados consolidados
    """
    # Importar aqui para evitar circular import
    from app.modules.auth.models import User

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise NotFoundError(resource="Usuário")

    # Owner tem acesso total
    if user.role == "owner":
        return UserEffectivePermissions(
            user_id=user_id,
            is_owner=True,
            permissions=[],
            store_ids=[],
            is_galpon_profile=True,
            hide_galpon_option=False,
            scheduling_departments=[],
        )

    # Buscar perfis ativos vinculados ao usuário
    profiles_result = await db.execute(
        select(AccessProfile)
        .join(access_profile_users, AccessProfile.id == access_profile_users.c.profile_id)
        .where(
            access_profile_users.c.user_id == user_id,
            AccessProfile.is_active == True,  # noqa: E712
        )
        .options(
            selectinload(AccessProfile.permissions),
            selectinload(AccessProfile.stores),
        )
    )
    active_profiles = list(profiles_result.scalars().all())

    # Acumular permissões por sub_module com OR lógico
    perm_map: dict[str, dict] = {}
    store_ids_set: set[int] = set()

    for profile in active_profiles:
        # Lojas
        for store in profile.stores:
            store_ids_set.add(store.id)

        # Permissões por módulo
        for perm in profile.permissions:
            key = perm.sub_module
            if key not in perm_map:
                perm_map[key] = {
                    "module_group": perm.module_group,
                    "sub_module": key,
                    "can_view": False,
                    "can_edit": False,
                    "can_delete": False,
                }
            perm_map[key]["can_view"] = perm_map[key]["can_view"] or perm.can_view
            perm_map[key]["can_edit"] = perm_map[key]["can_edit"] or perm.can_edit
            perm_map[key]["can_delete"] = perm_map[key]["can_delete"] or perm.can_delete

    effective_permissions = [
        UserEffectivePermission(
            sub_module=data["sub_module"],
            module_group=data["module_group"],
            can_view=data["can_view"],
            can_edit=data["can_edit"],
            can_delete=data["can_delete"],
        )
        for data in perm_map.values()
    ]

    # Flags de galpão com a MESMA semântica aditiva do enforcement central
    # (app.core.permissions): restrição só vale se TODOS os perfis a carregam.
    is_galpon_profile = profiles_all_have_flag(active_profiles, "is_galpon_profile")
    hide_galpon_option = profiles_all_have_flag(active_profiles, "hide_galpon_option")

    # Departamentos visíveis no Agendamento: se algum perfil ativo não restringe
    # (lista vazia), o usuário vê todos ([]); caso contrário, união das listas.
    scheduling_departments: list[str] = []
    if active_profiles:
        allowed: set[str] = set()
        unrestricted = False
        for profile in active_profiles:
            depts = profile.scheduling_departments or []
            if not depts:
                unrestricted = True
                break
            allowed.update(depts)
        scheduling_departments = [] if unrestricted else sorted(allowed)

    return UserEffectivePermissions(
        user_id=user_id,
        is_owner=False,
        permissions=effective_permissions,
        store_ids=sorted(store_ids_set),
        is_galpon_profile=is_galpon_profile,
        hide_galpon_option=hide_galpon_option,
        scheduling_departments=scheduling_departments,
    )
