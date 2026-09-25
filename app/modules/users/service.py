"""
Users service - Business logic for user management.
"""

import secrets
import string
from typing import TYPE_CHECKING

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit
from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.core.pagination import paginate
from app.core.permissions import PermissionChecker, UserRole, apply_store_filter
from app.core.security import get_password_hash
from app.modules.auth.models import User
from app.modules.users.schemas import (
    UserCreate,
    UserUpdate,
)

if TYPE_CHECKING:
    from app.modules.employees.models import Employee


async def get_user_by_id(db: AsyncSession, user_id: int) -> User | None:
    """Busca usuário por ID com loja."""
    result = await db.execute(
        select(User).options(selectinload(User.store)).where(User.id == user_id)
    )
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    """Busca usuário por email."""
    result = await db.execute(select(User).where(User.email == email.lower()))
    return result.scalar_one_or_none()


async def list_users(
    db: AsyncSession,
    requesting_user: User,
    page: int = 1,
    limit: int = 20,
    role: UserRole | None = None,
    store_id: int | None = None,
    is_active: bool | None = None,
    search: str | None = None,
    has_employee: bool | None = None,
) -> tuple[list[User], int]:
    """
    Lista usuários com base nas permissões do usuário solicitante.
    """
    from app.modules.access_profiles.models import AccessProfile

    query = select(User).options(
        selectinload(User.store),
        selectinload(User.access_profiles).selectinload(AccessProfile.stores),
    )

    query = apply_store_filter(query, requesting_user, User.store_id)

    if role:
        query = query.where(User.role == role.value)
    if store_id:
        from app.modules.access_profiles.models import access_profile_stores, access_profile_users

        profile_user_sq = (
            select(access_profile_users.c.user_id)
            .join(
                access_profile_stores,
                access_profile_stores.c.profile_id == access_profile_users.c.profile_id,
            )
            .where(access_profile_stores.c.store_id == store_id)
        )
        query = query.where((User.store_id == store_id) | User.id.in_(profile_user_sq))
    if is_active is not None:
        query = query.where(User.is_active == is_active)
    if search:
        pattern = f"%{search}%"
        query = query.where((User.full_name.ilike(pattern)) | (User.email.ilike(pattern)))

    if has_employee is not None:
        from app.modules.employees.models import Employee

        linked_sq = select(Employee.user_id).where(Employee.user_id.is_not(None))
        query = query.where(User.id.in_(linked_sq) if has_employee else User.id.not_in(linked_sq))

    return await paginate(db, query, page, limit, order_by=User.full_name)


async def get_linked_employees_by_user_ids(
    db: AsyncSession, user_ids: list[int]
) -> dict[int, "Employee"]:
    """
    Mapeia user_id → Employee vinculado (para exibir o funcionário na listagem de usuários).
    Uma única query IN — sem N+1.
    """
    from app.modules.employees.models import Employee

    if not user_ids:
        return {}
    result = await db.execute(select(Employee).where(Employee.user_id.in_(user_ids)))
    return {emp.user_id: emp for emp in result.scalars().all() if emp.user_id is not None}


async def get_user(db: AsyncSession, user_id: int, requesting_user: User) -> User:
    """
    Obtém um usuário verificando permissões.
    """
    user = await get_user_by_id(db, user_id)

    if not user:
        raise NotFoundError(resource="Usuário")

    if user.store_id is not None:
        if not PermissionChecker.can_manage_store(requesting_user, user.store_id):
            raise NotFoundError(resource="Usuário")
    elif requesting_user.role != UserRole.OWNER.value:
        raise NotFoundError(resource="Usuário")

    return user


