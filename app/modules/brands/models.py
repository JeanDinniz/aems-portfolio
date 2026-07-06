"""
Brand model - Represents a vehicle brand (dealership brand).
Centralizes services and vehicle models by brand.
"""

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Brand(Base, TimestampMixin):
    """
    Modelo de Marca.
    Representa uma marca de concessionária (Toyota, BYD, Fiat, Hyundai).
    Centraliza serviços e modelos de veículos por marca.
    """

    __tablename__ = "brands"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    code: Mapped[str] = mapped_column(
        String(10), unique=True, nullable=False, index=True
    )  # ex: "toyota", "byd", "fiat", "hyundai"
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Relationships
    stores: Mapped[list["Store"]] = relationship(  # noqa: F821
        "Store", back_populates="brand"
    )
    services: Mapped[list["Service"]] = relationship(  # noqa: F821
        "Service", back_populates="brand"
    )
    vehicle_models: Mapped[list["VehicleModel"]] = relationship(  # noqa: F821
        "VehicleModel", back_populates="brand"
    )

    def __repr__(self) -> str:
        return f"<Brand {self.code}: {self.name}>"
