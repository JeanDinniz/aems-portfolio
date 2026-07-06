"""employees volante galpon

Revision ID: 20260523_073
Revises: 20260522_072
Create Date: 2026-05-23
"""

import sqlalchemy as sa

from alembic import op

revision = "20260523_073"
down_revision = "20260522_072"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "employees",
        sa.Column(
            "is_volante",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    op.add_column(
        "employees",
        sa.Column(
            "works_in_galpon",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    op.drop_column("employees", "works_in_galpon")
    op.drop_column("employees", "is_volante")
