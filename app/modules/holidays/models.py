"""
Holiday model - Represents a holiday used to compute business days.
A holiday with store_id NULL applies to every store.
"""

from datetime import date as date_type

from sqlalchemy import Date, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Holiday(Base, TimestampMixin):
    """
    Modelo de Feriado.
    Usado para descontar dias úteis (seg-sáb) no Resumo Diário da loja.
    store_id NULL = feriado válido para todas as lojas.
    """

    __tablename__ = "holidays"
    __table_args__ = (UniqueConstraint("date", "store_id", name="uq_holidays_date_store"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    store_id: Mapped[int | None] = mapped_column(
        ForeignKey("stores.id", ondelete="CASCADE"), nullable=True, index=True
    )

    # Relationships
    store: Mapped["Store | None"] = relationship("Store")  # noqa: F821

    def __repr__(self) -> str:
        scope = f"store={self.store_id}" if self.store_id else "todas as lojas"
        return f"<Holiday {self.date} {self.name} ({scope})>"
