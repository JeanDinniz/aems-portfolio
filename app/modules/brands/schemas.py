"""
Brand schemas - Pydantic models for brand data validation.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.schemas import PaginationMeta


class BrandBase(BaseModel):
    """Base schema with common brand attributes."""

    name: str = Field(..., min_length=2, max_length=100)
    code: str = Field(..., min_length=2, max_length=10, pattern=r"^[a-z]+$")


class BrandCreate(BrandBase):
    """Schema for creating a new brand."""

    pass


class BrandUpdate(BaseModel):
    """Schema for updating a brand. All fields optional."""

    name: str | None = Field(None, min_length=2, max_length=100)
    is_active: bool | None = None


class BrandResponse(BaseModel):
    """Schema for brand response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    code: str
    is_active: bool
    created_at: datetime
    updated_at: datetime | None = None


class BrandListResponse(BaseModel):
    """Schema for paginated brand list response."""

    items: list[BrandResponse]
    pagination: PaginationMeta
