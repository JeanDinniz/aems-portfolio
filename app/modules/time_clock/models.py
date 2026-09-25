"""
Time Clock models - Registro de ponto eletrônico dos funcionários.

Controle interno de presença ENDURECIDO para os princípios da Portaria MTP
671/2021 (mas SEM assinatura ICP-Brasil/registro INPI — não é um REP-P legal).
A batida é feita pelo usuário vinculado ao funcionário (Employee.user_id), com
selfie e geolocalização; o horário é sempre o do servidor.

Garantias:
- Imutabilidade: batidas nunca são alteradas/apagadas (guarda de aplicação +
  trigger no Postgres). Correções são NOVOS registros vinculados (source
  'admin_adjustment', annuls_record_id) — o bruto original é preservado.
- Marcação nunca é impedida (rosto/geofence são advisory).
- Retenção: NÃO existe rotina de purge/exclusão de time_clock_records — os
  registros são mantidos indefinidamente (política ≥ 5 anos; backup off-site é
  responsabilidade da infraestrutura). Ver TestRetentionGuard.
"""

from datetime import date as date_type
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    event,
    func,
)
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from app.db.base import Base


class TimeClockRecord(Base):
    """
    Uma batida de ponto (entrada ou saída).

    - recorded_at: hora do servidor (o cliente nunca envia horário).
    - recorded_date: data local (America/Sao_Paulo) materializada — o "dia de
      negócio" é fuso-dependente e todos os filtros são por dia local.
    - user_id/store_id: snapshots de auditoria (sobrevivem a desvínculo/transferência).
    - distance_m/is_within_radius: null quando a loja não tem geofence cadastrado.
      O geofence nunca bloqueia a batida, apenas sinaliza.
    """

    __tablename__ = "time_clock_records"
    __table_args__ = (
        Index("ix_tcr_store_date", "store_id", "recorded_date"),
        Index("ix_tcr_employee_date", "employee_id", "recorded_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False
    )

    type: Mapped[str] = mapped_column(String(10), nullable=False)  # 'in' | 'out'

    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    recorded_date: Mapped[date_type] = mapped_column(Date, nullable=False)

    # Horário do relógio do CLIENTE no momento da batida — metadado auxiliar
    # (nunca é o oficial). Serve para detectar delay de rede/fraude comparando com
    # recorded_at (servidor). null em apps antigos e em ajustes administrativos.
    client_reported_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Batida do funcionário traz lat/long/foto; um ajuste administrativo (RH) não
    # tem GPS/selfie — por isso são nullable (a validação de obrigatoriedade para
    # a batida do funcionário fica no schema do endpoint /punch).
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    accuracy_m: Mapped[Decimal | None] = mapped_column(Numeric(8, 2), nullable=True)
    distance_m: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    is_within_radius: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Reconhecimento facial (Fase 2): similaridade de cosseno entre a selfie da
    # batida e o rosto de referência do funcionário. `face_verified` é o resultado
    # advisory pelo limiar atual. null = sem cadastro/sem embedding na batida.
    face_match_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    face_verified: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Correção administrativa (imutabilidade por ADIÇÃO): a marcação bruta NUNCA é
    # sobrescrita — correções entram como NOVOS registros vinculados.
    # - source: 'employee' (batida do funcionário) | 'admin_adjustment' (lançado pelo RH)
    # - created_by_user_id: quem lançou o ajuste/anulação (admin)
    # - adjustment_reason: motivo obrigatório da correção
    # - annuls_record_id: aponta para a batida que este registro anula (quando anulação)
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="employee", server_default="employee"
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    adjustment_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    annuls_record_id: Mapped[int | None] = mapped_column(
        ForeignKey("time_clock_records.id", ondelete="RESTRICT"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Integridade REP-A — atribuídos no INSERT, nunca alterados.
    # nsr: contador sequencial global (CNPJ único). record_hash: SHA-256 dos
    # campos legais + prev_hash (corrente de integridade). Ver integrity.py.
    nsr: Mapped[int | None] = mapped_column(BigInteger, nullable=True, unique=True, index=True)
    record_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    prev_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # CPF congelado no INSERT (entra no hash). Snapshot imutável — editar o
    # cadastro do funcionário não altera a corrente já gravada.
    cpf_snapshot: Mapped[str | None] = mapped_column(String(14), nullable=True)

    # Batida coletada offline (horário oficial = client_reported_at, sinalizado).
    is_offline_record: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    employee: Mapped["Employee"] = relationship("Employee")  # noqa: F821
    store: Mapped["Store"] = relationship("Store")  # noqa: F821

    def __repr__(self) -> str:
        return (
            f"<TimeClockRecord #{self.id} emp={self.employee_id} {self.type} {self.recorded_date}>"
        )


class TimeClockReminderSent(Base):
    """
    Marca de lembrete enviado (idempotência da task Celery de lembretes).
    UNIQUE(employee_id, reminder_date, type): a task insere com ON CONFLICT
    DO NOTHING e só notifica quando a inserção acontece.
    """

    __tablename__ = "time_clock_reminders_sent"
    __table_args__ = (
        UniqueConstraint(
            "employee_id", "reminder_date", "type", name="uq_tc_reminder_emp_date_type"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reminder_date: Mapped[date_type] = mapped_column(Date, nullable=False)
    type: Mapped[str] = mapped_column(String(10), nullable=False)  # 'in' | 'out'
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<TimeClockReminderSent emp={self.employee_id} {self.reminder_date} {self.type}>"


class TimeClockImmutableError(Exception):
    """Levantada ao tentar UPDATE/DELETE de uma batida — o registro é imutável."""


@event.listens_for(Session, "before_flush")
def _enforce_time_clock_immutability(session, flush_context, instances) -> None:
    """
    Imutabilidade no nível da aplicação: uma batida (TimeClockRecord) NUNCA pode
    ser alterada ou apagada — correções são NOVOS registros vinculados (ajuste ou
    anulação). Complementa o trigger no Postgres (a garantia real no banco) e
    torna a regra testável também em SQLite.

    Inserts (session.new) são permitidos — só bloqueia UPDATE (dirty) e DELETE.
    Usa a filiação em session.dirty (passiva, sem IO); no app nada altera atributos
    de uma batida após a inserção, então não há falso-positivo.
    """
    for obj in session.dirty:
        if isinstance(obj, TimeClockRecord):
            raise TimeClockImmutableError(
                "Batida de ponto é imutável — use um ajuste/anulação vinculado "
                "(Portaria MTP 671/2021)."
            )
    for obj in session.deleted:
        if isinstance(obj, TimeClockRecord):
            raise TimeClockImmutableError(
                "Batida de ponto não pode ser apagada — registro imutável (Portaria MTP 671/2021)."
            )
