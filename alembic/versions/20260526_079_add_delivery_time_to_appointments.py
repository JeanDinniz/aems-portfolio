"""add delivery_time to appointments

Revision ID: 20260526_079
Revises: 20260525_078
Create Date: 2026-05-26

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260526_079"
down_revision = "20260525_078"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("appointments", sa.Column("delivery_time", sa.Time(), nullable=True))


def downgrade() -> None:
    op.drop_column("appointments", "delivery_time")
