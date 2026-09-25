"""
Modelos do módulo E-book / Biblioteca.

- ``LibraryDocument``: arquivo da biblioteca (Operacional / Apresentações) para a
  equipe visualizar, baixar e imprimir. O arquivo em si (PDF, apresentação) fica
  no storage (S3/MinIO ou ``uploads/``); aqui guardamos só os metadados e a URL.
- ``Certificate``: certificado de garantia emitido (histórico). Guarda os DADOS
  de cada certificado gerado — não o PDF, que é regerado sob demanda a partir
  destes campos, sempre no template atual.
"""

from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class LibraryDocument(Base, TimestampMixin):
    """
    Documento da biblioteca (conteúdo global, não filtrado por loja).

    Categorias: ``operacional`` | ``apresentacoes``.
    """

    __tablename__ = "library_documents"

    id: Mapped[int] = mapped_column(primary_key=True)

    # category: "operacional" | "apresentacoes"
    category: Mapped[str] = mapped_column(String(30), nullable=False, index=True)

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Arquivo (metadados; o binário fica no storage)
    file_url: Mapped[str] = mapped_column(String(500), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[str | None] = mapped_column(String(100), nullable=True)  # mime/extensão
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)  # bytes

    # Autoria (snapshot preservado mesmo se o usuário for removido)
    uploaded_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    uploaded_by_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    __table_args__ = (Index("ix_library_documents_category_order", "category", "display_order"),)

    def __repr__(self) -> str:
        return f"<LibraryDocument {self.category}:{self.title}>"


class Certificate(Base, TimestampMixin):
    """
    Certificado de Garantia emitido (histórico).

    Guarda os DADOS de cada certificado gerado no e-book — não o arquivo. O PDF é
    regerado sob demanda a partir destes campos, sempre no template atual. Os
    campos de snapshot (created_by_name, store_name, store_address) preservam o
    histórico mesmo que o usuário/loja seja alterado ou removido depois.
    """

    __tablename__ = "certificates"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Autoria: SET NULL ao excluir o usuário; o nome fica preservado no snapshot
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_by_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Vínculo opcional com a O.S. que originou o certificado (SET NULL preserva
    # o histórico); ``os_number`` guarda o número (externo) como snapshot textual.
    service_order_id: Mapped[int | None] = mapped_column(
        ForeignKey("service_orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    os_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Marca / Loja (snapshots para o PDF e a listagem)
    brand_code: Mapped[str] = mapped_column(String(30), nullable=False)
    brand_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    store_id: Mapped[int | None] = mapped_column(
        ForeignKey("stores.id", ondelete="SET NULL"), nullable=True, index=True
    )
    store_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    store_address: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Veículo / cliente
    plate: Mapped[str | None] = mapped_column(String(30), nullable=True)
    customer_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    color: Mapped[str | None] = mapped_column(String(50), nullable=True)
    invoice_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    chassi: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Parâmetros do certificado
    service_name: Mapped[str] = mapped_column(
        String(100), nullable=False, default="Vitrificação de Pintura"
    )
    warranty_months: Mapped[int] = mapped_column(Integer, nullable=False, default=12)
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Foto do certificado impresso e assinado pelo cliente (URL no storage)
    signed_photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    __table_args__ = (Index("ix_certificates_created_at", "created_at"),)

    def __repr__(self) -> str:
        return f"<Certificate {self.id}: {self.plate} {self.customer_name}>"
