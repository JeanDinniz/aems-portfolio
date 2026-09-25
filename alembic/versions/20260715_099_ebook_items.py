"""Módulo E-book: tabela ebook_items (verbetes técnico/comercial por serviço).

Verbete único por serviço/produto, reunindo o lado técnico (procedimento, dados
técnicos, cuidados) e o comercial (descrição, benefícios, script de venda).
Listas em JSON genérico. Conteúdo global (não filtra por loja).

Revision ID: 20260715_099
Revises: 20260714_098
Create Date: 2026-07-15
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260715_099"
down_revision = "20260714_098"
branch_labels = None
depends_on = None


def upgrade() -> None:
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
    op.create_index(
        "ix_ebook_items_category_order", "ebook_items", ["category", "display_order"]
    )


def downgrade() -> None:
    op.drop_index("ix_ebook_items_category_order", table_name="ebook_items")
    op.drop_index("ix_ebook_items_slug", table_name="ebook_items")
    op.drop_index("ix_ebook_items_category", table_name="ebook_items")
    op.drop_table("ebook_items")
