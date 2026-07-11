"""
Inventory schemas - Pydantic models for film type and roll management.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.schemas import PaginationMeta
from app.core.validators import normalize_tonality

# ---------------------------------------------------------------------------
# Film Type
# ---------------------------------------------------------------------------


class FilmTypeCreate(BaseModel):
    """Schema para criar um tipo de película."""

    name: str = Field(..., min_length=1, max_length=100)
    department: Literal["film", "ppf", "security_film"] = "film"
    yellow_threshold_meters: float = Field(..., gt=0, description="Limiar amarelo em metros")
    red_threshold_meters: float = Field(..., gt=0, description="Limiar vermelho em metros")
    available_tonalities: list[str] = Field(
        default_factory=list, description="Tonalidades disponíveis para este tipo"
    )

    @field_validator("available_tonalities")
    @classmethod
    def normalize_tonalities(cls, v: list[str]) -> list[str]:
        return [t for t in (normalize_tonality(item) for item in v) if t is not None]


class FilmTypeUpdate(BaseModel):
    """Schema para atualizar um tipo de película (todos os campos opcionais)."""

    name: str | None = Field(None, min_length=1, max_length=100)
    department: Literal["film", "ppf", "security_film"] | None = None
    yellow_threshold_meters: float | None = Field(None, gt=0)
    red_threshold_meters: float | None = Field(None, gt=0)
    is_active: bool | None = None
    available_tonalities: list[str] | None = None

    @field_validator("available_tonalities")
    @classmethod
    def normalize_tonalities(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        return [t for t in (normalize_tonality(item) for item in v) if t is not None]


class FilmTypeServiceResponse(BaseModel):
    """Schema para resposta de associação FilmType ↔ Service."""

    model_config = ConfigDict(from_attributes=True)

    service_id: int
    service_name: str | None = None
    service_code: str | None = None
    meters_consumed: float


class FilmTypeResponse(BaseModel):
    """Schema para resposta de tipo de película."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    department: str
    yellow_threshold_meters: float
    red_threshold_meters: float
    is_active: bool
    available_tonalities: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime | None = None
    services: list[FilmTypeServiceResponse] = Field(default_factory=list)


class FilmTypeListResponse(BaseModel):
    """Schema para resposta paginada de tipos de película."""

    items: list[FilmTypeResponse]
    pagination: PaginationMeta


# ---------------------------------------------------------------------------
# Film Type Service Association
# ---------------------------------------------------------------------------


class FilmTypeServiceCreate(BaseModel):
    """Schema para vincular um serviço a um tipo de película."""

    service_id: int = Field(..., gt=0)
    meters_consumed: float = Field(..., gt=0, description="Metros consumidos por execução")


# ---------------------------------------------------------------------------
# Film Roll
# ---------------------------------------------------------------------------


class FilmRollCreate(BaseModel):
    """Schema para registrar uma nova bobina."""

    store_id: int = Field(..., gt=0)
    film_type_id: int = Field(..., gt=0)
    tonality: str | None = Field(None, max_length=20, description="Tonalidade (film) ou None (PPF)")
    supplier: str | None = Field(None, max_length=200, description="Fornecedor da bobina")
    nfe_number: str | None = Field(None, max_length=100, description="NFE ou número do pedido")
    cost: Decimal | None = None
    lot_number: str | None = Field(None, max_length=100)
    total_meters: float = Field(..., gt=0, description="Metragem total da bobina")
    receipt_date: date = Field(..., description="Data de recebimento")
    supplier_id: int | None = None

    @field_validator("tonality")
    @classmethod
    def normalize_tonality_value(cls, v: str | None) -> str | None:
        return normalize_tonality(v)


class FilmRollResponse(BaseModel):
    """Schema para resposta de bobina de película."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    store_id: int
    store_name: str | None = None
    film_type_id: int
    film_type_name: str | None = None
    tonality: str | None = None
    supplier: str | None = None
    supplier_id: int | None = None
    supplier_name: str | None = None
    nfe_number: str | None = None
    cost: Decimal | None = None
    lot_number: str | None = None
    total_meters: float
    remaining_meters: float
    receipt_date: date
    status: str
    visual_id: str = ""
    color: str = "blue"
    created_at: datetime
    updated_at: datetime | None = None


class FilmRollListResponse(BaseModel):
    """Schema para resposta paginada de bobinas."""

    items: list[FilmRollResponse]
    pagination: PaginationMeta


# ---------------------------------------------------------------------------
# Film Consumption
# ---------------------------------------------------------------------------


class FilmConsumptionResponse(BaseModel):
    """Schema para resposta de registro de consumo."""

    id: int
    film_roll_id: int
    service_order_item_id: int | None = None
    meters_consumed: float
    vehicle_model: str | None = None
    plate: str | None = None
    created_at: datetime


class FilmRollTransfer(BaseModel):
    """Schema para transferência de bobina entre lojas."""

    target_store_id: int = Field(..., gt=0, description="ID da loja de destino")


# ---------------------------------------------------------------------------
# Film Type Forecast (HML-90)
# ---------------------------------------------------------------------------


class FilmTypeForecastItem(BaseModel):
    """Um item de O.S. ou agendamento que consumirá película deste tipo."""

    service_order_id: int | None = None
    appointment_id: int | None = None
    vehicle_model: str | None = None
    vehicle_plate: str | None = None
    service_name: str | None = None
    meters_consumed: float
    tonality: str | None = None  # Tonalidade da O.S. (G05, G20, etc.)


class TonalityForecastDetail(BaseModel):
    """Detalhes de previsão de consumo por tonalidade (HML-155)."""

    tonality: str | None  # None = sem tonalidade (ex: PPF)
    available_meters: float
    consumed_meters: float
    balance_meters: float  # available - consumed (negativo = déficit)
    scheduled_orders_count: int
    usage_percentage: float  # consumed / available * 100 (0 se sem estoque)
    status: Literal["critical", "attention", "ok"]
    items: list[FilmTypeForecastItem]


class FilmTypeForecastResponse(BaseModel):
    """Previsão de consumo de um tipo de película em uma loja."""

    film_type_id: int
    store_id: int
    items: list[FilmTypeForecastItem]
    total_scheduled_meters: float
    available_meters: float
    will_exhaust: bool
    # Campos adicionados em HML-155
    film_type_name: str
    tonalities: list[TonalityForecastDetail]
    tonalities_analyzed: int
    tonalities_attention_count: int
    tonalities_critical_count: int
    # Itens sem tonalidade definida no estoque (dados incompletos)
    unattributed_items: list[FilmTypeForecastItem] = []
    unattributed_meters: float = 0.0
