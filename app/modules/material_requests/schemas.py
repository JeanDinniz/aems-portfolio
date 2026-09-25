"""Schemas Pydantic do módulo de Pedidos de Material."""

from datetime import date as date_type
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.schemas import PaginationMeta
from app.core.validators import normalize_tonality


# ---------------------------------------------------------------------------
# Linhas de criação
# ---------------------------------------------------------------------------
class MaterialRequestFilmLineCreate(BaseModel):
    """Uma película do pedido — vira uma bobina (FilmRoll) no Estoque.

    Espelha os campos de FilmRollCreate, exceto store_id/receipt_date, que vêm
    do próprio pedido.
    """

    film_type_id: int = Field(..., gt=0)
    tonality: str | None = Field(None, max_length=20)
    total_meters: float = Field(..., gt=0, description="Metragem total da bobina")
    supplier: str | None = Field(None, max_length=200)
    nfe_number: str | None = Field(None, max_length=100)
    cost: Decimal | None = None
    lot_number: str | None = Field(None, max_length=100)
    supplier_id: int | None = Field(None, gt=0)
    receipt_date: date_type | None = None

    @field_validator("tonality")
    @classmethod
    def _normalize_tonality(cls, v: str | None) -> str | None:
        return normalize_tonality(v)


class MaterialRequestFilmLineUpdate(MaterialRequestFilmLineCreate):
    """Linha de película numa EDIÇÃO de pedido.

    ``film_roll_id`` presente → edita a bobina existente (metros/tipo só mudam
    se a bobina não tiver consumo); ausente → cria uma bobina nova, como no
    create. Bobinas existentes que não vierem no payload são removidas do
    pedido (bloqueado se já tiverem consumo).
    """

    film_roll_id: int | None = Field(None, gt=0)


class MaterialRequestToolCreate(BaseModel):
    """Uma ferramenta/insumo do pedido (texto livre).

    ``nfe_number``/``cost`` são obrigatórios aqui (validação Pydantic) mesmo
    sendo nullable no banco — há ferramentas antigas lançadas sem esses
    valores, mas pedidos novos devem sempre informá-los.
    """

    name: str = Field(..., min_length=1, max_length=200)
    quantity: int = Field(..., gt=0)
    notes: str | None = Field(None, max_length=500)
    # Funcionário destinatário (opcional). Preenchido → gera card de recebimento.
    employee_id: int | None = Field(None, gt=0)
    nfe_number: str = Field(..., min_length=1, max_length=100)
    cost: Decimal = Field(..., gt=0)


class MaterialRequestCreate(BaseModel):
    store_id: int = Field(..., gt=0)
    request_date: date_type
    notes: str | None = Field(None, max_length=1000)
    is_galpon: bool = False
    film_lines: list[MaterialRequestFilmLineCreate] = Field(default_factory=list)
    tool_lines: list[MaterialRequestToolCreate] = Field(default_factory=list)

    @field_validator("tool_lines")
    @classmethod
    def _at_least_one_line(
        cls, v: list[MaterialRequestToolCreate], info
    ) -> list[MaterialRequestToolCreate]:
        film_lines = info.data.get("film_lines") or []
        if not v and not film_lines:
            raise ValueError("Informe ao menos uma película ou ferramenta no pedido")
        return v


class MaterialRequestUpdate(BaseModel):
    """Edição do pedido lançado (reconcílio completo).

    - ``film_lines`` preenchido → reconcilia as bobinas do pedido: linha com
      ``film_roll_id`` edita a bobina existente, sem id cria uma nova, e bobinas
      existentes ausentes do payload são removidas. Metros/tipo só mudam (e a
      remoção só ocorre) se a bobina não tiver consumo — senão a edição é
      bloqueada (409), como no cancelamento.
    - ``tool_lines`` preenchido → substitui todas as ferramentas do pedido.
    - Campo ``None`` = não mexe naquela dimensão (patch parcial).
    """

    request_date: date_type | None = None
    notes: str | None = Field(None, max_length=1000)
    is_galpon: bool | None = None
    film_lines: list[MaterialRequestFilmLineUpdate] | None = None
    tool_lines: list[MaterialRequestToolCreate] | None = None


