"""
Service Order schemas - Pydantic models for service order data validation.
"""

from datetime import UTC, date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.schemas import FilmApplicationItem, PaginationMeta
from app.core.validators import (
    normalize_tonality,
    sanitize_text,
    validate_photo_list,
    validate_vehicle_plate,
)
from app.modules.service_orders.enums import OSStatus
from app.modules.services.enums import ServiceDepartment


def _normalize_execution_notes(v: object) -> object:
    """Normaliza o relato técnico do instalador: strip + vazio vira None.

    Semântica no request: OMITIR o campo preserva o relato existente; enviar
    string vazia/só espaços (ou null) LIMPA explicitamente (vira None).
    Tipo não-string segue adiante para o Pydantic devolver 422.
    """
    if not isinstance(v, str):
        return v
    stripped = v.strip()
    if not stripped:
        return None
    return sanitize_text(stripped)


class DamagePoint(BaseModel):
    """Ponto de avaria no mapa do veículo."""

    x: float = Field(..., ge=0, le=100, description="Posição X (0-100%)")
    y: float = Field(..., ge=0, le=100, description="Posição Y (0-100%)")
    type: str = Field(..., max_length=50, description="Tipo de avaria")
    description: str | None = Field(None, max_length=500)

    @field_validator("type", "description", mode="before")
    @classmethod
    def sanitize(cls, v: str | None) -> str | None:
        if v is not None:
            return sanitize_text(v)
        return v


class ServiceOrderItemCreate(BaseModel):
    """Schema para criar um item de O.S."""

    service_id: int = Field(..., gt=0)
    quantity: int = Field(default=1, ge=1)
    tonality: str | None = Field(None, max_length=20)
    roll_code: str | None = Field(None, max_length=100)
    film_roll_id: int | None = Field(None, gt=0, description="ID da bobina de película vinculada")
    film_type_id: int | None = Field(None, description="ID do tipo/marca de película (PPF)")
    film_applications: list[FilmApplicationItem] | None = Field(
        None, description="Tonalidades por região do carro (None = tonalidade única)"
    )
    used_scrap: bool = Field(
        default=False,
        description="Serviço feito com retalho (sobra) — não desconta metros da bobina",
    )
    scrap_source_roll_id: int | None = Field(
        None, description="Bobina de onde saiu o retalho (opcional, pode estar esgotada)"
    )
    notes: str | None = Field(None, max_length=1000)
    unit_price: Decimal | None = Field(
        None,
        ge=0,
        decimal_places=2,
        description="Preço unitário (obrigatório para serviços com valor variável)",
    )

    @field_validator("tonality")
    @classmethod
    def normalize_tonality_value(cls, v: str | None) -> str | None:
        return normalize_tonality(v)

    @model_validator(mode="after")
    def scrap_has_no_consumed_roll(self) -> "ServiceOrderItemCreate":
        # Retalho não consome bobina — a bobina de origem vai em
        # scrap_source_roll_id, nunca em film_roll_id (evita item debitado e
        # rotulado "Retalho" ao mesmo tempo).
        if self.used_scrap and self.film_roll_id is not None:
            raise ValueError(
                "Serviço feito com retalho não leva bobina de consumo — "
                "use scrap_source_roll_id para a bobina de origem"
            )
        return self


class ServiceOrderItemResponse(BaseModel):
    """Schema para resposta de item de O.S."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    service_id: int
    service_name: str | None = None
    service_code: str | None = None
    service_department: str | None = None
    quantity: int
    unit_price: float
    tonality: str | None = None
    roll_code: str | None = None
    film_roll_id: int | None = None
    film_type_id: int | None = None
    # Serviço feito com retalho (sobra já debitada da bobina em corte anterior):
    # não desconta metros. `scrap_source_roll_id` é a bobina de origem, opcional.
    used_scrap: bool = False
    scrap_source_roll_id: int | None = None
    # Tonalidades por região: [{tonality, region, film_roll_id, roll_code,
    # used_scrap, scrap_source_roll_id}]
    film_applications: list[dict] | None = None
    notes: str | None = None
    # Metros de película consumidos por este item (soma líquida do extrato de
    # FilmConsumption). Só populado no DETALHE da O.S. (evita N+1 na listagem);
    # None = não calculado (listagem) ou item sem consumo de bobina.
    linear_meters: float | None = None
    created_at: datetime


class ServiceOrderWorkerCreate(BaseModel):
    """Schema para designar funcionário para O.S."""

    employee_id: int = Field(..., gt=0)


class ServiceOrderWorkerResponse(BaseModel):
    """Schema para resposta de funcionário na O.S."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    employee_name: str | None = None
    # Vínculo opcional com o item específico (instalador por serviço); None =
    # funcionário da O.S. inteira.
    service_order_item_id: int | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    hours_worked: float | None = None


