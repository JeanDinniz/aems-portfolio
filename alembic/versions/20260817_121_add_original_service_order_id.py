"""add original_service_order_id to service_orders

Revision ID: 20260817_121
Revises: 20260817_120
Create Date: 2026-08-17

"""

import sqlalchemy as sa
from alembic import op

revision = "20260817_121"
down_revision = "20260817_120"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "service_orders",
        sa.Column("original_service_order_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_service_orders_original_service_order_id",
        "service_orders",
        ["original_service_order_id"],
    )
    op.create_foreign_key(
        "fk_service_orders_original",
        "service_orders",
        "service_orders",
        ["original_service_order_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_service_orders_original", "service_orders", type_="foreignkey")
    op.drop_index("ix_service_orders_original_service_order_id", table_name="service_orders")
    op.drop_column("service_orders", "original_service_order_id")
