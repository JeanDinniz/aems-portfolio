"""
Time Clock schemas - Pydantic models for time clock data validation.
"""

from datetime import date as date_type
from datetime import datetime, time
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.schemas import PaginationMeta


class EnrollFaceRequest(BaseModel):
    """
    Cadastro do rosto de referência para o reconhecimento facial 1:1.

    O `embedding` é o vetor gerado NO APARELHO a partir da selfie (a imagem crua
    não é enviada nem armazenada). `consent` registra o aceite LGPD do
    funcionário para o uso do dado biométrico — obrigatório para cadastrar.
    """

    embedding: list[float] = Field(..., min_length=32, max_length=2048)
    consent: bool = Field(..., description="Consentimento LGPD para uso do dado biométrico")

    @field_validator("embedding")
    @classmethod
    def _finite_values(cls, v: list[float]) -> list[float]:
        import math

        if any(not math.isfinite(x) for x in v):
            raise ValueError("embedding contém valores inválidos (NaN/infinito)")
        return v


class EnrollFaceResponse(BaseModel):
    enrolled: bool
    enrolled_at: datetime
    dimension: int


class PunchRequest(BaseModel):
    """
    Batida de ponto. O horário NÃO é aceito do cliente — é sempre o do servidor.
    """

    type: Literal["in", "out"]
    photo_url: str = Field(..., min_length=5, max_length=500)
    latitude: Decimal = Field(..., ge=-90, le=90)
    longitude: Decimal = Field(..., ge=-180, le=180)
    accuracy_m: Decimal | None = Field(None, ge=0)
    # Horário do relógio do aparelho (metadado auxiliar; o oficial é o do servidor).
    client_reported_at: datetime | None = Field(
        None, description="Horário local do dispositivo (só metadado; servidor decide o oficial)"
    )
    # Reconhecimento facial (Fase 2): embedding do rosto na batida, gerado no
    # aparelho. Opcional (retrocompatível com apps antigos). Quando presente e o
    # funcionário tiver rosto cadastrado, o backend calcula a similaridade.
    face_embedding: list[float] | None = Field(None, min_length=32, max_length=2048)
    # Batida coletada offline e sincronizada depois (REP-A / Opção A): quando True
    # e `client_reported_at` presente, o horário do dispositivo vira o oficial.
    is_offline: bool = Field(
        False, description="True quando a batida foi coletada offline e sincronizada depois."
    )

    @field_validator("face_embedding")
    @classmethod
    def _finite_embedding(cls, v: list[float] | None) -> list[float] | None:
        if v is not None:
            import math

            if any(not math.isfinite(x) for x in v):
                raise ValueError("face_embedding contém valores inválidos (NaN/infinito)")
        return v


class TimeClockRecordResponse(BaseModel):
    """Uma batida de ponto (ou uma correção administrativa vinculada)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    employee_name: str | None = None
    store_id: int
    store_name: str | None = None
    type: str
    recorded_at: datetime
    recorded_date: date_type
    # Horário do relógio do aparelho no momento da batida (metadado; nunca oficial).
    client_reported_at: datetime | None = None
    # Batida do funcionário traz lat/long/foto; ajuste do RH não tem GPS/selfie.
    latitude: Decimal | None = None
    longitude: Decimal | None = None
    accuracy_m: Decimal | None = None
    distance_m: Decimal | None = None
    is_within_radius: bool | None = None
    photo_url: str | None = None
    # Reconhecimento facial (Fase 2): similaridade [0..1] e resultado advisory.
    face_match_score: float | None = None
    face_verified: bool | None = None
    # Correção administrativa: 'employee' (batida) | 'admin_adjustment' (ajuste/anulação);
    # motivo e o id da batida anulada (quando este registro é uma anulação).
    source: str = "employee"
    adjustment_reason: str | None = None
    annuls_record_id: int | None = None
    # Integridade REP-A: NSR sequencial persistido, flag/instante de sincronização
    # da batida offline. `receipt` = comprovante de registro (preenchido quando há NSR).
    nsr: int | None = None
    is_offline_record: bool = False
    synced_at: datetime | None = None
    # True quando a batida offline foi sincronizada muito depois da marcação
    # (intervalo > OFFLINE_SYNC_ALERT_HOURS) — sinal de conferência p/ o RH.
    offline_sync_late: bool = False
    receipt: "TimeClockReceipt | None" = None


class TimeClockReceipt(BaseModel):
    """Comprovante de registro de batida (Portaria 671 — controle interno REP-A)."""

    nsr: int
    employer_name: str
    employer_cnpj: str
    employee_name: str
    employee_cpf: str | None
    type: Literal["in", "out"]
    recorded_at: datetime
    is_offline_record: bool
    system_id: str
    hash_short: str  # últimos 8 dígitos do record_hash (conferência rápida)


class TimeClockAdjustmentCreate(BaseModel):
    """
    Ajuste administrativo (RH): lança uma batida esquecida como NOVO registro
    vinculado — NUNCA sobrescreve a marcação bruta. O horário é o pretendido
    (o que foi esquecido); o momento do lançamento fica em `created_at`.
    """

    employee_id: int
    type: Literal["in", "out"]
    recorded_at: datetime = Field(..., description="Horário pretendido da batida (com fuso)")
    reason: str = Field(..., min_length=3, max_length=500, description="Motivo da correção")


class TimeClockAnnulRequest(BaseModel):
    """Anula uma batida existente criando um registro de anulação vinculado."""

    reason: str = Field(..., min_length=3, max_length=500, description="Motivo da anulação")


class TimeClockMeResponse(BaseModel):
    """Estado do ponto do usuário logado (employee null = usuário sem vínculo)."""

    employee_id: int | None = None
    employee_name: str | None = None
    store_name: str | None = None
    work_start_time: time | None = None
    work_end_time: time | None = None
    face_enrolled: bool = False  # True quando o rosto de referência já foi cadastrado
    last_type: str | None = None  # 'in' | 'out' | None (nenhuma batida hoje)
    today: list[TimeClockRecordResponse] = []
    recent: list[TimeClockRecordResponse] = []  # últimos 7 dias (inclui hoje)


class TimeClockListResponse(BaseModel):
    """Espelho de ponto paginado."""

    items: list[TimeClockRecordResponse]
    pagination: PaginationMeta


class TimeClockMeMirrorResponse(BaseModel):
    """Autoatendimento: o próprio funcionário consulta seu espelho (24h ou mês)."""

    period: str  # '24h' | 'month'
    employee_id: int
    employee_name: str | None = None
    store_name: str | None = None
    start: date_type
    end: date_type
    items: list[TimeClockRecordResponse] = []


# Resolve o forward ref `TimeClockReceipt` em TimeClockRecordResponse.
TimeClockRecordResponse.model_rebuild()
