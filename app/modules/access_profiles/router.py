"""
Access Profile router - API endpoints for access profile management.
"""

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AuthorizationError
from app.core.security import get_current_user
from app.db.session import get_db
from app.dependencies import PaginatedResponse
from app.modules.access_profiles import service
from app.modules.access_profiles.schemas import (
    AccessProfileCreate,
    AccessProfileListResponse,
    AccessProfileOut,
    AccessProfileUpdate,
    ProfileUsersBulk,
    UserEffectivePermissions,
)

router = APIRouter(prefix="/access-profiles", tags=["Access Profiles"])


def _require_owner(current_user) -> None:
    """Verifica que o usuário é owner. Lança 403 caso contrário."""
    if current_user.role != "owner":
        raise AuthorizationError(detail="Apenas owners podem gerenciar perfis de acesso")


# ---------------------------------------------------------------------------
# CRUD de perfis
# ---------------------------------------------------------------------------


@router.get("", response_model=AccessProfileListResponse)
async def list_profiles(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    page: int = Query(1, ge=1, description="Página atual"),
    limit: int = Query(20, ge=1, le=500, description="Itens por página"),
    is_active: bool | None = Query(None, description="Filtrar por status ativo"),
    search: str | None = Query(None, description="Buscar por nome"),
    store_id: int | None = Query(None, description="Filtrar por loja vinculada"),
):
    """
    Lista todos os perfis de acesso.
    Apenas owners podem acessar este endpoint.
    """
    _require_owner(current_user)

    profiles, total = await service.list_profiles(
        db=db,
        page=page,
        limit=limit,
        is_active=is_active,
        search=search,
        store_id=store_id,
    )

    return PaginatedResponse.create(
        items=[AccessProfileOut.from_orm_with_ids(p) for p in profiles],
        total=total,
        page=page,
        limit=limit,
    )


@router.get("/{profile_id}", response_model=AccessProfileOut)
async def get_profile(
    profile_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Obtém detalhes de um perfil de acesso.
    Apenas owners podem acessar este endpoint.
    """
    _require_owner(current_user)

    profile = await service.get_profile(db=db, profile_id=profile_id)
    return AccessProfileOut.from_orm_with_ids(profile)


@router.post("", response_model=AccessProfileOut, status_code=status.HTTP_201_CREATED)
async def create_profile(
    data: AccessProfileCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Cria um novo perfil de acesso.
    Apenas owners podem criar perfis.
    """
    _require_owner(current_user)

    profile = await service.create_profile(db=db, data=data, created_by_id=current_user.id)
    await db.commit()
    await db.refresh(profile)
    profile = await service.get_profile(db=db, profile_id=profile.id)
    return AccessProfileOut.from_orm_with_ids(profile)


@router.put("/{profile_id}", response_model=AccessProfileOut)
async def update_profile(
    profile_id: int,
    data: AccessProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Atualiza um perfil de acesso existente.
    Apenas owners podem atualizar perfis.
    """
    _require_owner(current_user)

    profile = await service.update_profile(
        db=db, profile_id=profile_id, data=data, updated_by_id=current_user.id
    )
    await db.commit()
    profile = await service.get_profile(db=db, profile_id=profile_id)
    return AccessProfileOut.from_orm_with_ids(profile)


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_profile(
    profile_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Remove um perfil de acesso (hard delete).
    Apenas owners podem remover perfis.
    """
    _require_owner(current_user)

    await service.delete_profile(db=db, profile_id=profile_id, deleted_by_id=current_user.id)
    await db.commit()


# ---------------------------------------------------------------------------
# Gestão de usuários no perfil
# ---------------------------------------------------------------------------


@router.post(
    "/{profile_id}/users",
    response_model=AccessProfileOut,
    status_code=status.HTTP_200_OK,
)
async def add_users_to_profile(
    profile_id: int,
    data: ProfileUsersBulk,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Adiciona usuários a um perfil (acumulativo, não remove existentes).
    Apenas owners podem gerenciar usuários de perfis.
    """
    _require_owner(current_user)

    profile = await service.add_users_to_profile(
        db=db, profile_id=profile_id, user_ids=data.user_ids
    )
    await db.commit()
    profile = await service.get_profile(db=db, profile_id=profile_id)
    return AccessProfileOut.from_orm_with_ids(profile)


@router.delete(
    "/{profile_id}/users",
    response_model=AccessProfileOut,
    status_code=status.HTTP_200_OK,
)
async def remove_users_from_profile(
    profile_id: int,
    data: ProfileUsersBulk,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Remove usuários de um perfil.
    Apenas owners podem gerenciar usuários de perfis.
    """
    _require_owner(current_user)

    profile = await service.remove_users_from_profile(
        db=db, profile_id=profile_id, user_ids=data.user_ids
    )
    await db.commit()
    profile = await service.get_profile(db=db, profile_id=profile_id)
    return AccessProfileOut.from_orm_with_ids(profile)


# ---------------------------------------------------------------------------
# Permissões efetivas do usuário logado
# Nota: este endpoint usa o prefixo /users/me via inclusion no main.py,
#       mas registramos aqui como /me/permissions dentro do router próprio
#       para manter cohesão. O main.py registra o router sem prefixo extra.
# ---------------------------------------------------------------------------

me_router = APIRouter(prefix="/users", tags=["Users"])


@me_router.get("/me/permissions", response_model=UserEffectivePermissions)
async def get_my_permissions(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Retorna as permissões efetivas do usuário autenticado.

    Para owners: is_owner=True, permissões vazias (acesso total implícito).
    Para users: permissões cumulativas de todos os perfis ativos vinculados.
    """
    return await service.get_user_effective_permissions(db=db, user_id=current_user.id)
