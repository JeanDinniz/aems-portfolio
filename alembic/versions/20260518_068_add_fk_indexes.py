"""add indexes to foreign key columns without index

Revision ID: 20260518_068
Revises: 20260518_067
Create Date: 2026-05-18
"""

from alembic import op

revision = "20260518_068"
down_revision = "20260518_067"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # service_orders: FKs sem índice
    op.create_index(
        "ix_service_orders_consultant_id",
        "service_orders",
        ["consultant_id"],
        unique=False,
    )
    op.create_index(
        "ix_service_orders_created_by_id",
        "service_orders",
        ["created_by_id"],
        unique=False,
    )

    # service_order_items: service_id sem índice
    op.create_index(
        "ix_service_order_items_service_id",
        "service_order_items",
        ["service_id"],
        unique=False,
    )

    # service_order_workers: employee_id sem índice
    op.create_index(
        "ix_service_order_workers_employee_id",
        "service_order_workers",
        ["employee_id"],
        unique=False,
    )

    # status_history: changed_by_id sem índice
    op.create_index(
        "ix_status_history_changed_by_id",
        "status_history",
        ["changed_by_id"],
        unique=False,
    )

    # film_rolls: supplier_id adicionado na 067 sem índice
    op.create_index(
        "ix_film_rolls_supplier_id",
        "film_rolls",
        ["supplier_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_film_rolls_supplier_id", table_name="film_rolls")
    op.drop_index("ix_status_history_changed_by_id", table_name="status_history")
    op.drop_index("ix_service_order_workers_employee_id", table_name="service_order_workers")
    op.drop_index("ix_service_order_items_service_id", table_name="service_order_items")
    op.drop_index("ix_service_orders_created_by_id", table_name="service_orders")
    op.drop_index("ix_service_orders_consultant_id", table_name="service_orders")
