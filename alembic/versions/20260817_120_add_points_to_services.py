"""add points to services

Revision ID: 20260817_120
Revises: 20260817_119
Create Date: 2026-08-17

"""

import sqlalchemy as sa
from alembic import op

revision = "20260817_120"
down_revision = "20260817_119"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "services",
        sa.Column("points", sa.Numeric(6, 2), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("services", "points")
