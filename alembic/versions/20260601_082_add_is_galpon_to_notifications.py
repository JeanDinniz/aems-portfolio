"""add is_galpon to notifications

Revision ID: 20260601_082
Revises: 20260528_081
Create Date: 2026-06-01

"""

import sqlalchemy as sa
from alembic import op

revision = "20260601_082"
down_revision = "20260528_081"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notifications",
        sa.Column(
            "is_galpon",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    op.drop_column("notifications", "is_galpon")
