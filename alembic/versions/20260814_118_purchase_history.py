"""purchase history: material_requests.source + material_purchase_lines

Suporte à importação do histórico de compras da planilha (aba "E") como Pedidos
de Material fiéis, sem criar bobina no Estoque nem card de EPI. Aditivo.

Revision ID: 20260814_118
Revises: 20260814_117
Create Date: 2026-08-14
"""

import sqlalchemy as sa
from alembic import op

revision = "20260814_118"
down_revision = "20260814_117"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "material_requests",
        sa.Column("source", sa.String(length=20), server_default="app", nullable=False),
    )
    op.create_index("ix_material_requests_source", "material_requests", ["source"])

    op.create_table(
        "material_purchase_lines",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("material_name", sa.String(length=200), nullable=False),
        sa.Column("tonality", sa.String(length=20), nullable=True),
        sa.Column("quantity", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("supplier", sa.String(length=200), nullable=True),
        sa.Column("nfe_number", sa.String(length=100), nullable=True),
        sa.Column("cost", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("lot_number", sa.String(length=100), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["request_id"], ["material_requests.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_material_purchase_lines_request_id", "material_purchase_lines", ["request_id"]
    )


def downgrade() -> None:
    op.drop_table("material_purchase_lines")
    op.drop_index("ix_material_requests_source", table_name="material_requests")
    op.drop_column("material_requests", "source")
