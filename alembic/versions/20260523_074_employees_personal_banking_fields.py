"""employees personal banking fields

Revision ID: 20260523_074
Revises: 20260523_073
Create Date: 2026-05-23
"""

import sqlalchemy as sa

from alembic import op

revision = "20260523_074"
down_revision = "20260523_073"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("entry_date", sa.Date(), nullable=True))
    op.add_column("employees", sa.Column("phone", sa.String(20), nullable=True))
    op.add_column("employees", sa.Column("email", sa.String(200), nullable=True))
    op.add_column("employees", sa.Column("pix_key", sa.String(200), nullable=True))
    op.add_column("employees", sa.Column("bank_account", sa.String(200), nullable=True))
    op.add_column("employees", sa.Column("address", sa.String(500), nullable=True))
    op.add_column(
        "employees",
        sa.Column("transport_allowance", sa.Numeric(10, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("employees", "transport_allowance")
    op.drop_column("employees", "address")
    op.drop_column("employees", "bank_account")
    op.drop_column("employees", "pix_key")
    op.drop_column("employees", "email")
    op.drop_column("employees", "phone")
    op.drop_column("employees", "entry_date")
