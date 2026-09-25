"""
Notifications models - SQLAlchemy model for in-app notifications.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Notification(Base):
    """
    Modelo de Notificacao.
    Representa uma notificacao in-app para um usuario especifico.
    """

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Destinatario
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Tipo da notificacao (enum string)
    type: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # order_created, approval_needed, inventory_alert, etc.

    # Conteudo
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)

    # Deep-link opcional (ex.: "/estoque?roll=42") para o front/app rotear ao abrir
    related_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Estado
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_galpon: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )

    # Timestamp
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Relationships
    user: Mapped["User"] = relationship("User")  # noqa: F821

    def __repr__(self) -> str:
        return f"<Notification #{self.id} type={self.type} user_id={self.user_id}>"
