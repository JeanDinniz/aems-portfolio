"""add supplier_id FK to film_rolls

Revision ID: 20260518_067
Revises: 20260518_066
Create Date: 2026-05-18
"""

import sqlalchemy as sa
from alembic import op

revision = "20260518_067"
down_revision = "20260518_066"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "film_rolls",
        sa.Column("supplier_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_film_rolls_supplier_id",
        "film_rolls",
        "suppliers",
        ["supplier_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_film_rolls_supplier_id", "film_rolls", type_="foreignkey")
    op.drop_column("film_rolls", "supplier_id")
