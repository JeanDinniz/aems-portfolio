"""
Holiday schemas - Pydantic models for holiday data validation.
"""

from datetime import date as date_type
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.schemas import PaginationMeta


class HolidayBase(BaseModel):
    """Base schema with common holiday attributes."""

    date: date_type
    name: str = Field(..., min_length=2, max_length=200)
    store_id: int | None = None  # None = todas as lojas


class HolidayCreate(HolidayBase):
    """Schema for creating a new holiday."""

    pass


class HolidayUpdate(BaseModel):
    """Schema for updating a holiday. All fields optional."""

    date: date_type | None = None
    name: str | None = Field(None, min_length=2, max_length=200)
    store_id: int | None = None
    clear_store: bool = False  # True = tornar o feriado válido para todas as lojas


class HolidayResponse(BaseModel):
    """Schema for holiday response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    date: date_type
    name: str
    store_id: int | None = None
    store_name: str | None = None
    created_at: datetime
    updated_at: datetime | None = None


class HolidayListResponse(BaseModel):
    """Schema for paginated holiday list response."""

    items: list[HolidayResponse]
    pagination: PaginationMeta
