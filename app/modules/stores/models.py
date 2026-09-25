"""
Store model - Represents a physical store location.
"""

from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Store(Base, TimestampMixin):
    """
    Modelo de Loja.
    Representa uma das 12 lojas da rede de estética automotiva.
    """

    __tablename__ = "stores"
    __table_args__ = (UniqueConstraint("name", "brand_id", name="uq_store_name_brand"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(
        String(10), unique=True, nullable=False, index=True
    )  # Ex: LJ01, LJ02
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_galpon_store: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )
    has_shared_inventory: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )
    dealership_brand: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )  # Mantido por compatibilidade — use brand_id (FK) como referência principal
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id"), nullable=False, index=True)

    # Ponto Eletrônico: coordenadas da loja para o geofence (null = sem geofence;
    # a batida nunca é bloqueada, apenas sinalizada como fora do raio)
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6), nullable=True)
    geofence_radius_m: Mapped[int] = mapped_column(
        Integer, nullable=False, default=200, server_default="200"
    )

    # Relationships
    brand: Mapped["Brand"] = relationship(  # noqa: F821
        "Brand", back_populates="stores", lazy="selectin"
    )
    users: Mapped[list["User"]] = relationship(  # noqa: F821
        "User", back_populates="store", foreign_keys="User.store_id"
    )
    dealerships: Mapped[list["Dealership"]] = relationship(  # noqa: F821
        "Dealership", back_populates="store", cascade="all, delete-orphan"
    )
    consultants: Mapped[list["Consultant"]] = relationship(  # noqa: F821
        "Consultant", back_populates="store"
    )
    service_orders: Mapped[list["ServiceOrder"]] = relationship(  # noqa: F821
        "ServiceOrder", back_populates="store", foreign_keys="ServiceOrder.store_id"
    )
    employees: Mapped[list["Employee"]] = relationship(  # noqa: F821
        "Employee", back_populates="store"
    )
    inventory_links: Mapped[list["StoreInventoryLink"]] = relationship(
        "StoreInventoryLink",
        foreign_keys="StoreInventoryLink.store_id",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<Store {self.code}: {self.name}>"


class StoreInventoryLink(Base):
    """
    Vínculo de estoque compartilhado entre duas lojas.

    Quando a loja A compartilha estoque com a loja B, dois registros são criados:
      - store_id=A, linked_store_id=B
      - store_id=B, linked_store_id=A

    Isso permite que a consulta de bobinas de qualquer das lojas retorne
    também as bobinas das parceiras.
    """

    __tablename__ = "store_inventory_links"
    __table_args__ = (
        UniqueConstraint("store_id", "linked_store_id", name="uq_store_inventory_link"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
    linked_store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True
    )
