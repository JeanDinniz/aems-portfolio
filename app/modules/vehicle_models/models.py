"""
VehicleModel - Modelo de veículo cadastrado por marca.
Usado em dropdowns ao lançar Ordens de Serviço.
"""

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class VehicleModel(Base, TimestampMixin):
    """
    Modelo de veículo vinculado a uma marca.
    Cada marca mantém sua própria lista de modelos disponíveis para seleção
    durante o lançamento de O.S.
    """

    __tablename__ = "vehicle_models"
    __table_args__ = (UniqueConstraint("brand_id", "name", name="uq_vehicle_model_brand_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True)

    brand: Mapped["Brand"] = relationship(  # noqa: F821
        "Brand", back_populates="vehicle_models", lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<VehicleModel {self.id}: {self.name} (brand_id={self.brand_id})>"
