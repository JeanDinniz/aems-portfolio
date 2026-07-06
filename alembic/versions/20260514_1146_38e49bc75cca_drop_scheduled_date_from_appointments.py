"""drop_scheduled_date_from_appointments

Revision ID: 38e49bc75cca
Revises: 20260514_063
Create Date: 2026-05-14
"""

import sqlalchemy as sa
from alembic import op

revision = "38e49bc75cca"
down_revision = "20260514_063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("appointments", "scheduled_date")


def downgrade() -> None:
    op.add_column(
        "appointments",
        sa.Column("scheduled_date", sa.Date(), nullable=True),
    )
    op.execute("UPDATE appointments SET scheduled_date = delivery_date WHERE scheduled_date IS NULL")
    op.alter_column("appointments", "scheduled_date", nullable=False)
