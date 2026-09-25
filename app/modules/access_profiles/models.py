"""
Access Profile models - Perfis de Acesso configuráveis por usuário.

Substitui o sistema de roles fixos (supervisor/operator) por perfis
flexíveis com permissões granulares por módulo e loja.
"""

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    ForeignKey,
    Integer,
    String,
    Table,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

# ---------------------------------------------------------------------------
# Tabelas associativas (M:N)
# ---------------------------------------------------------------------------

access_profile_stores = Table(
    "access_profile_stores",
    Base.metadata,
    Column(
        "profile_id",
        Integer,
        ForeignKey("access_profiles.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "store_id",
        Integer,
        ForeignKey("stores.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)

access_profile_users = Table(
    "access_profile_users",
    Base.metadata,
    Column(
        "profile_id",
        Integer,
        ForeignKey("access_profiles.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


# ---------------------------------------------------------------------------
# Modelo principal
# ---------------------------------------------------------------------------


class AccessProfile(Base, TimestampMixin):
    """
    Perfil de Acesso configurável.

    Um perfil agrupa permissões de módulos e lojas. Usuários com role='user'
    recebem acesso apenas via perfis ativos aos quais estão vinculados.
    Usuários com role='owner' ignoram perfis e têm acesso total.
    """

    __tablename__ = "access_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, index=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # True quando o perfil opera com OS do tipo galpão (instalação em veículos novos)
    is_galpon_profile: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # True quando o checkbox Galpão deve ser ocultado no lançamento de OS
    # Só tem efeito quando is_galpon_profile=False
    hide_galpon_option: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )

    # Departamentos visíveis no módulo de Agendamentos. Lista vazia = sem
    # restrição (vê todos). Ex.: ["security_film"] restringe a Película de Segurança.
    scheduling_departments: Mapped[list[str]] = mapped_column(
        JSON, default=list, nullable=False, server_default="[]"
    )

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Relacionamentos
    permissions: Mapped[list["AccessProfileModulePermission"]] = relationship(
        "AccessProfileModulePermission",
        back_populates="profile",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    stores: Mapped[list["Store"]] = relationship(  # noqa: F821
        "Store",
        secondary=access_profile_stores,
        lazy="selectin",
    )

    users: Mapped[list["User"]] = relationship(  # noqa: F821
        "User",
        secondary=access_profile_users,
        lazy="selectin",
        overlaps="access_profiles",
    )

    def __repr__(self) -> str:
        return f"<AccessProfile {self.name} (active={self.is_active})>"


class AccessProfileModulePermission(Base):
    """
    Permissão de módulo dentro de um perfil de acesso.

    Cada registro define quais operações (view/edit/delete) um perfil
    pode realizar em um sub-módulo específico.
    """

    __tablename__ = "access_profile_module_permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("access_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    module_group: Mapped[str] = mapped_column(String(20), nullable=False)  # ADM ou OPERACIONAL
    sub_module: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # users, stores, service_orders, etc.

    can_view: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_edit: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    can_delete: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Relacionamento
    profile: Mapped["AccessProfile"] = relationship("AccessProfile", back_populates="permissions")

    __table_args__ = (
        UniqueConstraint("profile_id", "sub_module", name="uq_apmp_profile_sub_module"),
    )

    def __repr__(self) -> str:
        return (
            f"<AccessProfileModulePermission profile={self.profile_id} "
            f"sub_module={self.sub_module}>"
        )
