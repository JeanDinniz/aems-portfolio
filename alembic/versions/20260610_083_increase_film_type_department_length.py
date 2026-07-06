"""increase film_type department column length to 20

Revision ID: 20260610_083
Revises: 20260601_082
Create Date: 2026-06-10

"""

import sqlalchemy as sa
from alembic import op

revision = "20260610_083"
down_revision = "20260601_082"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "film_types",
        "department",
        existing_type=sa.String(10),
        type_=sa.String(20),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "film_types",
        "department",
        existing_type=sa.String(20),
        type_=sa.String(10),
        existing_nullable=False,
    )
