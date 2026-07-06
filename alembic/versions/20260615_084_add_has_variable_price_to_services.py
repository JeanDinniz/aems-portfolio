"""add has_variable_price to services

Revision ID: 20260615_084
Revises: 20260610_083
Create Date: 2026-06-15

"""

import sqlalchemy as sa
from alembic import op

revision = "20260615_084"
down_revision = "20260610_083"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "services",
        sa.Column("has_variable_price", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("services", "has_variable_price")
