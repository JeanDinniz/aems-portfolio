"""
Auth schemas - Pydantic models for authentication.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.permissions import UserRole
from app.core.schemas import PaginationMeta
from app.core.validators import validate_password_strength


class LoginRequest(BaseModel):
    """Schema for login request."""

    email: EmailStr
    password: str = Field(..., min_length=8)


class LoginResponse(BaseModel):
    """Schema for successful login response."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds
    must_change_password: bool = False


class RefreshTokenRequest(BaseModel):
    """Schema for token refresh request."""

    refresh_token: str


class PasswordChange(BaseModel):
    """Schema for password change request."""

    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8)

    @field_validator("new_password")
    @classmethod
    def check_password_strength(cls, v: str) -> str:
        return validate_password_strength(v)


class PasswordReset(BaseModel):
    """Schema for password reset with token."""

    token: str
    new_password: str = Field(..., min_length=8)

    @field_validator("new_password")
    @classmethod
    def check_password_strength(cls, v: str) -> str:
        return validate_password_strength(v)


class LogoutRequest(BaseModel):
    """Schema for logout request."""

    refresh_token: str | None = None


class ForgotPasswordRequest(BaseModel):
    """Schema for forgot password request."""

    email: EmailStr


# User schemas
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
    """Schema for updating a user."""

    full_name: str | None = Field(None, min_length=2, max_length=255)
    role: UserRole | None = None
    store_id: int | None = None
    supervised_store_ids: list[int] | None = None
    is_active: bool | None = None


class UserResponse(BaseModel):
    """Schema for user response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    full_name: str
    role: UserRole
    is_active: bool
    must_change_password: bool
    store_id: int | None = None
    supervised_store_ids: list[int] = Field(default_factory=list)
    last_login: datetime | None = None
    created_at: datetime
    updated_at: datetime | None = None


class UserListResponse(BaseModel):
    """Schema for paginated user list response."""

    items: list[UserResponse]
    pagination: PaginationMeta


class UserMeResponse(UserResponse):
    """Schema for current user response with additional info."""

    store_name: str | None = None
    accessible_store_ids: list[int] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)


class AccessLogResponse(BaseModel):
    """Schema for access log response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int | None
    action: str
    resource: str | None
    ip_address: str | None
    user_agent: str | None
    success: bool
    created_at: datetime
