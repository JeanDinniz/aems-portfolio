"""add completion_photos to service_orders

Revision ID: 20260515_039
Revises: 38e49bc75cca
Create Date: 2026-05-15
"""

import sqlalchemy as sa
from alembic import op

revision = "20260515_039"
down_revision = "38e49bc75cca"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "service_orders",
        sa.Column("completion_photos", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("service_orders", "completion_photos")
