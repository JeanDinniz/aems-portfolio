"""film_rolls: add cost and lot_number columns

Revision ID: 20260518064
Revises: 20260515_039
Create Date: 2026-05-18
"""

import sqlalchemy as sa
from alembic import op

revision = "20260518064"
down_revision = "20260515_039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("film_rolls", sa.Column("cost", sa.Numeric(10, 2), nullable=True))
    op.add_column("film_rolls", sa.Column("lot_number", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("film_rolls", "lot_number")
    op.drop_column("film_rolls", "cost")
