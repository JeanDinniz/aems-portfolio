"""
Supplier schemas - Pydantic models for supplier data validation.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.schemas import PaginationMeta


class SupplierBase(BaseModel):
    """Base schema with common supplier attributes."""

    company_name: str = Field(..., min_length=1, max_length=200)
    cnpj: str | None = Field(None, max_length=18, description="CNPJ do fornecedor")
    responsible: str | None = Field(None, max_length=200, description="Nome do responsável")
    phone: str | None = Field(None, max_length=20)
    email: str | None = Field(None, max_length=200)
    address: str | None = Field(None, max_length=400)


class SupplierCreate(SupplierBase):
    """Schema for creating a new supplier."""

    pass


class SupplierUpdate(BaseModel):
    """Schema for updating a supplier. All fields optional."""

    company_name: str | None = Field(None, min_length=1, max_length=200)
    cnpj: str | None = Field(None, max_length=18)
    responsible: str | None = Field(None, max_length=200)
    phone: str | None = Field(None, max_length=20)
    email: str | None = Field(None, max_length=200)
    address: str | None = Field(None, max_length=400)
    is_active: bool | None = None


class SupplierResponse(SupplierBase):
    """Schema for supplier response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime | None = None


class SupplierListResponse(BaseModel):
    """Schema for paginated supplier list response."""

    items: list[SupplierResponse]
    pagination: PaginationMeta
