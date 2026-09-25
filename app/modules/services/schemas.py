"""
Service schemas - Pydantic models for service data validation.
"""

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.core.schemas import PaginationMeta
from app.modules.brands.schemas import BrandResponse
from app.modules.services.enums import ServiceCategory, ServiceDepartment


class ServiceBase(BaseModel):
    """Base schema with common service attributes."""

    name: str = Field(..., min_length=2, max_length=200)
    department: ServiceDepartment
    description: str | None = None
    category: ServiceCategory | None = None
    execution_time_minutes: int | None = Field(None, ge=1)
    base_price: Decimal = Field(..., ge=0, decimal_places=2)
    points: Decimal = Field(default=0, ge=0, decimal_places=2, description="Pontuação do serviço")
    brand_id: int = Field(..., gt=0, description="ID da marca à qual o serviço pertence")
    code: str | None = Field(None, max_length=50, description="Código original da planilha")
    has_variable_price: bool = False
    is_courtesy_only: bool = False


class ServiceCreate(ServiceBase):
    """Schema for creating a new service."""

    pass


class ServiceUpdate(BaseModel):
    """Schema for updating a service. All fields optional."""

    name: str | None = Field(None, min_length=2, max_length=200)
    department: ServiceDepartment | None = None
    description: str | None = None
    category: ServiceCategory | None = None
    execution_time_minutes: int | None = Field(None, ge=1)
    base_price: Decimal | None = Field(None, ge=0, decimal_places=2)
    points: Decimal | None = Field(None, ge=0, decimal_places=2)
    is_active: bool | None = None
    brand_id: int | None = Field(None, gt=0)
    code: str | None = Field(None, max_length=50)
    has_variable_price: bool | None = None
    is_courtesy_only: bool | None = None


class ServiceResponse(BaseModel):
    """Schema for service response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    department: str
    description: str | None = None
    category: str | None = None  # str, não enum — o DB pode ter valores além dos 4 do enum
    execution_time_minutes: int | None = None
    base_price: Decimal
    points: Decimal
    is_active: bool
    has_variable_price: bool
    is_courtesy_only: bool = False
    brand_id: int
    brand: BrandResponse | None = None
    code: str | None = None
    created_at: datetime
    updated_at: datetime | None = None
    # Preenchido apenas na resposta do update quando is_courtesy_only propaga
    # para linhas irmãs (mesmo nome/departamento em outras marcas). Número de
    # serviços irmãos afetados pela propagação; None nas demais operações.
    courtesy_propagated_count: int | None = None


class ServiceListResponse(BaseModel):
    """Schema for paginated service list response."""

    items: list[ServiceResponse]
    pagination: PaginationMeta
