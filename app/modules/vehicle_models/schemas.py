"""
VehicleModel schemas - Pydantic models for vehicle model data validation.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.schemas import PaginationMeta
from app.modules.brands.schemas import BrandResponse


class VehicleModelCreate(BaseModel):
    """Schema para criação de um novo modelo de veículo."""

    name: str = Field(
        ..., min_length=1, max_length=100, description="Nome do modelo (ex: Corolla, HB20)"
    )
    brand_id: int = Field(..., gt=0, description="ID da marca do veículo")


class VehicleModelUpdate(BaseModel):
    """Schema para atualização parcial de um modelo de veículo. Todos os campos opcionais."""

    name: str | None = Field(None, min_length=1, max_length=100)
    is_active: bool | None = None


class VehicleModelResponse(BaseModel):
    """Schema de resposta para modelo de veículo."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    brand_id: int
    brand: BrandResponse | None = None
    name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime | None = None


class VehicleModelListResponse(BaseModel):
    """Schema de resposta para lista paginada de modelos de veículo."""

    items: list[VehicleModelResponse]
    pagination: PaginationMeta
