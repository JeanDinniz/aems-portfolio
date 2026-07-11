"""
Employee schemas - Pydantic models for employee data validation.
"""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.core.schemas import PaginationMeta


class EmployeeBase(BaseModel):
    """Base schema with common employee attributes."""

    name: str = Field(..., min_length=2, max_length=200)
    store_id: int = Field(..., gt=0)
    department: str | None = Field(None, max_length=50)
    position: str | None = Field(None, max_length=100)


class EmployeeCreate(EmployeeBase):
    """Schema for creating a new employee."""

    # HML-126: Funcionário Volante
    is_volante: bool = False
    # HML-128: Funcionário do Galpão
    works_in_galpon: bool = False
    # HML-58: Dados pessoais e operacionais
    entry_date: date | None = None
    phone: str | None = Field(None, max_length=20)
    email: str | None = Field(None, max_length=200)
    pix_key: str | None = Field(None, max_length=200)
    bank_account: str | None = Field(None, max_length=200)
    address: str | None = Field(None, max_length=500)
    transport_allowance: Decimal | None = None
    # Novos campos de RH
    last_name: str | None = None
    birth_date: date | None = None
    hr_status: str | None = None


class EmployeeUpdate(BaseModel):
    """Schema for updating an employee. All fields optional."""

    name: str | None = Field(None, min_length=2, max_length=200)
    # HML-58: transferência de loja
    store_id: int | None = Field(None, gt=0)
    department: str | None = Field(None, max_length=50)
    position: str | None = Field(None, max_length=100)
    is_active: bool | None = None
    # HML-126
    is_volante: bool | None = None
    # HML-128
    works_in_galpon: bool | None = None
    # HML-58: Dados pessoais e operacionais
    entry_date: date | None = None
    phone: str | None = Field(None, max_length=20)
    email: str | None = Field(None, max_length=200)
    pix_key: str | None = Field(None, max_length=200)
    bank_account: str | None = Field(None, max_length=200)
    address: str | None = Field(None, max_length=500)
    transport_allowance: Decimal | None = None
    # HML-73: Dados de RH
    dismissal_date: date | None = None
    dismissal_reason: str | None = Field(None, max_length=500)
    would_rehire: bool | None = None
    vacation_month: int | None = Field(None, ge=1, le=12)
    # Novos campos de RH
    last_name: str | None = None
    birth_date: date | None = None
    hr_status: str | None = None


class EmployeeResponse(EmployeeBase):
    """Schema for employee response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    department: str | None = None
    position: str | None = None
    store_name: str | None = None
    is_active: bool
    # HML-126
    is_volante: bool = False
    # HML-128
    works_in_galpon: bool = False
    # HML-58
    entry_date: date | None = None
    phone: str | None = None
    email: str | None = None
    pix_key: str | None = None
    bank_account: str | None = None
    address: str | None = None
    transport_allowance: Decimal | None = None
    # HML-73
    dismissal_date: date | None = None
    dismissal_reason: str | None = None
    would_rehire: bool | None = None
    vacation_month: int | None = None
    # Novos campos de RH
    last_name: str | None = None
    birth_date: date | None = None
    hr_status: str = "active"
    created_at: datetime
    updated_at: datetime | None = None


class EmployeeListResponse(BaseModel):
    """Schema for paginated employee list response."""

    items: list[EmployeeResponse]
    pagination: PaginationMeta


class MovementCreate(BaseModel):
    """Schema for creating an employee movement record."""

    type: str  # transfer|vacation|absence|fault|promotion|dismissal
    movement_date: date
    movement_data: dict | None = None
    attachment_url: str | None = None
    notes: str | None = None


class MovementResponse(BaseModel):
    """Schema for employee movement response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    employee_name: str
    type: str
    movement_date: date
    movement_data: dict | None
    attachment_url: str | None
    notes: str | None
    created_by_id: int | None
    created_by_name: str | None
    created_at: datetime


class MovementListResponse(BaseModel):
    """Schema for paginated movement list response."""

    items: list[MovementResponse]
    pagination: PaginationMeta


class EmployeeStatsResponse(BaseModel):
    """Schema for employee statistics response."""

    total: int
    active: int
    away: int
    dismissed: int
    vacations_planned: int
