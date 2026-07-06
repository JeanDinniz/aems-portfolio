"""
SQLAlchemy Base class for models.
Todos os models devem herdar desta classe Base.
"""

from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """
    Classe base para todos os models SQLAlchemy.
    Fornece campos comuns como created_at e updated_at.
    """

    pass


class TimestampMixin:
    """
    Mixin para adicionar campos de timestamp (created_at, updated_at) aos models.
    Uso: class MyModel(Base, TimestampMixin): ...
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        onupdate=func.now(),
        nullable=True,
    )
