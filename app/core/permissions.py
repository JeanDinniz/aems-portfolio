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


def is_owner(user: "User") -> bool:
    """True se o usuário tem role owner (bypass total de autorização).

    Ponto ÚNICO de verdade do bypass de owner — use em todos os call-sites
    no lugar de comparar ``user.role == "owner"`` manualmente, para evitar
    divergência de implementação entre endpoints.
    """
    return user.role == UserRole.OWNER.value


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
        if is_owner(current_user):
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
        if is_owner(current_user):
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


def check_any_profile_permission(*checks: tuple[str, str]) -> Callable:
    """
    Dependency factory: concede acesso se o usuário for Owner OU tiver QUALQUER
    uma das permissões (sub_module, action) informadas (acumulação OR).

    Uso:
        Depends(check_any_profile_permission(
            ("users", "can_view"), ("employees", "can_edit"), ("profiles", "can_view"),
        ))
    """
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.core.security import get_current_user
    from app.db.session import get_db

    # Fail-fast na criação da dependency: um typo na ação (ex.: "can_veiw")
    # negaria acesso silenciosamente via getattr(..., False).
    _valid_actions = {"can_view", "can_edit", "can_delete"}
    invalid = {ac for _, ac in checks if ac not in _valid_actions}
    if invalid:
        raise ValueError(f"Ações inválidas em check_any_profile_permission: {invalid}")

    async def checker(
        current_user=Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> "User":
        if is_owner(current_user):
            return current_user

        from sqlalchemy import select

        from app.modules.access_profiles.models import (
            AccessProfile,
            AccessProfileModulePermission,
            access_profile_users,
        )

        sub_modules = {sub_module for sub_module, _ in checks}
        result = await db.execute(
            select(AccessProfileModulePermission)
            .join(AccessProfile, AccessProfileModulePermission.profile_id == AccessProfile.id)
            .join(access_profile_users, AccessProfile.id == access_profile_users.c.profile_id)
            .where(
                access_profile_users.c.user_id == current_user.id,
                AccessProfile.is_active == True,  # noqa: E712
                AccessProfileModulePermission.sub_module.in_(sub_modules),
            )
        )
        rows = result.scalars().all()

        for sub_module, action in checks:
            for p in rows:
                if p.sub_module == sub_module and getattr(p, action, False):
                    return current_user

        required = ", ".join(f"{sm}:{ac}" for sm, ac in checks)
        raise AuthorizationError(detail=f"Permissão negada: requer uma de [{required}]")

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
        if is_owner(user):
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
        if is_owner(user):
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
        if is_owner(user):
            return query  # Owner acessa tudo
        # User sem lojas configuradas: bloqueia tudo
        return query.where(store_field == -1)
    if len(store_ids) == 1:
        return query.where(store_field == store_ids[0])
    return query.where(store_field.in_(store_ids))


def store_scope_cache_key(user: "User") -> str:
    """
    Fragmento de chave de cache com o escopo de lojas do usuário.

    Usado por catálogos de referência (consultores, funcionários) cuja listagem
    é restrita via ``apply_store_filter``/``get_user_store_ids``: o mesmo filtro
    (ex.: sem store_id) produz resultados diferentes para usuários com acesso a
    lojas diferentes, então o escopo precisa entrar na chave — nunca cachear o
    resultado de um usuário e servir para outro.

    Returns:
        "all" para Owner (vê todas as lojas); "u<ids>" com os store_ids
        ordenados do usuário, ou "u-none" se ele não tiver loja alguma.
    """
    if is_owner(user):
        return "all"
    store_ids = sorted(PermissionChecker.get_user_store_ids(user))
    if not store_ids:
        return "u-none"
    return "u" + "-".join(str(sid) for sid in store_ids)


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


def _active_profiles(user: "User") -> list:
    """Perfis de acesso ativos do usuário (vazio se relacionamento não carregado)."""
    return [p for p in getattr(user, "access_profiles", []) if getattr(p, "is_active", False)]


def profiles_all_have_flag(profiles, flag: str) -> bool:
    """
    True se a coleção não é vazia e TODOS os perfis têm o atributo `flag` True.

    Semântica ADITIVA: uma restrição (galpão/ocultar galpão) só se aplica quando
    TODOS os perfis ativos a carregam. Usuário misto (perfis de loja + perfil
    galpão) é usuário normal e vê a união dos escopos dos seus perfis.
    """
    profiles = list(profiles)
    return bool(profiles) and all(getattr(p, flag, False) for p in profiles)


def is_galpon_profile_user(user: "User") -> bool:
    """
    True somente se o usuário tem >=1 perfil ativo e TODOS têm is_galpon_profile=True.

    Usuário misto (loja + galpão) NÃO é galpão: vê O.S. normais e de galpão das
    suas lojas. Owner nunca é galpão.
    """
    if is_owner(user):
        return False
    return profiles_all_have_flag(_active_profiles(user), "is_galpon_profile")


def hide_galpon_user(user: "User") -> bool:
    """
    True somente se o usuário tem >=1 perfil ativo e TODOS têm hide_galpon_option=True.

    Usuário misto não tem o galpão ocultado. Owner nunca é afetado.
    """
    if is_owner(user):
        return False
    return profiles_all_have_flag(_active_profiles(user), "hide_galpon_option")


def scheduling_visibility_scopes(user: "User") -> list[tuple[list[int], list[str]]] | None:
    """
    Escopos de visibilidade do módulo de Agendamentos, POR PERFIL.

    Cada perfil define um escopo combinado (lojas × departamentos); o usuário vê
    a UNIÃO dos escopos dos seus perfis ativos (+ a loja direta do usuário, se
    houver, com todos os departamentos). Isso resolve o caso de perfis com
    escopos diferentes — ex.: "todas as lojas × só segurança" + "loja shopping ×
    todos" → segurança em todas as lojas E todos os departamentos no shopping.

    Retorna None quando não há restrição (owner). Cada tupla (store_ids, depts):
      - store_ids: lojas do escopo (sempre preenchido)
      - depts: [] = todos os departamentos; senão restrito a esses códigos
    Lista vazia (sem escopos) = usuário sem acesso.
    """
    if is_owner(user):
        return None
    scopes: list[tuple[list[int], list[str]]] = []
    store_id = getattr(user, "store_id", None)
    if store_id is not None:
        scopes.append(([store_id], []))
    for profile in _active_profiles(user):
        store_ids = [s.id for s in getattr(profile, "stores", [])]
        if not store_ids:
            continue
        depts = list(getattr(profile, "scheduling_departments", None) or [])
        scopes.append((store_ids, depts))
    return scopes


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
    if is_owner(user):
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
