"""
Users schemas - Pydantic models for user management.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.permissions import UserRole
from app.core.schemas import PaginationMeta
from app.core.validators import validate_password_strength


class UserBase(BaseModel):
    """Base schema with common user attributes."""

    email: EmailStr
    full_name: str = Field(..., min_length=2, max_length=255)
    role: UserRole
    store_id: int | None = None


class UserCreate(UserBase):
    """Schema for creating a new user."""

    password: str = Field(..., min_length=8)
    supervised_store_ids: list[int] = Field(default_factory=list)

    @field_validator("password")
    @classmethod
    def check_password_strength(cls, v: str) -> str:
        return validate_password_strength(v)


class UserUpdate(BaseModel):
    """Schema for updating a user. All fields optional."""

    full_name: str | None = Field(None, min_length=2, max_length=255)
    email: EmailStr | None = None
    role: UserRole | None = None
    store_id: int | None = None
    supervised_store_ids: list[int] | None = None
    is_active: bool | None = None
    password: str | None = Field(None, min_length=8)

    @field_validator("password")
    @classmethod
    def check_password_strength(cls, v: str | None) -> str | None:
        if v is not None:
            return validate_password_strength(v)
        return v


class UserResponse(BaseModel):
    """Schema for user response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    full_name: str
    role: str
    is_active: bool
    must_change_password: bool
    store_id: int | None = None
    store_name: str | None = None
    supervised_store_ids: list[int] = Field(default_factory=list)
    employee_id: int | None = None
    employee_name: str | None = None
    last_login: datetime | None = None
    created_at: datetime
    updated_at: datetime | None = None

    @classmethod
    def from_user(cls, user, employee=None) -> "UserResponse":
        """Create response from User model. `employee` (opcional) é o Employee vinculado."""
        supervised_ids = [s.id for s in user.supervised_stores] if user.supervised_stores else []

        store_id = user.store_id
        store_name = user.store.name if user.store else None

        # Para usuários de perfil sem loja direta, derivar do primeiro perfil ativo
        if store_name is None and user.role == "user":
            for profile in getattr(user, "access_profiles", []):
                if getattr(profile, "is_active", False) and getattr(profile, "stores", []):
                    store_id = store_id or profile.stores[0].id
                    store_name = profile.stores[0].name
                    break

        employee_name = None
        if employee is not None:
            employee_name = f"{employee.name} {employee.last_name or ''}".strip()

        return cls(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=user.role,
            is_active=user.is_active,
            must_change_password=user.must_change_password,
            store_id=store_id,
            store_name=store_name,
            supervised_store_ids=supervised_ids,
            employee_id=employee.id if employee is not None else None,
            employee_name=employee_name,
            last_login=user.last_login,
            created_at=user.created_at,
            updated_at=user.updated_at,
        )


class UserListResponse(BaseModel):
    """Schema for paginated user list response."""

    items: list[UserResponse]
    pagination: PaginationMeta


class PasswordReset(BaseModel):
    """Schema for admin password reset."""

    new_password: str = Field(..., min_length=8)

    @field_validator("new_password")
    @classmethod
    def check_password_strength(cls, v: str) -> str:
        return validate_password_strength(v)


class PasswordResetResponse(BaseModel):
    """Response after admin password reset."""

    temporary_password: str
    must_change_password: bool = True
