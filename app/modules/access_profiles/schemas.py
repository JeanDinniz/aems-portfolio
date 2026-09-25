"""
Access Profile schemas - Pydantic models for access profile validation.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.schemas import PaginationMeta
from app.modules.services.enums import ServiceDepartment

# Códigos de departamento aceitos em scheduling_departments
VALID_DEPARTMENTS = {d.value for d in ServiceDepartment}


def _validate_departments(value: list[str] | None) -> list[str] | None:
    """Valida que todos os itens são departamentos conhecidos."""
    if value is None:
        return value
    invalid = [d for d in value if d not in VALID_DEPARTMENTS]
    if invalid:
        raise ValueError(
            f"Departamento(s) inválido(s): {', '.join(invalid)}. "
            f"Valores aceitos: {', '.join(sorted(VALID_DEPARTMENTS))}"
        )
    # Remove duplicados preservando ordem
    return list(dict.fromkeys(value))


# ---------------------------------------------------------------------------
# Permissões de módulo
# ---------------------------------------------------------------------------


class ModulePermissionIn(BaseModel):
    """Schema de entrada para uma permissão de módulo."""

    module_group: Literal["ADM", "OPERACIONAL"]
    sub_module: str = Field(..., min_length=1, max_length=50)
    can_view: bool = False
    can_edit: bool = False
    can_delete: bool = False


class ModulePermissionOut(BaseModel):
    """Schema de saída para uma permissão de módulo."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    module_group: str
    sub_module: str
    can_view: bool
    can_edit: bool
    can_delete: bool


# ---------------------------------------------------------------------------
# Perfil de acesso
# ---------------------------------------------------------------------------


class AccessProfileCreate(BaseModel):
    """Schema para criação de um novo perfil de acesso."""

    name: str = Field(..., min_length=2, max_length=100)
    description: str | None = Field(None, max_length=500)
    is_galpon_profile: bool = False
    hide_galpon_option: bool = False
    scheduling_departments: list[str] = Field(default_factory=list)
    is_active: bool = True
    permissions: list[ModulePermissionIn] = Field(default_factory=list)
    store_ids: list[int] = Field(default_factory=list)
    user_ids: list[int] = Field(default_factory=list)

    @field_validator("scheduling_departments")
    @classmethod
    def _check_departments(cls, v: list[str]) -> list[str]:
        return _validate_departments(v) or []


class AccessProfileUpdate(BaseModel):
    """Schema para atualização de perfil de acesso. Todos os campos opcionais."""

    name: str | None = Field(None, min_length=2, max_length=100)
    description: str | None = Field(None, max_length=500)
    is_galpon_profile: bool | None = None
    hide_galpon_option: bool | None = None
    scheduling_departments: list[str] | None = None
    is_active: bool | None = None
    permissions: list[ModulePermissionIn] | None = None
    store_ids: list[int] | None = None
    user_ids: list[int] | None = None

    @field_validator("scheduling_departments")
    @classmethod
    def _check_departments(cls, v: list[str] | None) -> list[str] | None:
        return _validate_departments(v)


class StoreInfo(BaseModel):
    """Informação resumida de loja para uso no perfil de acesso."""

    id: int
    name: str


class AccessProfileOut(BaseModel):
    """Schema de saída completo de um perfil de acesso."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    is_galpon_profile: bool
    hide_galpon_option: bool
    scheduling_departments: list[str] = Field(default_factory=list)
    is_active: bool
    permissions: list[ModulePermissionOut]
    store_ids: list[int] = Field(default_factory=list)
    stores: list[StoreInfo] = Field(default_factory=list)
    user_ids: list[int] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime | None = None

    @classmethod
    def from_orm_with_ids(cls, profile: "AccessProfile") -> "AccessProfileOut":  # noqa: F821
        """Constrói o schema extraindo store_ids e user_ids dos relacionamentos."""
        data = {
            "id": profile.id,
            "name": profile.name,
            "description": profile.description,
            "is_galpon_profile": profile.is_galpon_profile,
            "hide_galpon_option": profile.hide_galpon_option,
            "scheduling_departments": profile.scheduling_departments or [],
            "is_active": profile.is_active,
            "permissions": profile.permissions,
            "store_ids": [s.id for s in profile.stores],
            "stores": [{"id": s.id, "name": s.name} for s in profile.stores],
            "user_ids": [u.id for u in profile.users],
            "created_at": profile.created_at,
            "updated_at": profile.updated_at,
        }
        return cls.model_validate(data)


class AccessProfileListResponse(BaseModel):
    """Schema para listagem paginada de perfis de acesso."""

    items: list[AccessProfileOut]
    pagination: PaginationMeta


# ---------------------------------------------------------------------------
# Gestão de usuários no perfil
# ---------------------------------------------------------------------------


class ProfileUsersBulk(BaseModel):
    """Schema para adicionar/remover usuários em massa de um perfil."""

    user_ids: list[int] = Field(..., min_length=1)


# ---------------------------------------------------------------------------
# Permissões efetivas do usuário (cumulativo de todos os perfis ativos)
# ---------------------------------------------------------------------------


class UserEffectivePermission(BaseModel):
    """Permissão efetiva em um sub-módulo para o usuário logado."""

    sub_module: str
    module_group: str
    can_view: bool
    can_edit: bool
    can_delete: bool


class UserEffectivePermissions(BaseModel):
    """Conjunto de permissões efetivas do usuário."""

    user_id: int
    is_owner: bool
    permissions: list[UserEffectivePermission]
    store_ids: list[int]
    is_galpon_profile: bool
    hide_galpon_option: bool = False
    scheduling_departments: list[str] = Field(default_factory=list)
