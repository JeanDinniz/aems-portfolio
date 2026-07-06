"""add category and execution_time_minutes to services

Revision ID: 20260518_065
Revises: 20260515_039
Create Date: 2026-05-18
"""

import sqlalchemy as sa
from alembic import op

revision = "20260518_065"
down_revision = "20260515_039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "services",
        sa.Column("category", sa.String(30), nullable=True),
    )
    op.add_column(
        "services",
        sa.Column("execution_time_minutes", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("services", "execution_time_minutes")
    op.drop_column("services", "category")
