"""appointments: add service_ids column

Revision ID: 059_appointments_service_ids
Revises: 058_add_appointments_table
Create Date: 2026-04-30
"""

import sqlalchemy as sa
from alembic import op

revision = "059_appointments_service_ids"
down_revision = "058_add_appointments_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("appointments", sa.Column("service_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("appointments", "service_ids")
