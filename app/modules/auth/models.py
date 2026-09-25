"""
Auth models - User, UserStoreSupervision, AccessLog.
"""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class User(Base, TimestampMixin):
    """
    Modelo de Usuário.
    Representa um usuário do sistema com role específico.
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # owner (acesso total) | user (acesso via perfis)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)

    # Login security
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Loja direta do usuário (vínculo a uma única loja; acesso amplo vem dos perfis)
    store_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("stores.id"), nullable=True)
    store: Mapped["Store"] = relationship(  # noqa: F821
        "Store", back_populates="users", foreign_keys=[store_id]
    )

    # Access profiles (many-to-many via access_profile_users)
    access_profiles: Mapped[list["AccessProfile"]] = relationship(  # noqa: F821
        "AccessProfile",
        secondary=lambda: Base.metadata.tables["access_profile_users"],
        lazy="selectin",
        overlaps="users",
    )

    @property
    def supervised_stores(self) -> list:
        """
        Legacy stub — supervision was removed in migration 039.
        Returns empty list so existing code that checks supervised_stores
        continues to work without AttributeError.
        """
        return []

    def __repr__(self) -> str:
        return f"<User {self.email} ({self.role})>"


class AccessLog(Base):
    """
    Log de acessos ao sistema.
    Registra login, logout, tentativas falhas, etc.
    """

    __tablename__ = "access_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # login, logout, login_failed, password_change
    resource: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, default=True)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationship
    user: Mapped["User"] = relationship("User")

    def __repr__(self) -> str:
        return f"<AccessLog {self.action} user_id={self.user_id}>"
