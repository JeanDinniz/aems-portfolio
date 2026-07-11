"""Scheduling schemas - Pydantic models for appointment validation."""

from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.schemas import PaginationMeta
from app.core.validators import normalize_tonality
from app.core.validators import validate_vehicle_plate as _validate_vehicle_plate
from app.modules.services.enums import ServiceDepartment

VALID_DEPARTMENTS = {d.value for d in ServiceDepartment}


class FilmEntryItem(BaseModel):
    """Uma entrada de película/PPF no agendamento."""

    service_id: int
    tonality: str | None = Field(None, max_length=20)
    film_roll_id: int | None = None
    film_type_id: int | None = None

    @field_validator("tonality")
    @classmethod
    def normalize_tonality_value(cls, v: str | None) -> str | None:
        return normalize_tonality(v)


class AppointmentCreate(BaseModel):
    """Schema para criação de um agendamento."""

    store_id: int
    department: str
    delivery_date: date
    delivery_time: time
    vehicle_plate: str = Field(..., min_length=7, max_length=8)
    external_os_number: str | None = Field(None, max_length=100)
    vehicle_model: str | None = Field(None, max_length=100)
    vehicle_color: str | None = Field(None, max_length=50)
    consultant_id: int | None = None
    service_ids: list[int] = Field(default_factory=list)
    film_entries: list[FilmEntryItem] | None = None
    notes: str | None = None
    is_galpon: bool = False
    is_courtesy: bool = False
    is_return: bool = False
    film_type_id: int | None = None
    film_tonality: str | None = Field(None, max_length=20)

    @field_validator("film_tonality")
    @classmethod
    def normalize_film_tonality(cls, v: str | None) -> str | None:
        return normalize_tonality(v)

    @field_validator("department")
    @classmethod
    def validate_department(cls, v: str) -> str:
        if v not in VALID_DEPARTMENTS:
            raise ValueError(
                f"Departamento inválido. Valores aceitos: {', '.join(sorted(VALID_DEPARTMENTS))}"
            )
        return v

    @field_validator("vehicle_plate")
    @classmethod
    def validate_plate(cls, v: str) -> str:
        return _validate_vehicle_plate(v)


class AppointmentUpdate(BaseModel):
    """Schema para atualização parcial de um agendamento."""

    store_id: int | None = None
    department: str | None = None
    delivery_date: date | None = None
    delivery_time: time | None = None
    vehicle_plate: str | None = Field(None, min_length=7, max_length=8)
    external_os_number: str | None = Field(None, max_length=100)
    vehicle_model: str | None = Field(None, max_length=100)
    vehicle_color: str | None = Field(None, max_length=50)
    consultant_id: int | None = None
    service_ids: list[int] | None = None
    film_entries: list[FilmEntryItem] | None = None
    notes: str | None = None
    is_galpon: bool | None = None
    is_courtesy: bool | None = None
    is_return: bool | None = None
    film_type_id: int | None = None
    film_tonality: str | None = Field(None, max_length=20)

    @field_validator("film_tonality")
    @classmethod
    def normalize_film_tonality(cls, v: str | None) -> str | None:
        return normalize_tonality(v)

    @field_validator("department")
    @classmethod
    def validate_department(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_DEPARTMENTS:
            raise ValueError(
                f"Departamento inválido. Valores aceitos: {', '.join(sorted(VALID_DEPARTMENTS))}"
            )
        return v

    @field_validator("vehicle_plate")
    @classmethod
    def validate_plate(cls, v: str | None) -> str | None:
        if v is not None:
            return _validate_vehicle_plate(v)
        return v


class AppointmentResponse(BaseModel):
    """Schema de resposta completo de um agendamento."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    store_id: int
    store_name: str | None
    department: str
    delivery_date: date
    delivery_time: time | None
    external_os_number: str | None
    vehicle_plate: str
    vehicle_model: str | None
    vehicle_color: str | None
    consultant_id: int | None
    consultant_name: str | None
    service_ids: list[int] | None
    service_names: list[str]
    notes: str | None
    is_galpon: bool
    is_courtesy: bool
    is_return: bool
    film_type_id: int | None
    film_tonality: str | None
    film_entries: list[dict] | None
    status: str
    display_status: str
    service_order_id: int | None
    service_order_number: str | None
    service_order_notes: str | None = None
    completion_photos: list[str] | None = None
    created_by_id: int | None
    cancelled_at: datetime | None
    cancellation_reason: str | None
    created_at: datetime
    updated_at: datetime | None


class AppointmentListResponse(BaseModel):
    """Schema para listagem paginada de agendamentos."""

    items: list[AppointmentResponse]
    pagination: PaginationMeta


class AppointmentSummaryResponse(BaseModel):
    """Contadores de agendamentos por display_status para o dia."""

    atrasado: int = 0
    atencao: int = 0
    agendado: int = 0
    em_execucao: int = 0
    finalizado: int = 0
    cancelado: int = 0


class CancelAppointmentRequest(BaseModel):
    """Schema para cancelamento de agendamento."""

    cancellation_reason: str | None = None


class GenerateOSRequest(BaseModel):
    """Dados fornecidos ao gerar O.S. a partir do agendamento (etapa simplificada)."""

    photos: list[str] = Field(
        ..., min_length=1, description="Fotos do veículo comprovando disponibilidade"
    )
    notes: str | None = None


class AppointmentHistoryEntry(BaseModel):
    """Uma entrada no histórico de edições do agendamento."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    action: str
    user_id: int | None
    user_name: str | None
    old_value: dict | None
    new_value: dict | None
    created_at: datetime


class AppointmentHistoryResponse(BaseModel):
    """Lista do histórico de edições de um agendamento."""

    items: list[AppointmentHistoryEntry]


class SchedulingStoreSummary(BaseModel):
    """Contadores de agendamentos por loja."""

    store_id: int
    store_name: str
    atrasado: int = 0
    atencao: int = 0
    agendado: int = 0
    em_execucao: int = 0
    finalizado: int = 0
    cancelado: int = 0
    total: int = 0