class CancelServiceOrderRequest(BaseModel):
    """Schema para cancelar uma O.S."""

    reason: str | None = Field(None, max_length=500, description="Motivo do cancelamento")


class ServiceOrderCreate(BaseModel):
    """Schema para criar uma nova O.S."""

    # Relacionamentos
    store_id: int = Field(..., gt=0)
    dealership_id: int | None = Field(None, gt=0)
    consultant_id: int | None = Field(None, gt=0)
    is_galpon: bool = False
    is_return: bool = False
    is_courtesy: bool = False
    original_service_order_id: int | None = Field(
        None, gt=0, description="ID da O.S. de origem (preenchido quando is_return=True)"
    )

    # Dados do veículo
    vehicle_plate: str = Field(..., min_length=7, max_length=8)
    vehicle_brand: str | None = Field(None, max_length=100)
    vehicle_model: str | None = Field(None, max_length=100)
    vehicle_model_id: int | None = Field(
        None, gt=0, description="ID do modelo no catálogo (opcional)"
    )
    vehicle_color: str | None = Field(None, max_length=50)
    vehicle_year: int | None = Field(None, ge=1900, le=2100)

    # Departamento
    department: ServiceDepartment

    # Tempo de entrada (definido pelo servidor se não fornecido)
    entry_time: datetime = Field(default_factory=lambda: datetime.now(UTC))

    # Data de conferência
    service_date: date | None = None

    # Mapa de avarias e fotos
    damage_map: list[DamagePoint] | None = None
    photos: list[str] = Field(default_factory=list, description="Fotos do veículo")
    damage_photos: list[str] = Field(default_factory=list, description="Fotos de avaria do veículo")
    video_url: str | None = Field(
        None, max_length=1000, description="URL do vídeo da vistoria (opcional)"
    )

    # Observações
    notes: str | None = Field(None, max_length=5000)

    @field_validator("photos")
    @classmethod
    def sanitize_photos(cls, v: list[str]) -> list[str]:
        return validate_photo_list(v)

    @field_validator("damage_photos")
    @classmethod
    def sanitize_damage_photos(cls, v: list[str]) -> list[str]:
        return validate_photo_list(v)

    @field_validator("notes", mode="before")
    @classmethod
    def sanitize_notes(cls, v: str | None) -> str | None:
        if v is not None:
            return sanitize_text(v)
        return v

    # Número de OS do sistema externo da concessionária
    external_os_number: str | None = Field(
        None, max_length=100, description="Número de OS do sistema externo da concessionária"
    )

    # Itens da O.S.
    items: list[ServiceOrderItemCreate] = Field(..., min_length=1)

    # Funcionários designados
    workers: list[ServiceOrderWorkerCreate] = Field(default_factory=list)

    # Lançamento direto já finalizado: quando True (e não for duplicidade), a O.S.
    # nasce como 'completed' com completion_time. Usado pelo lançamento direto de
    # película no QuickCreate, onde instalador e bobina já são informados na criação
    # (a bobina já é consumida na criação) — sem isso a O.S. ficava presa em 'waiting'
    # e não entrava no Desempenho/Fechamento.
    finalize_on_create: bool = Field(
        default=False,
        description="Cria a O.S. já finalizada (completed). Requer ao menos 1 instalador.",
    )

    @field_validator("vehicle_plate")
    @classmethod
    def validate_plate(cls, v: str) -> str:
        """Valida formato de placa brasileira ou chassi do vidro."""
        return validate_vehicle_plate(v)