# ---------------------------------------------------------------------------
# Respostas
# ---------------------------------------------------------------------------
class MaterialRequestFilmItem(BaseModel):
    """Projeção de uma bobina vinculada ao pedido."""

    model_config = ConfigDict(from_attributes=True)

    film_roll_id: int
    film_type_id: int
    film_type_name: str
    tonality: str | None = None
    total_meters: float
    remaining_meters: float
    supplier: str | None = None
    supplier_id: int | None = None
    nfe_number: str | None = None
    cost: Decimal | None = None
    lot_number: str | None = None
    receipt_date: date_type | None = None
    status: str


class MaterialRequestToolItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    quantity: int
    notes: str | None = None
    employee_id: int | None = None
    employee_name: str | None = None
    cost: Decimal | None = None
    nfe_number: str | None = None


class MaterialPurchaseLineItem(BaseModel):
    """Linha de compra histórica (importada da planilha)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str  # film | tool
    material_name: str
    tonality: str | None = None
    quantity: Decimal | None = None
    supplier: str | None = None
    nfe_number: str | None = None
    cost: Decimal | None = None
    lot_number: str | None = None
    notes: str | None = None


class MaterialRequestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    store_id: int
    store_name: str | None = None
    request_date: date_type
    notes: str | None = None
    is_galpon: bool
    source: str = "app"
    status: str = "active"
    cancelled_at: datetime | None = None
    cancellation_reason: str | None = None
    created_by_user_id: int | None = None
    created_by_name: str | None = None
    edited_at: datetime | None = None
    edited_by_user_id: int | None = None
    edited_by_name: str | None = None
    film_items: list[MaterialRequestFilmItem] = Field(default_factory=list)
    tool_items: list[MaterialRequestToolItem] = Field(default_factory=list)
    purchase_lines: list[MaterialPurchaseLineItem] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime | None = None


class CancelMaterialRequest(BaseModel):
    """Motivo obrigatório ao cancelar um pedido de material."""

    cancellation_reason: str = Field(..., min_length=1, max_length=1000)


class MaterialRequestListResponse(BaseModel):
    items: list[MaterialRequestResponse]
    pagination: PaginationMeta


# ---------------------------------------------------------------------------
# Rendimento das bobinas (carros por bobina) — calculado das O.S.
# ---------------------------------------------------------------------------
class RollYieldEntry(BaseModel):
    """Uma bobina e quantos carros ela rendeu."""

    roll_id: int
    receipt_date: date_type
    total_meters: float
    remaining_meters: float
    status: str  # em_estoque | em_uso | esgotada
    cars: int
    last_consumption_at: datetime | None = None


class RollYieldGroup(BaseModel):
    """Grupo loja × tipo × tonalidade, com as bobinas recentes e médias."""

    store_id: int
    store_name: str | None = None
    film_type_id: int
    film_type_name: str
    tonality: str | None = None
    rolls: list[RollYieldEntry]
    roll_count: int
    total_cars: int
    avg_cars: float
    avg_cars_per_meter: float


class RollYieldResponse(BaseModel):
    items: list[RollYieldGroup]


# ---------------------------------------------------------------------------
# Cards de recebimento de ferramentas (Controle de EPIs)
# ---------------------------------------------------------------------------
class ToolCardItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    quantity: int
    notes: str | None = None
    photo_url: str | None = None


class ToolCard(BaseModel):
    """Um card = ferramentas de um pedido destinadas a um funcionário."""

    request_id: int
    request_date: date_type
    store_id: int
    store_name: str | None = None
    employee_id: int
    employee_name: str | None = None
    items: list[ToolCardItem]
    status: str  # pendente | recebido
    received_at: datetime | None = None
    signature_base64: str | None = None


class ToolCardListResponse(BaseModel):
    items: list[ToolCard]


class ToolReceiptItemPhoto(BaseModel):
    """Foto de um item específico do card, enviada na confirmação."""

    item_id: int = Field(..., gt=0)
    photo_url: str = Field(..., min_length=1)


class ToolReceiptConfirm(BaseModel):
    request_id: int = Field(..., gt=0)
    employee_id: int = Field(..., gt=0)
    signature_base64: str = Field(..., min_length=1)
    notes: str | None = Field(None, max_length=500)
    # 1 foto obrigatória por item do card (validado contra os itens reais em
    # confirm_tool_receipt, pois o schema não tem acesso ao card no banco).
    item_photos: list[ToolReceiptItemPhoto] = Field(..., min_length=1)

    @field_validator("signature_base64")
    @classmethod
    def _valida_assinatura(cls, v: str) -> str:
        if not v.startswith("data:image/"):
            raise ValueError("Assinatura inválida: esperado data URL de imagem")
        return v
