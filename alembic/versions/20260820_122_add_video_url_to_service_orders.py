"""add video_url to service_orders

Revision ID: 20260820_122
Revises: 20260817_121
Create Date: 2026-08-20

"""

import sqlalchemy as sa
from alembic import op

revision = "20260820_122"
down_revision = "20260817_121"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "service_orders",
        sa.Column("video_url", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("service_orders", "video_url")