async def create_user(
    db: AsyncSession,
    data: UserCreate,
    created_by: User,
    request: Request | None = None,
) -> User:
    """
    Cria um novo usuário.
    """
    existing = await get_user_by_email(db, data.email)
    if existing:
        raise ConflictError(detail=f"Email {data.email} já cadastrado")

    user = User(
        email=data.email.lower(),
        hashed_password=get_password_hash(data.password),
        full_name=data.full_name,
        role=data.role.value,
        store_id=data.store_id,
        must_change_password=True,
    )
    db.add(user)
    await db.flush()

    await log_audit(
        db=db,
        action="user_created",
        resource_type="user",
        user_id=created_by.id,
        resource_id=user.id,
        old_value=None,
        new_value={
            "email": data.email.lower(),
            "full_name": data.full_name,
            "role": data.role.value,
            "store_id": data.store_id,
            "supervised_store_ids": data.supervised_store_ids or [],
        },
        request=request,
    )

    await db.commit()
    refreshed = await get_user_by_id(db, user.id)
    if refreshed is None:
        raise NotFoundError(resource="Usuário")

    # E-mail de boas-vindas: link para o novo usuário definir a própria senha
    # (reaproveita o mesmo token/página de reset). Não bloqueia a criação se falhar.
    try:
        from app.config import get_settings
        from app.core.email_templates import welcome_email
        from app.modules.auth.service import issue_password_token
        from app.workers.tasks import send_transactional_email

        settings = get_settings()
        token = await issue_password_token(refreshed.id, ttl_seconds=72 * 3600)
        set_password_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
        subject, html, text = welcome_email(refreshed.full_name, set_password_url)
        send_transactional_email.delay(to=refreshed.email, subject=subject, html=html, text=text)
    except Exception:  # noqa: BLE001 — e-mail é best-effort, não derruba a criação
        import logging

        logging.getLogger(__name__).warning(
            "Falha ao enfileirar e-mail de boas-vindas para user_id=%s", refreshed.id
        )

    return refreshed


async def update_user(
    db: AsyncSession,
    user_id: int,
    data: UserUpdate,
    updated_by: User,
    request: Request | None = None,
) -> User:
    """
    Atualiza um usuário existente.
    """
    user = await get_user_by_id(db, user_id)

    if not user:
        raise NotFoundError(resource="Usuário")

    if updated_by.id == user_id and data.role and updated_by.role != UserRole.OWNER.value:
        raise ValidationError(detail="Não é possível alterar seu próprio role")

    old_role = user.role
    old_is_active = user.is_active
    old_store_id = user.store_id

    update_data = data.model_dump(exclude_unset=True, exclude={"supervised_store_ids", "password"})
    for field, value in update_data.items():
        if field == "role" and value:
            setattr(user, field, value.value)
        else:
            setattr(user, field, value)

    if data.password:
        user.hashed_password = get_password_hash(data.password)
        user.must_change_password = True

    await db.flush()

    new_role = user.role
    new_is_active = user.is_active

    if old_role != new_role:
        await log_audit(
            db=db,
            action="role_changed",
            resource_type="user",
            user_id=updated_by.id,
            resource_id=user_id,
            old_value={"role": old_role},
            new_value={"role": new_role},
            request=request,
        )

    if old_is_active != new_is_active:
        action = "user_activated" if new_is_active else "user_deactivated"
        await log_audit(
            db=db,
            action=action,
            resource_type="user",
            user_id=updated_by.id,
            resource_id=user_id,
            old_value={"is_active": old_is_active},
            new_value={"is_active": new_is_active},
            request=request,
        )

    other_changes = {k: v for k, v in update_data.items() if k not in {"role", "is_active"}}
    if other_changes or data.supervised_store_ids is not None:
        old_generic: dict = {}
        new_generic: dict = {}
        if other_changes:
            for k in other_changes:
                old_generic[k] = getattr(user, k, None)
            new_generic.update(other_changes)
        if data.supervised_store_ids is not None:
            new_generic["supervised_store_ids"] = data.supervised_store_ids
        await log_audit(
            db=db,
            action="user_updated",
            resource_type="user",
            user_id=updated_by.id,
            resource_id=user_id,
            old_value={"store_id": old_store_id} if other_changes else None,
            new_value=new_generic if new_generic else None,
            request=request,
        )

    await db.commit()
    refreshed = await get_user_by_id(db, user.id)
    if refreshed is None:
        raise NotFoundError(resource="Usuário")
    return refreshed


