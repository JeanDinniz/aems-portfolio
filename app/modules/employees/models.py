"""
Employee model - Represents a physical employee who works at a store.
Employees do NOT have system login; they are tracked for service order assignment.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Employee(Base, TimestampMixin):
    """
    Modelo de Funcionário.
    Representa um funcionário que trabalha em uma loja fazendo os carros.
    Funcionários NÃO possuem acesso ao sistema (sem login).
    """

    __tablename__ = "employees"
    __table_args__ = (UniqueConstraint("name", "store_id", name="uq_employee_name_store"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    department: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    position: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # HML-126: Funcionário Volante — aparece em todas as lojas quando True
    is_volante: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )

    # HML-128: Funcionário do Galpão
    works_in_galpon: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )

    # HML-58: Dados pessoais e operacionais
    entry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    pix_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    bank_account: Mapped[str | None] = mapped_column(String(200), nullable=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    transport_allowance: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)

    # HML-73: Dados de RH
    dismissal_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    dismissal_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    would_rehire: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    vacation_month: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

    # Novos campos de RH
    last_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    hr_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="active", server_default="active", index=True
    )

    # Relationships
    store: Mapped["Store"] = relationship(  # noqa: F821
        "Store", back_populates="employees"
    )
    movements: Mapped[list["EmployeeMovement"]] = relationship(
        "EmployeeMovement",
        back_populates="employee",
        cascade="all, delete-orphan",
        lazy="noload",
    )

    @property
    def is_active_computed(self) -> bool:
        return self.hr_status == "active"

    def __repr__(self) -> str:
        return f"<Employee {self.name} (store_id={self.store_id})>"


class EmployeeMovement(Base):
    """
    Registra movimentações de RH de um funcionário.
    Tipos: transfer | vacation | absence | fault | promotion | dismissal
    """

    __tablename__ = "employee_movements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    employee_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    movement_date: Mapped[date] = mapped_column(Date, nullable=False)
    movement_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    attachment_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    employee: Mapped["Employee"] = relationship("Employee", back_populates="movements")
    created_by: Mapped[Optional["User"]] = relationship(  # noqa: F821
        "User", foreign_keys=[created_by_id]
    )
