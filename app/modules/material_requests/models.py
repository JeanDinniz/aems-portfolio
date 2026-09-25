"""Models do módulo de Pedidos de Material.

Um ``MaterialRequest`` é um pedido lançado por loja/data. Ele agrupa:
- bobinas de película (``FilmRoll``) criadas na hora do pedido (dão entrada no
  Estoque imediatamente — vinculadas via ``FilmRoll.material_request_id``);
- linhas de ferramenta/insumo (``MaterialRequestTool``, texto livre).

Sem status: o pedido é o próprio momento de entrada (não há pendente→recebido).
"""

from datetime import date as date_type
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class MaterialRequest(Base, TimestampMixin):
    """Pedido de material de uma loja em uma data."""

    __tablename__ = "material_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    store_id: Mapped[int] = mapped_column(
        ForeignKey("stores.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    request_date: Mapped[date_type] = mapped_column(Date, nullable=False, index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Segue o padrão de Appointment/Notification para os filtros de galpão.
    is_galpon: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Origem do pedido: "app" (operação normal) ou "planilha" (histórico importado).
    # Pedidos "planilha" NÃO criam bobina/estoque nem card — só registram compras.
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="app", server_default="app", index=True
    )
    # Cancelamento (soft-delete): o pedido NUNCA some — fica visível como
    # "cancelled" com o motivo. "active" = pedido válido.
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="active", server_default="active", index=True
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Edição pós-lançamento: um pedido lançado PODE ser corrigido, mas a edição
    # deixa rastro (selo "EDITADO" no card + entrada na Auditoria com de→para).
    # NULL = nunca editado. Preenchidos na primeira e em cada edição subsequente.
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    edited_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Relationships
    store: Mapped["Store"] = relationship("Store")  # noqa: F821
    created_by: Mapped["User"] = relationship(  # noqa: F821
        "User", foreign_keys=[created_by_user_id]
    )
    edited_by: Mapped["User"] = relationship(  # noqa: F821
        "User", foreign_keys=[edited_by_user_id]
    )
    tools: Mapped[list["MaterialRequestTool"]] = relationship(
        "MaterialRequestTool",
        back_populates="request",
        cascade="all, delete-orphan",
        order_by="MaterialRequestTool.id",
    )
    # Bobinas geradas por este pedido. viewonly: a exclusão do pedido apenas
    # desfaz o vínculo (FilmRoll.material_request_id vira NULL via ondelete),
    # nunca apaga estoque que pode já ter sido consumido.
    film_rolls: Mapped[list["FilmRoll"]] = relationship(  # noqa: F821
        "FilmRoll",
        primaryjoin="MaterialRequest.id == FilmRoll.material_request_id",
        viewonly=True,
        order_by="FilmRoll.id",
    )
    # Linhas de compra histórica (source="planilha"): NÃO viram bobina nem card,
    # só registram a compra (película/ferramenta) para consulta.
    purchase_lines: Mapped[list["MaterialPurchaseLine"]] = relationship(
        "MaterialPurchaseLine",
        back_populates="request",
        cascade="all, delete-orphan",
        order_by="MaterialPurchaseLine.id",
    )

    def __repr__(self) -> str:
        return f"<MaterialRequest #{self.id} store={self.store_id} {self.request_date}>"


class MaterialRequestTool(Base, TimestampMixin):
    """Linha de ferramenta/insumo de um pedido (texto livre)."""

    __tablename__ = "material_request_tools"

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("material_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Funcionário destinatário do item. NULL = item sem dono (não vira card de
    # recebimento no Controle de EPIs). SET NULL ao excluir o funcionário.
    employee_id: Mapped[int | None] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # URL da foto do item no recebimento (upload genérico /upload/photo). NULL
    # para itens ainda não recebidos ou recebimentos históricos sem foto.
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Custo e NF da ferramenta. Nullable no banco (ferramentas antigas não têm),
    # mas obrigatórios na validação Pydantic (MaterialRequestToolCreate) para
    # pedidos novos. Espelha FilmRoll.cost/nfe_number (inventory/models.py).
    cost: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    nfe_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    request: Mapped["MaterialRequest"] = relationship("MaterialRequest", back_populates="tools")
    employee: Mapped["Employee"] = relationship("Employee")  # noqa: F821

    def __repr__(self) -> str:
        return f"<MaterialRequestTool #{self.id} {self.name} x{self.quantity}>"


class ToolReceipt(Base, TimestampMixin):
    """Confirmação assinada de recebimento das ferramentas de um pedido por um
    funcionário (o "card" do Controle de EPIs, uma vez recebido).

    Um card pendente é DERIVADO: cada (request_id, employee_id) distinto entre as
    ``MaterialRequestTool`` com ``employee_id`` preenchido, sem ``ToolReceipt``,
    é um card pendente. Ao confirmar (com assinatura) cria-se este registro.
    """

    __tablename__ = "material_tool_receipts"
    __table_args__ = (
        UniqueConstraint("request_id", "employee_id", name="uq_tool_receipt_request_employee"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("material_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    signature_base64: Mapped[str] = mapped_column(Text, nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    confirmed_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    request: Mapped["MaterialRequest"] = relationship("MaterialRequest")
    employee: Mapped["Employee"] = relationship("Employee")  # noqa: F821

    def __repr__(self) -> str:
        return f"<ToolReceipt #{self.id} req={self.request_id} emp={self.employee_id}>"


class MaterialPurchaseLine(Base, TimestampMixin):
    """Linha de compra histórica importada da planilha (aba "E").

    Registro fiel de uma compra (película OU ferramenta) — preserva fornecedor,
    NF, valor, tonalidade, metros/quantidade, lote e observação. NÃO cria bobina
    no Estoque nem card no Controle de EPIs: é puramente informativo/consulta.
    """

    __tablename__ = "material_purchase_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("material_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # film | tool
    material_name: Mapped[str] = mapped_column(String(200), nullable=False)
    tonality: Mapped[str | None] = mapped_column(String(20), nullable=True)
    quantity: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    supplier: Mapped[str | None] = mapped_column(String(200), nullable=True)
    nfe_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    cost: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    lot_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    request: Mapped["MaterialRequest"] = relationship(
        "MaterialRequest", back_populates="purchase_lines"
    )

    def __repr__(self) -> str:
        return f"<MaterialPurchaseLine #{self.id} {self.kind} {self.material_name}>"
