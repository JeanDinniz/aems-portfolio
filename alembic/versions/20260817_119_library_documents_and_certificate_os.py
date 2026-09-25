"""Biblioteca (library_documents) + campos de O.S./foto no certificado; drop ebook_items

HML-237: substitui os verbetes do e-book por uma biblioteca de arquivos
(library_documents, categorias operacional/apresentacoes). HML-236: estende
certificates com vínculo à O.S. (service_order_id/os_number) e a foto do
certificado assinado (signed_photo_url).

Revision ID: 20260817_119
Revises: 20260814_118
Create Date: 2026-08-17
"""

import sqlalchemy as sa

from alembic import op

revision = "20260817_119"
down_revision = "20260814_118"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- HML-237: biblioteca de documentos ---
    op.create_table(
        "library_documents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("category", sa.String(length=30), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("file_url", sa.String(length=500), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_type", sa.String(length=100), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column("uploaded_by_id", sa.Integer(), nullable=True),
        sa.Column("uploaded_by_name", sa.String(length=200), nullable=True),
        sa.Column("display_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_library_documents_category", "library_documents", ["category"])
    op.create_index("ix_library_documents_uploaded_by_id", "library_documents", ["uploaded_by_id"])
    op.create_index(
        "ix_library_documents_category_order", "library_documents", ["category", "display_order"]
    )

    # Aposenta os verbetes (substituídos pela biblioteca)
    op.drop_index("ix_ebook_items_category_order", table_name="ebook_items")
    op.drop_index("ix_ebook_items_slug", table_name="ebook_items")
    op.drop_index("ix_ebook_items_category", table_name="ebook_items")
    op.drop_table("ebook_items")

    # --- HML-236: certificados vinculados à O.S. + foto assinada ---
    op.add_column("certificates", sa.Column("service_order_id", sa.Integer(), nullable=True))
    op.add_column("certificates", sa.Column("os_number", sa.String(length=100), nullable=True))
    op.add_column(
        "certificates", sa.Column("signed_photo_url", sa.String(length=500), nullable=True)
    )
    op.create_index("ix_certificates_service_order_id", "certificates", ["service_order_id"])
    op.create_foreign_key(
        "fk_certificates_service_order_id",
        "certificates",
        "service_orders",
        ["service_order_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_certificates_service_order_id", "certificates", type_="foreignkey")
    op.drop_index("ix_certificates_service_order_id", table_name="certificates")
    op.drop_column("certificates", "signed_photo_url")
    op.drop_column("certificates", "os_number")
    op.drop_column("certificates", "service_order_id")

    op.create_table(
        "ebook_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("category", sa.String(length=30), nullable=False),
        sa.Column("group", sa.String(length=30), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("slug", sa.String(length=220), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("benefits", sa.JSON(), nullable=True),
        sa.Column("sales_approach", sa.Text(), nullable=True),
        sa.Column("sales_faq", sa.JSON(), nullable=True),
        sa.Column("sales_closing", sa.Text(), nullable=True),
        sa.Column("procedure", sa.JSON(), nullable=True),
        sa.Column("care_notes", sa.Text(), nullable=True),
        sa.Column("durability", sa.String(length=120), nullable=True),
        sa.Column("technical_data", sa.JSON(), nullable=True),
        sa.Column("security_scenarios", sa.JSON(), nullable=True),
        sa.Column("cover_photo_url", sa.String(length=500), nullable=True),
        sa.Column("photos", sa.JSON(), nullable=True),
        sa.Column("display_order", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_ebook_items_category", "ebook_items", ["category"])
    op.create_index("ix_ebook_items_slug", "ebook_items", ["slug"], unique=True)
    op.create_index("ix_ebook_items_category_order", "ebook_items", ["category", "display_order"])

    op.drop_index("ix_library_documents_category_order", table_name="library_documents")
    op.drop_index("ix_library_documents_uploaded_by_id", table_name="library_documents")
    op.drop_index("ix_library_documents_category", table_name="library_documents")
    op.drop_table("library_documents")
