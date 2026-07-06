"""
Consultant model - Represents a sales consultant from a dealership.
"""

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Consultant(Base, TimestampMixin):
    """
    Modelo de Consultor de Vendas.
    Representa um consultor de vendas vinculado a uma concessionária.
    """

    __tablename__ = "consultants"
    __table_args__ = (UniqueConstraint("name", "store_id", name="uq_consultant_name_store"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    dealership_id: Mapped[int] = mapped_column(
        ForeignKey("dealerships.id", ondelete="CASCADE"), nullable=False, index=True
    )
    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Dados de pagamento (todos opcionais)
    pix_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    bank_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    bank_agency: Mapped[str | None] = mapped_column(String(20), nullable=True)
    bank_account: Mapped[str | None] = mapped_column(String(30), nullable=True)
    bank_account_type: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )  # 'corrente' | 'poupanca'

    # Relationships
    dealership: Mapped["Dealership"] = relationship(  # noqa: F821
        "Dealership", back_populates="consultants"
    )
    store: Mapped["Store"] = relationship(  # noqa: F821
        "Store", back_populates="consultants"
    )
    service_orders: Mapped[list["ServiceOrder"]] = relationship(  # noqa: F821
        "ServiceOrder", back_populates="consultant", passive_deletes=True
    )

    def __repr__(self) -> str:
        return f"<Consultant {self.name}>"
