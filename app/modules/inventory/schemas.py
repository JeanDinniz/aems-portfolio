"""
Inventory schemas - Pydantic models for film type and roll management.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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

    @model_validator(mode="after")
    def validate_threshold_order(self) -> "FilmTypeCreate":
        """Limiar vermelho deve ser estritamente menor que o limiar amarelo."""
        if self.red_threshold_meters >= self.yellow_threshold_meters:
            raise ValueError(
                "O limiar vermelho (red_threshold_meters) deve ser menor que o limiar "
                f"amarelo (yellow_threshold_meters). Recebido: red={self.red_threshold_meters}, "
                f"yellow={self.yellow_threshold_meters}."
            )
        return self


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

    @model_validator(mode="after")
    def validate_threshold_order_when_both_present(self) -> "FilmTypeUpdate":
        """
        Valida red < yellow quando ambos os limiares são enviados no mesmo payload.

        Quando apenas um dos campos é enviado, a validação do estado final (merged)
        é responsabilidade de update_film_type no service layer.
        """
        yellow = self.yellow_threshold_meters
        red = self.red_threshold_meters
        if yellow is not None and red is not None and red >= yellow:
            raise ValueError(
                "O limiar vermelho (red_threshold_meters) deve ser menor que o limiar "
                f"amarelo (yellow_threshold_meters). Recebido: red={red}, yellow={yellow}."
            )
        return self


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


class FilmRollUpdate(BaseModel):
    """Edição dos dados de uma bobina. Todos os campos opcionais.

    O saldo (remaining_meters) NÃO é editado aqui — é derivado do extrato. Alterar
    ``total_meters`` recalcula o saldo preservando o já consumido. Para corrigir o
    saldo físico use o ajuste (conferência de estoque).
    """

    film_type_id: int | None = Field(None, gt=0)
    tonality: str | None = Field(None, max_length=20)
    supplier: str | None = Field(None, max_length=200)
    nfe_number: str | None = Field(None, max_length=100)
    cost: Decimal | None = None
    lot_number: str | None = Field(None, max_length=100)
    total_meters: float | None = Field(None, gt=0)
    receipt_date: date | None = None
    supplier_id: int | None = None
    # Permite limpar campos opcionais explicitamente (enviar null não basta pois
    # None também é "não informado"). Marca quais campos zerar.
    clear_supplier: bool = False
    clear_nfe: bool = False
    clear_cost: bool = False
    clear_lot: bool = False

    @field_validator("tonality")
    @classmethod
    def normalize_tonality_value(cls, v: str | None) -> str | None:
        return normalize_tonality(v)


class AdjustMetersRequest(BaseModel):
    """Ajuste manual dos metros restantes de uma bobina (conferência de estoque)."""

    remaining_meters: float = Field(..., ge=0, description="Metros restantes reais medidos")
    note: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="Motivo do ajuste (obrigatório — por que o saldo foi corrigido)",
    )


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
    film_withdrawal_id: int | None = None
    meters_consumed: float
    kind: str | None = None
    adjustment_reason: str | None = None
    vehicle_model: str | None = None
    plate: str | None = None
    withdrawal_employee_name: str | None = None
    created_at: datetime


class FilmRollTransfer(BaseModel):
    """Schema para transferência de bobina entre lojas."""

    target_store_id: int = Field(..., gt=0, description="ID da loja de destino")


# ---------------------------------------------------------------------------
# Film Withdrawal (saída avulsa)
# ---------------------------------------------------------------------------


class FilmWithdrawalCreate(BaseModel):
    """Schema para registrar uma saída avulsa de película."""

    film_roll_id: int = Field(..., gt=0)
    employee_id: int = Field(..., gt=0, description="Funcionário que pediu a película")
    meters: float = Field(..., gt=0, description="Metros retirados da bobina")
    reason: str | None = Field(None, max_length=500, description="Motivo da saída")


class FilmWithdrawalResponse(BaseModel):
    """Schema para resposta de saída avulsa."""

    id: int
    film_roll_id: int
    roll_visual_id: str = ""
    roll_receipt_date: date | None = None
    roll_total_meters: float | None = None
    film_type_name: str | None = None
    tonality: str | None = None
    store_id: int
    store_name: str | None = None
    employee_id: int
    employee_name: str | None = None
    meters: float
    reason: str | None = None
    created_by_name: str | None = None
    created_at: datetime
    reversed_at: datetime | None = None
    reversed_by_name: str | None = None
    is_reversed: bool = False


class FilmWithdrawalListResponse(BaseModel):
    """Schema para resposta paginada de saídas avulsas."""

    items: list[FilmWithdrawalResponse]
    pagination: PaginationMeta


class FilmWithdrawalSummaryItem(BaseModel):
    """Total de saídas por funcionário no período (para desconto em folha)."""

    employee_id: int
    employee_name: str
    withdrawal_count: int
    total_meters: float


class FilmWithdrawalSummaryResponse(BaseModel):
    """Resumo de saídas avulsas por funcionário (exclui estornadas)."""

    items: list[FilmWithdrawalSummaryItem]
    total_meters: float


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


class RollServiceOrderRow(BaseModel):
    """Um carro (O.S.) atendido por uma bobina — drill-down do Rendimento."""

    service_order_id: int
    vehicle_plate: str | None = None
    service_date: date | None = None
    service_code: str | None = None
    service_name: str | None = None
    installers: list[str] = []
    meters_consumed: float | None = None


class RollServiceOrdersResponse(BaseModel):
    """Bobina + os carros que ela atendeu."""

    film_roll_id: int
    film_type_name: str | None = None
    tonality: str | None = None
    receipt_date: date | None = None
    rows: list[RollServiceOrderRow] = []
