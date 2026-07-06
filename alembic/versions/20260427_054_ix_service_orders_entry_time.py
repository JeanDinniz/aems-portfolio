"""add index on service_orders.entry_time

Revision ID: 054_ix_service_orders_entry_time
Revises: 053_service_order_items_add_film_roll_id
Create Date: 2026-04-27
"""

from alembic import op

revision = "054_ix_service_orders_entry_time"
down_revision = "053_so_items_film_roll"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_service_orders_entry_time", "service_orders", ["entry_time"])


def downgrade() -> None:
    op.drop_index("ix_service_orders_entry_time", table_name="service_orders")
