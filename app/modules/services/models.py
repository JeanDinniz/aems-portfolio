"""
Service model - Represents a service in the catalog.
"""

from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Service(Base, TimestampMixin):
    """
    Modelo de Serviço.
    Representa um serviço do catálogo vinculado a uma marca.
    Departamentos: película (film), funilaria (bodywork), vn, vu, workshop.
    """

    __tablename__ = "services"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    department: Mapped[str] = mapped_column(
        String(20), nullable=False, index=True
    )  # film, bodywork, vn, vu, workshop
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(String(30), nullable=True)
    execution_time_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    base_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    points: Mapped[Decimal] = mapped_column(
        Numeric(6, 2), nullable=False, default=0, server_default="0"
    )  # pontuação do serviço para o Desempenho de Instaladores
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    has_variable_price: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_courtesy_only: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )  # Exclusivo de cortesia: oculto em O.S. normais, exibido só em O.S./agendamento cortesia
    code: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )  # código original da planilha (ex: "TNT 1", "PPF KIT1", "VN1")
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id"), nullable=False, index=True)

    # Relationships
    brand: Mapped["Brand"] = relationship(  # noqa: F821
        "Brand", back_populates="services"
    )
    service_order_items: Mapped[list["ServiceOrderItem"]] = relationship(  # noqa: F821
        "ServiceOrderItem", back_populates="service"
    )

    def __repr__(self) -> str:
        return f"<Service {self.department}: {self.name}>"
