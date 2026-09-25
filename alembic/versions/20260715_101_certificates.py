"""Certificados de garantia emitidos (histórico).

Guarda os dados de cada certificado gerado no e-book (quem, quando e os dados do
veículo/cliente). O PDF é regerado sob demanda a partir destes campos.

Revision ID: 20260715_101
Revises: 20260715_100
Create Date: 2026-07-15
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260715_101"
down_revision = "20260715_100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "certificates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "created_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_by_name", sa.String(length=200), nullable=True),
        sa.Column("brand_code", sa.String(length=30), nullable=False),
        sa.Column("brand_name", sa.String(length=100), nullable=True),
        sa.Column(
            "store_id",
            sa.Integer(),
            sa.ForeignKey("stores.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("store_name", sa.String(length=100), nullable=True),
        sa.Column("store_address", sa.String(length=500), nullable=True),
        sa.Column("plate", sa.String(length=30), nullable=True),
        sa.Column("customer_name", sa.String(length=200), nullable=True),
        sa.Column("model", sa.String(length=100), nullable=True),
        sa.Column("color", sa.String(length=50), nullable=True),
        sa.Column("invoice_number", sa.String(length=100), nullable=True),
        sa.Column("chassi", sa.String(length=50), nullable=True),
        sa.Column("service_name", sa.String(length=100), nullable=False),
        sa.Column("warranty_months", sa.Integer(), nullable=False),
        sa.Column("issue_date", sa.Date(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_certificates_created_by_id", "certificates", ["created_by_id"])
    op.create_index("ix_certificates_store_id", "certificates", ["store_id"])
    op.create_index("ix_certificates_created_at", "certificates", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_certificates_created_at", table_name="certificates")
    op.drop_index("ix_certificates_store_id", table_name="certificates")
    op.drop_index("ix_certificates_created_by_id", table_name="certificates")
    op.drop_table("certificates")
