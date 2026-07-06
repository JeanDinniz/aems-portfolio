"""add film_roll_id to service_order_items

Revision ID: 053_service_order_items_add_film_roll_id
Revises: 052_film_consumptions
Create Date: 2026-04-24
"""

import sqlalchemy as sa

from alembic import op

revision = "053_so_items_film_roll"
down_revision = "052_film_consumptions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "service_order_items",
        sa.Column("film_roll_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_service_order_items_film_roll_id",
        "service_order_items",
        "film_rolls",
        ["film_roll_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_service_order_items_film_roll_id",
        "service_order_items",
        ["film_roll_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_service_order_items_film_roll_id", table_name="service_order_items")
    op.drop_constraint(
        "fk_service_order_items_film_roll_id", "service_order_items", type_="foreignkey"
    )
    op.drop_column("service_order_items", "film_roll_id")
