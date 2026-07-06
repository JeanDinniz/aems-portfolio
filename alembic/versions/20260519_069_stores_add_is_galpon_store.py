"""stores_add_is_galpon_store

Revision ID: 20260519_069
Revises: 20260518_068
Create Date: 2026-05-19
"""

import sqlalchemy as sa
from alembic import op

revision = "20260519_069"
down_revision = "20260518_068"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "stores",
        sa.Column(
            "is_galpon_store",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    op.drop_column("stores", "is_galpon_store")
