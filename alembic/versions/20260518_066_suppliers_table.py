"""create suppliers table

Revision ID: 20260518_066
Revises: 20260518064, 20260518_065
Create Date: 2026-05-18
"""

import sqlalchemy as sa
from alembic import op

revision = "20260518_066"
down_revision = ("20260518064", "20260518_065")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "suppliers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_name", sa.String(200), nullable=False),
        sa.Column("cnpj", sa.String(18), nullable=True),
        sa.Column("responsible", sa.String(200), nullable=True),
        sa.Column("phone", sa.String(20), nullable=True),
        sa.Column("email", sa.String(200), nullable=True),
        sa.Column("address", sa.String(400), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("cnpj", name="uq_suppliers_cnpj"),
    )
    op.create_index(op.f("ix_suppliers_id"), "suppliers", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_suppliers_id"), table_name="suppliers")
    op.drop_table("suppliers")
