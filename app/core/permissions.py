"""
RBAC (Role-Based Access Control) implementation.
Define permissões por role e funções de verificação.
"""

import logging
from collections.abc import Callable
from enum import StrEnum
from typing import TYPE_CHECKING

from fastapi import Depends
from sqlalchemy import Select
from sqlalchemy.orm.attributes import InstrumentedAttribute

from app.core.exceptions import AuthorizationError, NotFoundError

if TYPE_CHECKING:
    from app.modules.auth.models import User

logger = logging.getLogger(__name__)


class UserRole(StrEnum):
    """Roles disponíveis no sistema."""

    OWNER = "owner"
    USER = "user"


class Permission(StrEnum):
    """Permissões disponíveis no sistema."""

    # Service Orders
    SERVICE_ORDER_CREATE = "service_order:create"
    SERVICE_ORDER_READ = "service_order:read"
    SERVICE_ORDER_UPDATE = "service_order:update"
    SERVICE_ORDER_DELETE = "service_order:delete"
    SERVICE_ORDER_CHANGE_STATUS = "service_order:change_status"

    # Reports
    REPORT_OWN_STORE = "report:own_store"
    REPORT_SUPERVISED_STORES = "report:supervised_stores"
    REPORT_ALL_STORES = "report:all_stores"
    # Users Management
    USER_CREATE = "user:create"
    USER_READ = "user:read"
    USER_UPDATE = "user:update"
    USER_DELETE = "user:delete"

    # Stores Management
    STORE_CREATE = "store:create"
    STORE_READ = "store:read"
    STORE_UPDATE = "store:update"


# Mapeamento de permissões por role
ROLE_PERMISSIONS: dict[UserRole, set[Permission]] = {
    UserRole.OWNER: {
        # Todas as permissões
        Permission.SERVICE_ORDER_CREATE,
        Permission.SERVICE_ORDER_READ,
        Permission.SERVICE_ORDER_UPDATE,
        Permission.SERVICE_ORDER_DELETE,
        Permission.SERVICE_ORDER_CHANGE_STATUS,
        Permission.REPORT_OWN_STORE,
        Permission.REPORT_SUPERVISED_STORES,
        Permission.REPORT_ALL_STORES,
        Permission.USER_CREATE,
        Permission.USER_READ,
        Permission.USER_UPDATE,
        Permission.USER_DELETE,
        Permission.STORE_CREATE,
        Permission.STORE_READ,
        Permission.STORE_UPDATE,
    },
    UserRole.USER: set(),  # Permissões gerenciadas via perfis de acesso
}


def has_permission(role: UserRole, permission: Permission) -> bool:
    """Verifica se um role possui uma permissão específica."""
    return permission in ROLE_PERMISSIONS.get(role, set())


def get_role_permissions(role: UserRole) -> list[str]:
    """Retorna lista de permissões para um role."""
    return [p.value for p in ROLE_PERMISSIONS.get(role, set())]


def check_permission(permission: Permission) -> Callable:
    """
    Dependency factory para verificar permissão do usuário.

    Uso:
        @router.post("/items", dependencies=[Depends(check_permission(Permission.ITEM_CREATE))])
        async def create_item(...): ...
    """
    # Import here to avoid circular imports
    from app.core.security import get_current_user

    async def permission_checker(
        current_user=Depends(get_current_user),
    ) -> "User":
        user_role = UserRole(current_user.role)
        if not has_permission(user_role, permission):
            raise AuthorizationError(detail=f"Permissão negada: {permission.value} requerida")
        return current_user

    return permission_checker