async def delete_user(
    db: AsyncSession,
    user_id: int,
    deleted_by: User,
    request: Request | None = None,
) -> dict:
    """
    Exclui permanentemente um usuário.
    """
    from sqlalchemy.exc import IntegrityError

    if user_id == deleted_by.id:
        raise ValidationError(detail="Não é possível excluir sua própria conta")

    user = await get_user_by_id(db, user_id)

    if not user:
        raise NotFoundError(resource="Usuário")

    deleted_info = {"id": user.id, "full_name": user.full_name, "email": user.email}

    await log_audit(
        db=db,
        action="user_deleted",
        resource_type="user",
        user_id=deleted_by.id,
        resource_id=user_id,
        old_value={"full_name": user.full_name, "email": user.email, "is_active": user.is_active},
        new_value=None,
        request=request,
    )

    try:
        await db.delete(user)
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ConflictError(
            detail="Não é possível excluir o usuário pois ele possui vínculos ativos "
            "(ordens de serviço criadas ou histórico de status). "
            "Remova os vínculos antes de excluir."
        ) from None

    return deleted_info


async def activate_user(
    db: AsyncSession,
    user_id: int,
    activated_by: User | None = None,
    request: Request | None = None,
) -> User:
    """
    Reativa um usuário desativado.
    """
    user = await get_user_by_id(db, user_id)

    if not user:
        raise NotFoundError(resource="Usuário")

    user.is_active = True
    await db.flush()

    await log_audit(
        db=db,
        action="user_activated",
        resource_type="user",
        user_id=activated_by.id if activated_by else None,
        resource_id=user_id,
        old_value={"is_active": False},
        new_value={"is_active": True},
        request=request,
    )

    await db.commit()
    refreshed = await get_user_by_id(db, user_id)
    if refreshed is None:
        raise NotFoundError(resource="Usuário")
    return refreshed


async def reset_password(
    db: AsyncSession,
    user_id: int,
    reset_by: User | None = None,
    request: Request | None = None,
) -> tuple[User, str]:
    """
    Reseta a senha de um usuário (admin action).
    """
    user = await get_user_by_id(db, user_id)

    if not user:
        raise NotFoundError(resource="Usuário")

    alphabet = string.ascii_letters + string.digits + "!@#$%"
    new_password = "".join(secrets.choice(alphabet) for _ in range(12))

    user.hashed_password = get_password_hash(new_password)
    user.must_change_password = True
    user.failed_login_attempts = 0
    user.locked_until = None

    await db.flush()

    await log_audit(
        db=db,
        action="password_reset",
        resource_type="user",
        user_id=reset_by.id if reset_by else None,
        resource_id=user_id,
        old_value=None,
        new_value={"must_change_password": True, "failed_login_attempts_cleared": True},
        request=request,
    )

    await db.commit()
    refreshed = await get_user_by_id(db, user_id)
    if refreshed is None:
        raise NotFoundError(resource="Usuário")
    return refreshed, new_password


async def list_workers(
    db: AsyncSession,
    store_id: int | None = None,
    department: str | None = None,
    requesting_user: "User | None" = None,
) -> list[User]:
    """
    Lista funcionários (users) para seleção em O.S.

    Escopo de loja:
    - Owner: vê funcionários de todas as lojas (sem restrição).
    - Demais usuários: veem apenas funcionários da(s) loja(s) que gerenciam.
      O parâmetro ``store_id`` refina dentro desse escopo, mas não amplia.

    O filtro por ``department == "film"`` não concede visibilidade cross-loja
    a não-owners — o escopo de loja é sempre aplicado primeiro.
    """
    from app.core.permissions import PermissionChecker, is_owner

    query = select(User).options(selectinload(User.store))
    query = query.where(User.role == UserRole.USER.value)
    query = query.where(User.is_active.is_(True))

    # Aplicar escopo de loja: owner vê tudo; demais ficam restritos às suas lojas.
    if requesting_user is not None and not is_owner(requesting_user):
        allowed_store_ids = PermissionChecker.get_user_store_ids(requesting_user)
        if allowed_store_ids:
            if store_id is not None and store_id in allowed_store_ids:
                # Refinamento: usuário pediu uma loja específica que ele gerencia.
                query = query.where(User.store_id == store_id)
            elif store_id is not None:
                # Loja solicitada fora do escopo do usuário — retorna vazio.
                query = query.where(User.store_id == -1)
            else:
                query = query.where(User.store_id.in_(allowed_store_ids))
        else:
            # Usuário sem lojas configuradas: bloqueia tudo.
            query = query.where(User.store_id == -1)
    elif store_id is not None:
        # Owner refinando por loja específica (ou requesting_user não fornecido — legado).
        query = query.where(User.store_id == store_id)

    query = query.order_by(User.full_name)
    result = await db.execute(query)
    return list(result.scalars().all())
