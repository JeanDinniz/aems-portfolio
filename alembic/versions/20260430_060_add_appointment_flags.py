"""appointments: add is_galpon, is_courtesy, is_return flags

Revision ID: 060_add_appointment_flags
Revises: 059_appointments_service_ids
Create Date: 2026-04-30
"""

import sqlalchemy as sa
from alembic import op

revision = "060_add_appointment_flags"
down_revision = "059_appointments_service_ids"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("appointments", sa.Column("is_galpon", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("appointments", sa.Column("is_courtesy", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("appointments", sa.Column("is_return", sa.Boolean(), nullable=False, server_default="false"))


def downgrade() -> None:
    op.drop_column("appointments", "is_return")
    op.drop_column("appointments", "is_courtesy")
    op.drop_column("appointments", "is_galpon")
