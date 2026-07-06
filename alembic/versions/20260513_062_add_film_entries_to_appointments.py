"""appointments: add film_entries JSON column for structured film entries

Revision ID: 20260513_062
Revises: 20260430_061
Create Date: 2026-05-13
"""

import sqlalchemy as sa
from alembic import op

revision = "20260513_062"
down_revision = "20260430_061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "appointments",
        sa.Column("film_entries", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("appointments", "film_entries")
