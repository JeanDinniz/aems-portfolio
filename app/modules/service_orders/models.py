"""
Service Order models - All models related to service orders.
"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class ServiceOrder(Base, TimestampMixin):
    """
    Modelo de Ordem de Serviço (O.S.).
    Representa um veículo que entrou para receber serviços.
    """

    __tablename__ = "service_orders"
    # Composto para os filtros de perfil galpão (is_galpon combinado com loja
    # em analytics, listagens e permissões)
    __table_args__ = (Index("ix_service_orders_store_galpon", "store_id", "is_galpon"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    order_number: Mapped[str | None] = mapped_column(
        String(30), nullable=True, unique=True, index=True
    )  # Gerado automaticamente pelo trigger: {store_code}-{YYMM}-{SEQ}
    external_os_number: Mapped[str | None] = mapped_column(
        String(100), nullable=True, index=True
    )  # Número de OS do sistema externo da concessionária (ex: OS Toyota)

    # Relacionamentos principais
    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    dealership_id: Mapped[int | None] = mapped_column(
        ForeignKey("dealerships.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    consultant_id: Mapped[int | None] = mapped_column(
        ForeignKey("consultants.id", ondelete="SET NULL"), nullable=True
    )
    consultant_name: Mapped[str | None] = mapped_column(
        String(200), nullable=True
    )  # Preservado historicamente ao excluir o consultor
    is_galpon: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )
    is_return: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )
    is_courtesy: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )

    # Dados do veículo
    vehicle_plate: Mapped[str] = mapped_column(
        String(17), nullable=False, index=True
    )  # Ex: ABC1D23 (placa) ou 9BWZZZ377VT004251 (chassi/VIN)
    vehicle_brand: Mapped[str | None] = mapped_column(String(100), nullable=True)
    vehicle_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    vehicle_color: Mapped[str | None] = mapped_column(String(50), nullable=True)
    vehicle_year: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Departamento e status
    department: Mapped[str] = mapped_column(
        String(20), nullable=False, index=True
    )  # film, bodywork, vn, vu, workshop
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="waiting", index=True)

    # Controle de tempo
    entry_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    start_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completion_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Mapa de avarias e fotos
    damage_map: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON com pontos de avaria
    photos: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON com URLs das fotos
    damage_photos: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )  # JSON com URLs das fotos de avaria
    completion_photos: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )  # JSON com URLs das fotos da chancela (preenchido no Finalizar)

    # Observações
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Conferência e fechamento
    service_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Conferência e qualidade
    requires_invoice: Mapped[bool] = mapped_column(
        Boolean, default=False
    )  # NF obrigatória para película
    invoice_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Modelo de veículo vinculado (FK opcional — preenchido quando selecionado do catálogo)
    vehicle_model_id: Mapped[int | None] = mapped_column(
        ForeignKey("vehicle_models.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Usuário que criou
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Último usuário que atualizou a O.S. (qualquer mutação: edição, status, verificação)
    updated_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    store: Mapped["Store"] = relationship(  # noqa: F821
        "Store", back_populates="service_orders", foreign_keys=[store_id]
    )
    dealership: Mapped["Dealership | None"] = relationship(  # noqa: F821
        "Dealership", back_populates="service_orders"
    )
    consultant: Mapped["Consultant | None"] = relationship(  # noqa: F821
        "Consultant", back_populates="service_orders"
    )
    vehicle_model_ref: Mapped["VehicleModel | None"] = relationship(  # noqa: F821
        "VehicleModel"
    )
    created_by: Mapped["User"] = relationship(  # noqa: F821
        "User", foreign_keys=[created_by_id]
    )
    updated_by: Mapped["User | None"] = relationship(  # noqa: F821
        "User", foreign_keys=[updated_by_id]
    )
    items: Mapped[list["ServiceOrderItem"]] = relationship(
        "ServiceOrderItem", back_populates="service_order", cascade="all, delete-orphan"
    )
    workers: Mapped[list["ServiceOrderWorker"]] = relationship(
        "ServiceOrderWorker",
        back_populates="service_order",
        cascade="all, delete-orphan",
    )
    status_history: Mapped[list["StatusHistory"]] = relationship(
        "StatusHistory", back_populates="service_order", cascade="all, delete-orphan"
    )

    @property
    def store_name(self) -> str | None:
        return self.store.name if self.store else None

    def __repr__(self) -> str:
        return f"<ServiceOrder #{self.id} - {self.vehicle_plate}>"


class ServiceOrderItem(Base, TimestampMixin):
    """
    Item de Ordem de Serviço.
    Representa um serviço específico dentro de uma O.S.
    """

    __tablename__ = "service_order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    service_order_id: Mapped[int] = mapped_column(
        ForeignKey("service_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    service_id: Mapped[int] = mapped_column(
        ForeignKey("services.id", ondelete="RESTRICT"), nullable=False
    )

    # Preço e quantidade
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=0)

    # Tonalidade e código da bobina (usados para serviços de película)
    tonality: Mapped[str | None] = mapped_column(String(20), nullable=True)
    roll_code: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Bobina de película vinculada (opcional — usada para rastreabilidade e desconto automático)
    film_roll_id: Mapped[int | None] = mapped_column(
        ForeignKey("film_rolls.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Tipo de película/PPF vinculado (usado para pré-selecionar a marca no FilmPicker)
    film_type_id: Mapped[int | None] = mapped_column(
        ForeignKey("film_types.id", ondelete="SET NULL"), nullable=True
    )

    # Observações específicas do item
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    service_order: Mapped["ServiceOrder"] = relationship("ServiceOrder", back_populates="items")
    service: Mapped["Service"] = relationship(  # noqa: F821
        "Service", back_populates="service_order_items"
    )
    film_roll: Mapped["FilmRoll | None"] = relationship(  # noqa: F821
        "FilmRoll"
    )

    @property
    def service_name(self) -> str | None:
        return self.service.name if self.service else None

    @property
    def service_code(self) -> str | None:
        return self.service.code if self.service else None

    def __repr__(self) -> str:
        return f"<ServiceOrderItem #{self.id} - O.S. {self.service_order_id}>"


class ServiceOrderWorker(Base, TimestampMixin):
    """
    Funcionário designado para uma Ordem de Serviço.
    Rastreia quais funcionários trabalharam em cada O.S.
    """

    __tablename__ = "service_order_workers"

    id: Mapped[int] = mapped_column(primary_key=True)
    service_order_id: Mapped[int] = mapped_column(
        ForeignKey("service_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False
    )

    # Controle de tempo do funcionário
    start_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Performance
    hours_worked: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Relationships
    service_order: Mapped["ServiceOrder"] = relationship("ServiceOrder", back_populates="workers")
    employee: Mapped["Employee"] = relationship("Employee")  # noqa: F821

    @property
    def employee_name(self) -> str | None:
        if self.employee:
            return self.employee.name
        return None

    def __repr__(self) -> str:
        return f"<ServiceOrderWorker #{self.id} - O.S. {self.service_order_id}>"


class StatusHistory(Base, TimestampMixin):
    """
    Histórico de mudanças de status de Ordem de Serviço.
    Rastreia todas as transições de status para auditoria.
    """

    __tablename__ = "status_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    service_order_id: Mapped[int] = mapped_column(
        ForeignKey("service_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Mudança de status
    from_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_status: Mapped[str] = mapped_column(String(20), nullable=False)

    # Quem mudou e quando
    changed_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Observações sobre a mudança
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    service_order: Mapped["ServiceOrder"] = relationship(
        "ServiceOrder", back_populates="status_history"
    )
    changed_by: Mapped["User"] = relationship("User")  # noqa: F821

    def __repr__(self) -> str:
        return f"<StatusHistory #{self.id} - {self.from_status} → {self.to_status}>"
