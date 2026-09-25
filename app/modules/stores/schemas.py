"""
Store schemas - Pydantic models for store data validation.
"""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.schemas import PaginationMeta
from app.modules.brands.schemas import BrandResponse


class StoreBase(BaseModel):
    """Base schema with common store attributes."""

    name: str = Field(..., min_length=2, max_length=100)
    code: str = Field(..., min_length=4, max_length=4, pattern=r"^LJ\d{2}$")
    address: str | None = Field(None, max_length=500)
    phone: str | None = Field(None, max_length=20)


class StoreCreate(StoreBase):
    """Schema for creating a new store."""

    brand_id: int = Field(..., gt=0, description="ID da marca da concessionária")


class StoreUpdate(BaseModel):
    """Schema for updating a store. All fields optional."""

    name: str | None = Field(None, min_length=2, max_length=100)
    address: str | None = Field(None, max_length=500)
    phone: str | None = Field(None, max_length=20)
    is_active: bool | None = None
    is_galpon_store: bool | None = None
    brand_id: int | None = Field(None, gt=0, description="ID da marca da concessionária")
    has_shared_inventory: bool | None = None
    linked_inventory_store_ids: list[int] | None = None
    # Ponto Eletrônico: geofence (null = sem geofence; nunca bloqueia a batida)
    latitude: Decimal | None = Field(None, ge=-90, le=90)
    longitude: Decimal | None = Field(None, ge=-180, le=180)
    geofence_radius_m: int | None = Field(None, ge=10, le=10000)


class StoreResponse(StoreBase):
    """Schema for store response."""

    model_config = ConfigDict(from_attributes=True)

    # Override to remove pattern restriction on response (existing data may differ)
    code: str = Field(..., min_length=2, max_length=10)

    id: int
    brand_id: int
    brand: BrandResponse | None = None
    dealership_brand: str | None = None
    is_active: bool
    is_galpon_store: bool
    has_shared_inventory: bool
    linked_inventory_store_ids: list[int] = []
    # Ponto Eletrônico
    latitude: Decimal | None = None
    longitude: Decimal | None = None
    geofence_radius_m: int = 200
    created_at: datetime
    updated_at: datetime | None = None

    @model_validator(mode="before")
    @classmethod
    def compute_linked_ids(cls, data: object) -> object:
        """Deriva linked_inventory_store_ids a partir do relacionamento inventory_links."""
        if hasattr(data, "inventory_links"):
            data.__dict__["linked_inventory_store_ids"] = [
                link.linked_store_id for link in (data.inventory_links or [])
            ]
        return data


class StoreListResponse(BaseModel):
    """Schema for paginated store list response."""

    items: list[StoreResponse]
    pagination: PaginationMeta
