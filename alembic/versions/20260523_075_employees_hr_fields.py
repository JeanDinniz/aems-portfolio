"""employees hr fields

Revision ID: 20260523_075
Revises: 20260523_074
Create Date: 2026-05-23
"""

import sqlalchemy as sa

from alembic import op

revision = "20260523_075"
down_revision = "20260523_074"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("dismissal_date", sa.Date(), nullable=True))
    op.add_column(
        "employees",
        sa.Column("dismissal_reason", sa.String(500), nullable=True),
    )
    op.add_column("employees", sa.Column("would_rehire", sa.Boolean(), nullable=True))
    op.add_column(
        "employees",
        sa.Column("vacation_month", sa.SmallInteger(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("employees", "vacation_month")
    op.drop_column("employees", "would_rehire")
    op.drop_column("employees", "dismissal_reason")
    op.drop_column("employees", "dismissal_date")
