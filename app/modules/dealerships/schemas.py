"""
Dealership schemas - Pydantic models for dealership data validation.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DealershipBase(BaseModel):
    """Base schema with common dealership attributes."""

    name: str = Field(..., min_length=2, max_length=200)
    brand: str = Field(..., min_length=2, max_length=100)
    address: str | None = Field(None, max_length=500)


class DealershipCreate(DealershipBase):
    """Schema for creating a new dealership."""

    store_id: int = Field(..., gt=0)


class DealershipUpdate(BaseModel):
    """Schema for updating a dealership. All fields optional."""

    name: str | None = Field(None, min_length=2, max_length=200)
    brand: str | None = Field(None, min_length=2, max_length=100)
    address: str | None = Field(None, max_length=500)
    is_active: bool | None = None


class DealershipResponse(DealershipBase):
    """Schema for dealership response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    store_id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime | None = None


class DealershipListResponse(BaseModel):
    """Schema for paginated dealership list response."""

    items: list[DealershipResponse]
    pagination: dict
