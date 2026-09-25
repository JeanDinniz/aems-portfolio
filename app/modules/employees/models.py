"""
Employee model - Represents a physical employee who works at a store.
Employees podem opcionalmente ser vinculados a um User (user_id) para
funcionalidades como o Ponto Eletrônico; a maioria não tem login.
"""

from datetime import date, datetime, time
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
    Time,
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
    # CPF do funcionário (só dígitos) — necessário para os arquivos fiscais do
    # ponto (AFD/AEJ, marcação tipo 7 exige o CPF do trabalhador — Portaria 671).
    cpf: Mapped[str | None] = mapped_column(String(11), nullable=True)
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

    # Ponto Eletrônico: vínculo 1:1 com o usuário de login (unique) e horário
    # de trabalho individual (null = usa o default 08:00/18:00 do módulo)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, unique=True
    )
    work_start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    work_end_time: Mapped[time | None] = mapped_column(Time, nullable=True)

    # Ponto Eletrônico — reconhecimento facial 1:1 (embeddings no aparelho).
    # `face_embedding` é o VETOR de referência do rosto gerado no app (a imagem
    # crua NÃO é armazenada aqui — só o vetor). `face_enrolled_at` = quando foi
    # cadastrado; `face_consent_at` = consentimento LGPD para uso do dado biométrico.
    face_embedding: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)
    face_enrolled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    face_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    store: Mapped["Store"] = relationship(  # noqa: F821
        "Store", back_populates="employees"
    )
    user: Mapped["User | None"] = relationship("User", lazy="selectin")  # noqa: F821
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