def check_profile_permission(sub_module: str, action: str = "can_view") -> Callable:
    """
    Dependency factory que verifica permissão via perfis de acesso (sistema novo).

    - Owner: acesso total, sem consultar banco.
    - User: consulta os perfis de acesso vinculados ao usuário no banco.

    Args:
        sub_module: Sub-módulo do sistema (ex: "service_orders", "conference")
        action: Ação requerida: "can_view", "can_edit" ou "can_delete"

    Uso:
        @router.post("/items", dependencies=[Depends(check_profile_permission("service_orders", "can_edit"))])
    """
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.core.security import get_current_user
    from app.db.session import get_db

    async def checker(
        current_user=Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> "User":
        # Owner tem acesso total
        if current_user.role == UserRole.OWNER.value:
            return current_user

        # Para users: consulta perfis de acesso no banco
        from sqlalchemy import select

        from app.modules.access_profiles.models import (
            AccessProfile,
            AccessProfileModulePermission,
            access_profile_users,
        )

        result = await db.execute(
            select(AccessProfileModulePermission)
            .join(AccessProfile, AccessProfileModulePermission.profile_id == AccessProfile.id)
            .join(access_profile_users, AccessProfile.id == access_profile_users.c.profile_id)
            .where(
                access_profile_users.c.user_id == current_user.id,
                AccessProfile.is_active == True,  # noqa: E712
                AccessProfileModulePermission.sub_module == sub_module,
            )
        )
        permissions_rows = result.scalars().all()

        # Acumulação OR: qualquer perfil ativo concedendo a ação é suficiente
        granted = any(getattr(p, action, False) for p in permissions_rows)

        if not granted:
            raise AuthorizationError(detail=f"Permissão negada: {sub_module}:{action} requerida")

        return current_user

    return checker


def check_can_change_os_status() -> Callable:
    """
    Dependency para mudança de status / finalização de O.S.
    Concede acesso se o usuário tem service_orders:can_edit ou scheduling_os:can_edit.
    """
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.core.security import get_current_user
    from app.db.session import get_db

    async def checker(
        current_user=Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> "User":
        if current_user.role == UserRole.OWNER.value:
            return current_user

        from sqlalchemy import select

        from app.modules.access_profiles.models import (
            AccessProfile,
            AccessProfileModulePermission,
            access_profile_users,
        )

        result = await db.execute(
            select(AccessProfileModulePermission)
            .join(AccessProfile, AccessProfileModulePermission.profile_id == AccessProfile.id)
            .join(access_profile_users, AccessProfile.id == access_profile_users.c.profile_id)
            .where(
                access_profile_users.c.user_id == current_user.id,
                AccessProfile.is_active == True,  # noqa: E712
                AccessProfileModulePermission.sub_module.in_(["service_orders", "scheduling_os"]),
            )
        )
        rows = result.scalars().all()

        for p in rows:
            if p.sub_module in ("service_orders", "scheduling_os") and p.can_edit:
                return current_user

        raise AuthorizationError(
            detail="Permissão negada: service_orders:can_edit ou scheduling_os:can_edit requerida"
        )

    return checker


def require_roles(*roles: UserRole) -> Callable:
    """
    Dependency factory para restringir acesso a roles específicos.

    Uso:
        @router.get("/admin", dependencies=[Depends(require_roles(UserRole.OWNER))])
        async def admin_only(...): ...
    """
    # Import here to avoid circular imports
    from app.core.security import get_current_user

    async def role_checker(
        current_user=Depends(get_current_user),
    ) -> "User":
        user_role = UserRole(current_user.role)
        if user_role not in roles:
            raise AuthorizationError(
                detail=f"Acesso restrito a: {', '.join(r.value for r in roles)}"
            )
        return current_user

    return role_checker


# =============================================================================
# Store-Level Permission Helpers
# =============================================================================


class PermissionChecker:
    """
    Helper class para validações de permissão baseadas em loja.
    Fornece métodos estáticos para verificar acesso a recursos por store_id.
    """

    @staticmethod
    def can_manage_store(user: "User", store_id: int) -> bool:
        """
        Verifica se usuário pode gerenciar uma loja específica.

        Args:
            user: Usuário que está tentando acessar
            store_id: ID da loja a ser gerenciada

        Returns:
            True se usuário pode gerenciar a loja
        """
        # Owner pode gerenciar qualquer loja
        if user.role == UserRole.OWNER.value:
            return True

        # User: verifica se store_id está nas lojas permitidas pelos perfis de acesso
        permitted = PermissionChecker.get_user_store_ids(user)
        return store_id in permitted

    @staticmethod
    def can_view_store_data(user: "User", store_id: int) -> bool:
        """
        Verifica se usuário pode visualizar dados de uma loja.
        Mesma lógica de can_manage_store por padrão.

        Args:
            user: Usuário que está tentando acessar
            store_id: ID da loja

        Returns:
            True se usuário pode visualizar dados da loja
        """
        return PermissionChecker.can_manage_store(user, store_id)

    @staticmethod
    def get_user_store_ids(user: "User") -> list[int]:
        """
        Retorna lista de IDs de lojas que o usuário tem acesso.

        Args:
            user: Usuário

        Returns:
            Lista de store_ids que o usuário pode acessar.
            Lista vazia para Owner (acesso a todas).
        """
        if user.role == UserRole.OWNER.value:
            return []  # Empty list means all stores

        # User: coletar lojas do store_id direto + perfis de acesso ativos
        store_ids: list[int] = []
        if user.store_id is not None:
            store_ids.append(user.store_id)

        for profile in getattr(user, "access_profiles", []):
            if getattr(profile, "is_active", False):
                for store in getattr(profile, "stores", []):
                    if store.id not in store_ids:
                        store_ids.append(store.id)

        return store_ids

    @staticmethod
    def require_store_access(user: "User", store_id: int, action: str = "acessar") -> None:
        """
        Valida e lança exceção se usuário não tiver acesso à loja.

        Args:
            user: Usuário
            store_id: ID da loja
            action: Descrição da ação (para mensagem de erro)

        Raises:
            AuthorizationError: Se usuário não tiver permissão
        """
        if not PermissionChecker.can_manage_store(user, store_id):
            logger.warning(
                f"Permission denied: User {user.id} ({user.role}) tried to "
                f"{action} store {store_id}"
            )
            raise AuthorizationError(detail=f"Sem permissão para {action} esta loja")

    @staticmethod
    def require_role(
        user: "User", *allowed_roles: UserRole, action: str = "executar esta ação"
    ) -> None:
        """
        Valida e lança exceção se usuário não tiver role permitido.

        Args:
            user: Usuário
            allowed_roles: Roles permitidos
            action: Descrição da ação (para mensagem de erro)

        Raises:
            AuthorizationError: Se usuário não tiver role permitido
        """
        user_role = UserRole(user.role)
        if user_role not in allowed_roles:
            logger.warning(
                f"Permission denied: User {user.id} ({user.role}) tried to "
                f"{action}. Required roles: {[r.value for r in allowed_roles]}"
            )
            raise AuthorizationError(
                detail=f"Apenas {', '.join(r.value for r in allowed_roles)} podem {action}"
            )

    @staticmethod
    def require_own_store(user: "User", action: str = "executar esta ação") -> int:
        """
        Valida que usuário está vinculado a uma loja e retorna o store_id.

        Args:
            user: Usuário
            action: Descrição da ação (para mensagem de erro)

        Returns:
            store_id do usuário

        Raises:
            AuthorizationError: Se usuário não estiver vinculado a uma loja
        """
        if user.store_id is None:
            logger.warning(
                f"Permission denied: User {user.id} ({user.role}) tried to "
                f"{action} but has no store_id"
            )
            raise AuthorizationError(detail="Você não está vinculado a uma loja")
        return user.store_id


def apply_store_filter(
    query: Select,
    user: "User",
    store_field: InstrumentedAttribute,
) -> Select:
    """
    Aplica filtro de loja na query baseado no role do usuário.

    Args:
        query: Query SQLAlchemy em construção
        user: Usuário que está filtrando
        store_field: Campo de store_id do modelo (ex: ServiceOrder.store_id)

    Returns:
        Query com filtro de loja aplicado
    """
    store_ids = PermissionChecker.get_user_store_ids(user)
    if not store_ids:
        if user.role == UserRole.OWNER.value:
            return query  # Owner acessa tudo
        # User sem lojas configuradas: bloqueia tudo
        return query.where(store_field == -1)
    if len(store_ids) == 1:
        return query.where(store_field == store_ids[0])
    return query.where(store_field.in_(store_ids))


def require_resource_access(user: "User", store_id: int, resource_name: str = "Recurso") -> None:
    """
    Valida acesso do usuário à loja e lança NotFoundError se negado.

    Usa NotFoundError ao invés de AuthorizationError para não revelar
    a existência do recurso (security through obscurity).

    Args:
        user: Usuário que está tentando acessar
        store_id: ID da loja do recurso
        resource_name: Nome do recurso para mensagem de erro

    Raises:
        NotFoundError: Se usuário não tiver permissão de acesso à loja
    """
    if not PermissionChecker.can_manage_store(user, store_id):
        raise NotFoundError(resource=resource_name)


def is_galpon_profile_user(user: "User") -> bool:
    """True se o usuário tem ao menos um perfil ativo com is_galpon_profile=True. Owner nunca é galpão."""
    if user.role == UserRole.OWNER.value:
        return False
    for profile in getattr(user, "access_profiles", []):
        if getattr(profile, "is_active", False) and getattr(profile, "is_galpon_profile", False):
            return True
    return False


def hide_galpon_user(user: "User") -> bool:
    """True se o usuário tem ao menos um perfil ativo com hide_galpon_option=True. Owner nunca é afetado."""
    if user.role == UserRole.OWNER.value:
        return False
    for profile in getattr(user, "access_profiles", []):
        if getattr(profile, "is_active", False) and getattr(profile, "hide_galpon_option", False):
            return True
    return False


# Global instance for easy access
permissions = PermissionChecker()


# =============================================================================
# Module-Level Permission Defaults per Role
# =============================================================================


# Default permissions per role per module.
# Custom UserModulePermission records take priority over these defaults.
def get_access_profile_permission(user: "User", sub_module: str, action: str = "view") -> bool:
    """
    Retorna a permissão efetiva de um usuário em um sub-módulo com base nos seus
    perfis de acesso ativos. Owner sempre retorna True.

    Args:
        user: Usuário cujas permissões serão verificadas
        sub_module: Nome do sub-módulo (ex: "service_orders", "conference")
        action: "view", "edit" ou "delete"

    Returns:
        True se qualquer perfil ativo do usuário concede a permissão
    """
    if user.role == UserRole.OWNER.value:
        return True

    for profile in getattr(user, "access_profiles", []):
        if not getattr(profile, "is_active", False):
            continue
        for perm in getattr(profile, "permissions", []):
            if perm.sub_module == sub_module:
                if action == "view" and perm.can_view:
                    return True
                if action == "edit" and perm.can_edit:
                    return True
                if action == "delete" and perm.can_delete:
                    return True

    return False
