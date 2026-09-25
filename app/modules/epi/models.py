"""Models do módulo de EPI: catálogo, mapeamento por cargo e ficha de entrega."""

from datetime import date as date_type

from sqlalchemy import (
    Boolean,
    Date,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class EPI(Base, TimestampMixin):
    """Catálogo de EPIs (ex: Protetor Auricular, Bota)."""

    __tablename__ = "epis"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    dias_validade: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    def __repr__(self) -> str:
        return f"<EPI {self.name} ({self.dias_validade}d)>"


class CargoEPI(Base, TimestampMixin):
    """Mapeia um cargo (Employee.position) a um EPI obrigatório."""

    __tablename__ = "cargo_epis"
    __table_args__ = (UniqueConstraint("cargo", "epi_id", name="uq_cargo_epi"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    cargo: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    epi_id: Mapped[int] = mapped_column(
        ForeignKey("epis.id", ondelete="CASCADE"), nullable=False, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    epi: Mapped["EPI"] = relationship("EPI", lazy="selectin")

    def __repr__(self) -> str:
        return f"<CargoEPI {self.cargo} -> epi_id={self.epi_id}>"


class EntregaEPI(Base, TimestampMixin):
    """Ficha de entrega (histórico). Uma linha por entrega."""

    __tablename__ = "entrega_epis"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    epi_id: Mapped[int] = mapped_column(
        ForeignKey("epis.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    data_entrega: Mapped[date_type] = mapped_column(Date, nullable=False)
    data_vencimento: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="ENTREGUE", server_default="ENTREGUE"
    )
    assinatura_base64: Mapped[str] = mapped_column(Text, nullable=False)
    delivered_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    observacao: Mapped[str | None] = mapped_column(Text, nullable=True)

    employee: Mapped["Employee"] = relationship("Employee", lazy="selectin")  # noqa: F821
    epi: Mapped["EPI"] = relationship("EPI", lazy="selectin")

    def __repr__(self) -> str:
        return f"<EntregaEPI emp={self.employee_id} epi={self.epi_id} {self.status}>"
