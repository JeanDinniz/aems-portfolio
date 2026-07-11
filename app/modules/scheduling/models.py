"""Appointment model for the scheduling module."""

from datetime import date, datetime, time
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Index, String, Text, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.modules.auth.models import User
    from app.modules.consultants.models import Consultant
    from app.modules.inventory.models import FilmType
    from app.modules.service_orders.models import ServiceOrder
    from app.modules.stores.models import Store


class Appointment(Base, TimestampMixin):
    """Agendamento de veículo para serviço."""

    __tablename__ = "appointments"

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    department: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    delivery_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    delivery_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    external_os_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    vehicle_plate: Mapped[str] = mapped_column(String(17), nullable=False, index=True)
    vehicle_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    vehicle_color: Mapped[str | None] = mapped_column(String(50), nullable=True)
    consultant_id: Mapped[int | None] = mapped_column(
        ForeignKey("consultants.id", ondelete="SET NULL"), nullable=True
    )
    consultant_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_galpon: Mapped[bool] = mapped_column(default=False, nullable=False)
    is_courtesy: Mapped[bool] = mapped_column(default=False, nullable=False)
    is_return: Mapped[bool] = mapped_column(default=False, nullable=False)
    film_type_id: Mapped[int | None] = mapped_column(
        ForeignKey("film_types.id", ondelete="SET NULL"), nullable=True
    )
    film_tonality: Mapped[str | None] = mapped_column(String(20), nullable=True)
    ppf_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ppf_brand: Mapped[str | None] = mapped_column(String(100), nullable=True)
    service_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    film_entries: Mapped[list | None] = mapped_column(JSON, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="scheduled", index=True)
    service_order_id: Mapped[int | None] = mapped_column(
        ForeignKey("service_orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    store: Mapped["Store"] = relationship("Store", foreign_keys=[store_id])
    consultant: Mapped["Consultant | None"] = relationship(
        "Consultant", foreign_keys=[consultant_id]
    )
    film_type: Mapped["FilmType | None"] = relationship("FilmType", foreign_keys=[film_type_id])
    service_order: Mapped["ServiceOrder | None"] = relationship(
        "ServiceOrder", foreign_keys=[service_order_id]
    )
    created_by: Mapped["User | None"] = relationship("User", foreign_keys=[created_by_id])

    __table_args__ = (Index("ix_appointments_store_delivery", "store_id", "delivery_date"),)
