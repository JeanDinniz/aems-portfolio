"""
Push module models - SQLAlchemy model for push device registration.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class PushDevice(Base):
    """
    Modelo de dispositivo registrado para push notifications.

    Cada registro representa um token FCM/APNs associado a um usuario.
    O token e unico no sistema — ao re-registrar um mesmo token (troca de
    conta no mesmo aparelho), o user_id e atualizado para o usuario corrente.
    """

    __tablename__ = "push_devices"

    id: Mapped[int] = mapped_column(primary_key=True)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    token: Mapped[str] = mapped_column(
        String(512),
        unique=True,
        nullable=False,
        index=True,
    )

    # 'ios' ou 'android'
    platform: Mapped[str] = mapped_column(String(10), nullable=False)

    app_version: Mapped[str | None] = mapped_column(String(32), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default="now()",
    )

    last_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default="now()",
    )

    # Relacionamento — apenas para navegacao; nao usar em queries hot-path
    user: Mapped["User"] = relationship("User")  # noqa: F821

    def __repr__(self) -> str:
        return f"<PushDevice #{self.id} user_id={self.user_id} platform={self.platform}>"
