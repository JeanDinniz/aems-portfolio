"""epi control: epis, cargo_epis, entrega_epis

Revision ID: 20260805_110
Revises: 20260804_109
Create Date: 2026-08-05
"""

import sqlalchemy as sa
from alembic import op

revision = "20260805_110"
down_revision = "20260804_109"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "epis",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("dias_validade", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("name", name="uq_epis_name"),
    )
    op.create_table(
        "cargo_epis",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cargo", sa.String(length=100), nullable=False),
        sa.Column("epi_id", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["epi_id"], ["epis.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("cargo", "epi_id", name="uq_cargo_epi"),
    )
    op.create_index("ix_cargo_epis_cargo", "cargo_epis", ["cargo"])
    op.create_index("ix_cargo_epis_epi_id", "cargo_epis", ["epi_id"])
    op.create_table(
        "entrega_epis",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("epi_id", sa.Integer(), nullable=False),
        sa.Column("data_entrega", sa.Date(), nullable=False),
        sa.Column("data_vencimento", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="ENTREGUE", nullable=False),
        sa.Column("assinatura_base64", sa.Text(), nullable=False),
        sa.Column("delivered_by_id", sa.Integer(), nullable=True),
        sa.Column("observacao", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["epi_id"], ["epis.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["delivered_by_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_entrega_epis_employee_id", "entrega_epis", ["employee_id"])
    op.create_index("ix_entrega_epis_epi_id", "entrega_epis", ["epi_id"])
    op.create_index("ix_entrega_epis_data_vencimento", "entrega_epis", ["data_vencimento"])


def downgrade() -> None:
    op.drop_table("entrega_epis")
    op.drop_table("cargo_epis")
    op.drop_table("epis")