class ServiceOrderUpdate(BaseModel):
    """Schema para atualizar uma O.S."""

    department: ServiceDepartment | None = None
    store_id: int | None = Field(None, gt=0, description="Loja do lançamento (permite corrigir)")
    consultant_id: int | None = Field(None, gt=0)
    is_galpon: bool | None = None
    is_return: bool | None = None
    is_courtesy: bool | None = None
    original_service_order_id: int | None = Field(
        None, gt=0, description="ID da O.S. de origem (preenchido quando is_return=True)"
    )
    vehicle_plate: str | None = Field(None, min_length=7, max_length=8)
    vehicle_brand: str | None = Field(None, max_length=100)
    vehicle_model: str | None = Field(None, max_length=100)
    vehicle_model_id: int | None = Field(None, description="ID do modelo no catálogo (opcional)")
    vehicle_color: str | None = Field(None, max_length=50)
    vehicle_year: int | None = Field(None, ge=1900, le=2100)
    damage_map: list[DamagePoint] | None = None
    photos: list[str] | None = None
    damage_photos: list[str] | None = None
    video_url: str | None = Field(None, max_length=1000)
    external_os_number: str | None = Field(None, max_length=100)
    notes: str | None = Field(
        None, max_length=5000, description="Briefing do consultor, copiado do agendamento"
    )
    internal_notes: str | None = Field(None, max_length=5000)
    execution_notes: str | None = Field(
        None, max_length=2000, description="Relato técnico do instalador"
    )
    invoice_number: str | None = Field(None, max_length=100)
    service_date: date | None = None
    is_verified: bool | None = None
    workers: list["ServiceOrderWorkerCreate"] | None = Field(
        None,
        description="Funcionários designados (substitui os atuais se fornecido)",
    )
    items: list[ServiceOrderItemCreate] | None = Field(
        None,
        min_length=1,
        description="Itens da O.S. (substitui os atuais se fornecido)",
    )

    @field_validator("vehicle_plate", mode="before")
    @classmethod
    def validate_plate(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return validate_vehicle_plate(v)

    @field_validator("photos", mode="before")
    @classmethod
    def sanitize_photos(cls, v: list[str] | None) -> list[str] | None:
        if v is not None:
            return validate_photo_list(v)
        return v

    @field_validator("damage_photos", mode="before")
    @classmethod
    def sanitize_damage_photos(cls, v: list[str] | None) -> list[str] | None:
        if v is not None:
            return validate_photo_list(v)
        return v

    @field_validator("notes", "internal_notes", mode="before")
    @classmethod
    def sanitize_text_fields(cls, v: str | None) -> str | None:
        if v is not None:
            return sanitize_text(v)
        return v

    @field_validator("execution_notes", mode="before")
    @classmethod
    def normalize_execution_notes(cls, v: object) -> object:
        return _normalize_execution_notes(v)


class StatusUpdateRequest(BaseModel):
    """Schema para mudar status de O.S."""

    new_status: OSStatus
    notes: str | None = Field(None, max_length=1000)
    invoice_number: str | None = Field(None, max_length=100)


class VerifyRequest(BaseModel):
    """Schema para marcar/desmarcar a verificação (conferência) de uma O.S."""

    verified: bool


class FinalizeOrderItemUpdate(BaseModel):
    """Atribuição de bobina a um item de O.S. no momento do Finalizar.

    Itens com tonalidades por região (film_applications) recebem UMA entrada por
    tonalidade — `tonality` identifica qual aplicação a bobina atende. Itens de
    tonalidade única seguem sem `tonality` (shape legado, mobile em produção).
    """

    service_id: int
    # Opcional desde o retalho: serviço feito com sobra não tem bobina consumida.
    film_roll_id: int | None = Field(None, gt=0)
    tonality: str | None = Field(None, max_length=20)
    used_scrap: bool = False
    scrap_source_roll_id: int | None = None

    @field_validator("tonality")
    @classmethod
    def normalize_tonality_value(cls, v: str | None) -> str | None:
        return normalize_tonality(v)

    @model_validator(mode="after")
    def require_roll_or_scrap(self) -> "FinalizeOrderItemUpdate":
        if self.film_roll_id is None and not self.used_scrap:
            raise ValueError("Informe a bobina ou marque o serviço como feito com retalho")
        # Retalho não consome bobina: aceitar os dois juntos produziria um item ao
        # mesmo tempo debitado e rotulado "Retalho" (a bobina de origem vai em
        # scrap_source_roll_id, nunca em film_roll_id).
        if self.used_scrap and self.film_roll_id is not None:
            raise ValueError(
                "Serviço feito com retalho não leva bobina de consumo — "
                "use scrap_source_roll_id para a bobina de origem"
            )
        return self


class FinalizeOrderEmployeeAssignment(BaseModel):
    """Instaladores designados para um serviço específico no momento do Finalizar.

    Aceita o shape legado (employee_id único — clientes mobile em produção) e o
    novo (employee_ids). Após a validação, employee_ids é sempre a lista efetiva.
    """

    service_id: int
    employee_id: int | None = None
    employee_ids: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def merge_employee_ids(self) -> "FinalizeOrderEmployeeAssignment":
        ids = list(self.employee_ids)
        if not ids and self.employee_id is not None:
            ids = [self.employee_id]
        ids = list(dict.fromkeys(ids))
        if not ids:
            raise ValueError("Informe ao menos um instalador para o serviço")
        self.employee_ids = ids
        return self


class FinalizeOrderRequest(BaseModel):
    """Dados fornecidos ao finalizar uma O.S. via agendamento."""

    completion_photos: list[str] = Field(
        default_factory=list, description="URLs das fotos da chancela"
    )
    film_roll_assignments: list[FinalizeOrderItemUpdate] = Field(default_factory=list)
    # Legado: funcionários da O.S. inteira (clientes antigos e demais departamentos)
    employee_ids: list[int] = Field(default_factory=list)
    # Instalador por serviço (Película/Pel. Segurança/PPF)
    employee_assignments: list[FinalizeOrderEmployeeAssignment] = Field(default_factory=list)
    execution_notes: str | None = Field(
        None, max_length=2000, description="Relato técnico do instalador"
    )

    @field_validator("execution_notes", mode="before")
    @classmethod
    def normalize_execution_notes(cls, v: object) -> object:
        return _normalize_execution_notes(v)


class ServiceOrderResponse(BaseModel):
    """Schema para resposta de O.S."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    order_number: str | None = None
    external_os_number: str | None = None
    items: list[ServiceOrderItemResponse] = []
    # Instaladores vinculados — incluído também na listagem (coluna Instalador da Conferência).
    workers: list[ServiceOrderWorkerResponse] = []
    store_id: int
    store_name: str | None = None
    dealership_id: int | None = None
    consultant_id: int | None = None
    consultant_name: str | None = None
    is_galpon: bool = False
    is_return: bool = False
    is_courtesy: bool = False
    original_service_order_id: int | None = None
    vehicle_plate: str
    vehicle_brand: str | None = None
    vehicle_model: str | None = None
    vehicle_model_id: int | None = None
    vehicle_color: str | None = None
    vehicle_year: int | None = None
    department: str
    status: str
    entry_time: datetime
    start_time: datetime | None = None
    completion_time: datetime | None = None
    damage_map: str | None = None
    photos: str | None = None
    damage_photos: str | None = None
    completion_photos: str | None = None
    video_url: str | None = None
    notes: str | None = Field(None, description="Briefing do consultor, copiado do agendamento")
    internal_notes: str | None = None
    execution_notes: str | None = Field(
        None, description="Relato técnico do instalador (preenchido na finalização)"
    )
    requires_invoice: bool
    invoice_number: str | None = None
    service_date: date | None = None
    is_verified: bool = False
    verified_at: datetime | None = None
    created_by_id: int | None = None
    created_at: datetime
    updated_at: datetime | None = None
    updated_by_id: int | None = None
    # Nome do último usuário que atualizou (preenchido a partir do relacionamento updated_by)
    updated_by_name: str | None = None


class DuplicateOrderMatch(BaseModel):
    """Resumo de uma O.S. coincidente no alerta de duplicidade."""

    id: int
    order_number: str | None = None
    vehicle_plate: str
    department: str
    service_date: str | None = None
    matched_services: list[str] = []


class DuplicateAppointmentMatch(BaseModel):
    """Resumo de um agendamento coincidente no alerta de duplicidade."""

    id: int
    vehicle_plate: str
    department: str
    delivery_date: str
    service_order_id: int | None = None
    matched_services: list[str] = []


class DuplicateCheckResponse(BaseModel):
    """Resposta da checagem de duplicidade no lançamento."""

    service_orders: list[DuplicateOrderMatch] = []
    appointments: list[DuplicateAppointmentMatch] = []


class ServiceOrderDetailResponse(ServiceOrderResponse):
    """Schema para resposta detalhada de O.S. (com itens e workers)."""

    workers: list[ServiceOrderWorkerResponse] = []


class ServiceOrderListResponse(BaseModel):
    """Schema para lista paginada de O.S."""

    items: list[ServiceOrderResponse]
    pagination: PaginationMeta


class StatusHistoryResponse(BaseModel):
    """Schema para item do histórico de status de uma OS."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    from_status: str | None
    to_status: str
    changed_by_name: str | None
    changed_at: datetime
    notes: str | None

    @classmethod
    def from_orm_with_user(cls, obj) -> "StatusHistoryResponse":
        return cls(
            id=obj.id,
            from_status=obj.from_status,
            to_status=obj.to_status,
            changed_by_name=obj.changed_by.full_name if obj.changed_by else None,
            changed_at=obj.changed_at,
            notes=obj.notes,
        )


class OSHistoryResponse(BaseModel):
    """Histórico completo de status de uma OS."""

    items: list[StatusHistoryResponse]


class VehicleHistoryItemResponse(BaseModel):
    """Item de histórico de um veículo (OS resumida)."""

    id: int
    order_number: str
    service_date: date | None
    entry_time: datetime
    department: str
    status: str
    store_name: str | None
    service_names: list[str]


class VehicleHistoryResponse(BaseModel):
    """Histórico de OSs de um veículo."""

    plate: str
    items: list[VehicleHistoryItemResponse]
