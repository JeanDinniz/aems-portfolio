"""
Dealership model - Represents a dealership partner (concessionária).
"""

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Dealership(Base, TimestampMixin):
    """
    Modelo de Concessionária.
    Representa uma concessionária parceira vinculada a uma loja.
    """

    __tablename__ = "dealerships"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    brand: Mapped[str] = mapped_column(
        String(100), nullable=False
    )  # Ex: Toyota, BYD, Fiat, Hyundai
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Relationships
    store: Mapped["Store"] = relationship(  # noqa: F821
        "Store", back_populates="dealerships"
    )
    consultants: Mapped[list["Consultant"]] = relationship(  # noqa: F821
        "Consultant", back_populates="dealership", cascade="all, delete-orphan"
    )
    service_orders: Mapped[list["ServiceOrder"]] = relationship(  # noqa: F821
        "ServiceOrder", back_populates="dealership"
    )

    def __repr__(self) -> str:
        return f"<Dealership {self.brand}: {self.name}>"
