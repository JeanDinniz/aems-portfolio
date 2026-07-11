"""
Consultant schemas - Pydantic models for consultant data validation.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.schemas import PaginationMeta


class ConsultantBase(BaseModel):
    """Base schema with common consultant attributes."""

    name: str = Field(..., min_length=2, max_length=200)
    phone: str | None = Field(None, max_length=20)
    email: EmailStr | None = None

    # Dados de pagamento (opcionais)
    pix_key: str | None = Field(None, max_length=200)
    bank_name: str | None = Field(None, max_length=100)
    bank_agency: str | None = Field(None, max_length=20)
    bank_account: str | None = Field(None, max_length=30)
    bank_account_type: str | None = Field(None, pattern="^(corrente|poupanca)$")


class ConsultantCreate(ConsultantBase):
    """Schema for creating a new consultant."""

    store_id: int = Field(..., gt=0)
    dealership_id: int | None = Field(None, gt=0)


class ConsultantUpdate(BaseModel):
    """Schema for updating a consultant. All fields optional."""

    name: str | None = Field(None, min_length=2, max_length=200)
    store_id: int | None = Field(None, gt=0)
    phone: str | None = Field(None, max_length=20)
    email: EmailStr | None = None
    is_active: bool | None = None

    # Dados de pagamento (opcionais)
    pix_key: str | None = Field(None, max_length=200)
    bank_name: str | None = Field(None, max_length=100)
    bank_agency: str | None = Field(None, max_length=20)
    bank_account: str | None = Field(None, max_length=30)
    bank_account_type: str | None = Field(None, pattern="^(corrente|poupanca)$")


class ConsultantResponse(ConsultantBase):
    """Schema for consultant response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    dealership_id: int
    store_id: int
    store_name: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime | None = None


class ConsultantListResponse(BaseModel):
    """Schema for paginated consultant list response."""

    items: list[ConsultantResponse]
    pagination: PaginationMeta
