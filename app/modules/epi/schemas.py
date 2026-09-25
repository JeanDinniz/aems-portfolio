"""Schemas Pydantic do módulo de EPI."""

from datetime import date as date_type
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.schemas import PaginationMeta


# --------------------------------------------------------------------------
# Catálogo de EPIs
# --------------------------------------------------------------------------
class EPICreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    dias_validade: int = Field(..., gt=0, le=3650)
    is_active: bool = True


class EPIUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=200)
    dias_validade: int | None = Field(None, gt=0, le=3650)
    is_active: bool | None = None


class EPIResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    dias_validade: int
    is_active: bool
    created_at: datetime
    updated_at: datetime | None = None


class EPIListResponse(BaseModel):
    items: list[EPIResponse]
    pagination: PaginationMeta


# --------------------------------------------------------------------------
# Mapeamento cargo -> EPI
# --------------------------------------------------------------------------
class CargoEPICreate(BaseModel):
    cargo: str = Field(..., min_length=2, max_length=100)
    epi_id: int


class CargoEPIResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    cargo: str
    epi_id: int
    epi_name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime | None = None


class CargoEPIListResponse(BaseModel):
    items: list[CargoEPIResponse]
    pagination: PaginationMeta


# --------------------------------------------------------------------------
# Entrega de EPI (ficha)
# --------------------------------------------------------------------------
class EntregaEPICreate(BaseModel):
    employee_id: int
    epi_id: int
    assinatura_base64: str = Field(..., min_length=1)
    data_entrega: date_type | None = None  # default = hoje no service
    observacao: str | None = None

    @field_validator("assinatura_base64")
    @classmethod
    def _valida_assinatura(cls, v: str) -> str:
        if not v.startswith("data:image/"):
            raise ValueError("Assinatura inválida: esperado data URL de imagem")
        return v


class EntregaEPIResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    employee_name: str
    epi_id: int
    epi_name: str
    data_entrega: date_type
    data_vencimento: date_type
    status: str
    delivered_by_id: int | None = None
    observacao: str | None = None
    assinatura_base64: str
    created_at: datetime


class EntregaEPIListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    employee_name: str
    epi_id: int
    epi_name: str
    data_entrega: date_type
    data_vencimento: date_type
    status: str
    delivered_by_id: int | None = None
    observacao: str | None = None
    created_at: datetime


class EntregaEPIListResponse(BaseModel):
    items: list[EntregaEPIListItem]
    pagination: PaginationMeta


# --------------------------------------------------------------------------
# Relatório de pendências
# --------------------------------------------------------------------------
class PendenciaItem(BaseModel):
    employee_id: int
    employee_name: str
    store_id: int
    store_name: str | None = None
    cargo: str
    epi_id: int
    epi_name: str
    dias_validade: int
    estado: str  # PendenciaEstado
    ultima_entrega_id: int | None = None
    data_entrega: date_type | None = None
    data_vencimento: date_type | None = None
    dias_restantes: int | None = None


class PendenciaListResponse(BaseModel):
    items: list[PendenciaItem]
    total: int
