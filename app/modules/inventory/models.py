"""
Inventory models - Film types, film rolls, and consumption tracking.
"""

from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class FilmType(Base, TimestampMixin):
    """
    Tipo de Película (ex: Poliéster, Fumê, Nano).
    Define limiares de alerta de estoque por tipo.
    """

    __tablename__ = "film_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    yellow_threshold_meters: Mapped[float] = mapped_column(
        Float, nullable=False, default=10.0
    )  # Limiar amarelo: estoque baixo
    red_threshold_meters: Mapped[float] = mapped_column(
        Float, nullable=False, default=3.0
    )  # Limiar vermelho: estoque crítico
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    department: Mapped[str] = mapped_column(String(20), nullable=False, default="film", index=True)
    # Tonalidades disponíveis para este tipo (ex: ["G05","G20","G35","G50","G75"]).
    # "Incolor" só deve constar em tipos de película de segurança.
    available_tonalities: Mapped[list[str]] = mapped_column(
        JSON, nullable=False, default=list, server_default="[]"
    )

    # Relationships
    service_associations: Mapped[list["FilmTypeService"]] = relationship(
        "FilmTypeService",
        back_populates="film_type",
        cascade="all, delete-orphan",
    )
    rolls: Mapped[list["FilmRoll"]] = relationship(
        "FilmRoll",
        back_populates="film_type",
    )

    def __repr__(self) -> str:
        return f"<FilmType #{self.id}: {self.name}>"


class FilmTypeService(Base):
    """
    Associação entre FilmType e Service com quantidade de metros consumidos.
    Determina quantos metros deste tipo de película um determinado serviço consome.
    """

    __tablename__ = "film_type_services"

    film_type_id: Mapped[int] = mapped_column(
        ForeignKey("film_types.id", ondelete="CASCADE"),
        primary_key=True,
    )
    service_id: Mapped[int] = mapped_column(
        ForeignKey("services.id", ondelete="CASCADE"),
        primary_key=True,
    )
    meters_consumed: Mapped[float] = mapped_column(
        Float, nullable=False, default=1.0
    )  # Metros que este serviço consome desta película

    # Relationships
    film_type: Mapped["FilmType"] = relationship("FilmType", back_populates="service_associations")
    service: Mapped["Service"] = relationship("Service")  # noqa: F821

    __table_args__ = (UniqueConstraint("film_type_id", "service_id", name="uq_film_type_service"),)

    def __repr__(self) -> str:
        return f"<FilmTypeService film_type={self.film_type_id} service={self.service_id}>"


class FilmRoll(Base, TimestampMixin):
    """
    Bobina física de película.
    Rastreia o estoque e consumo de cada bobina individualmente.
    """

    __tablename__ = "film_rolls"

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    film_type_id: Mapped[int] = mapped_column(
        ForeignKey("film_types.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    tonality: Mapped[str | None] = mapped_column(
        String(20), nullable=True, index=True
    )  # G05, G20, G35, G75, etc. (None para PPF)
    supplier: Mapped[str | None] = mapped_column(String(200), nullable=True)
    nfe_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    cost: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    lot_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    total_meters: Mapped[float] = mapped_column(Float, nullable=False)
    remaining_meters: Mapped[float] = mapped_column(Float, nullable=False)
    receipt_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="em_estoque", index=True
    )  # em_estoque | em_uso | esgotada

    supplier_id: Mapped[int | None] = mapped_column(
        ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True
    )

    # Pedido de material que originou esta bobina (entrada via /material-requests).
    # NULL para bobinas cadastradas direto no Estoque. SET NULL ao excluir o pedido.
    material_request_id: Mapped[int | None] = mapped_column(
        ForeignKey("material_requests.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Relationships
    film_type: Mapped["FilmType"] = relationship("FilmType", back_populates="rolls")
    store: Mapped["Store"] = relationship("Store")  # noqa: F821
    supplier_rel: Mapped["Supplier"] = relationship(  # noqa: F821
        "Supplier", foreign_keys=[supplier_id]
    )
    consumptions: Mapped[list["FilmConsumption"]] = relationship(
        "FilmConsumption",
        back_populates="film_roll",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        tonality_str = f" {self.tonality}" if self.tonality else ""
        return f"<FilmRoll #{self.id}{tonality_str} {self.remaining_meters:.1f}m>"


class FilmConsumption(Base):
    """
    Registro de consumo de película (auditoria).
    Cada desconto na bobina gera um registro aqui.
    """

    __tablename__ = "film_consumptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    film_roll_id: Mapped[int] = mapped_column(
        ForeignKey("film_rolls.id", ondelete="CASCADE"), nullable=False, index=True
    )
    service_order_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("service_order_items.id", ondelete="SET NULL"), nullable=True, index=True
    )
    film_withdrawal_id: Mapped[int | None] = mapped_column(
        ForeignKey("film_withdrawals.id", ondelete="SET NULL"), nullable=True, index=True
    )
    meters_consumed: Mapped[float] = mapped_column(Float, nullable=False)
    # Tipo do movimento no extrato da bobina: consumo (O.S.), estorno (devolução),
    # ajuste (correção manual pela conferência de estoque) ou reconciliacao (linha
    # da migração 107 que casou saldo x extrato). NULL = movimento legado (inferir
    # pelos FKs de O.S./saída avulsa).
    kind: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    # Motivo obrigatório quando kind == 'ajuste' (por que o saldo foi corrigido).
    adjustment_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    # Relationships
    film_roll: Mapped["FilmRoll"] = relationship("FilmRoll", back_populates="consumptions")

    def __repr__(self) -> str:
        return f"<FilmConsumption #{self.id} roll={self.film_roll_id} {self.meters_consumed}m>"


class FilmWithdrawal(Base):
    """
    Saída avulsa de película: metros entregues a um funcionário fora de O.S.
    (ex.: pedaço para retrabalho ou uso pessoal, descontado em folha no fim do mês).

    O débito/crédito de metros fica no ledger FilmConsumption via
    film_withdrawal_id; store_id é snapshot da loja da bobina no momento da
    saída (transferências posteriores da bobina não reescrevem o histórico).
    Estorno é soft: reversed_at/reversed_by preenchidos, registro preservado.
    """

    __tablename__ = "film_withdrawals"

    id: Mapped[int] = mapped_column(primary_key=True)
    film_roll_id: Mapped[int] = mapped_column(
        ForeignKey("film_rolls.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    meters: Mapped[float] = mapped_column(Float, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reversed_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    film_roll: Mapped["FilmRoll"] = relationship("FilmRoll")
    store: Mapped["Store"] = relationship("Store")  # noqa: F821
    employee: Mapped["Employee"] = relationship("Employee")  # noqa: F821
    created_by: Mapped["User"] = relationship(  # noqa: F821
        "User", foreign_keys=[created_by_user_id]
    )
    reversed_by: Mapped["User"] = relationship(  # noqa: F821
        "User", foreign_keys=[reversed_by_user_id]
    )

    def __repr__(self) -> str:
        return f"<FilmWithdrawal #{self.id} roll={self.film_roll_id} {self.meters}m>"
