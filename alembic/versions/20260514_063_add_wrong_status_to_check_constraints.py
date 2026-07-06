"""service_orders: add 'wrong' to status check constraints

Revision ID: 20260514_063
Revises: 20260513_062
Create Date: 2026-05-14
"""

from alembic import op

revision = "20260514_063"
down_revision = "20260513_062"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS ck_service_orders_status")
    op.execute(
        "ALTER TABLE service_orders ADD CONSTRAINT ck_service_orders_status "
        "CHECK (status IN ('waiting', 'in_progress', 'quality_check', 'completed', 'delivered', 'cancelled', 'wrong'))"
    )

    op.execute("ALTER TABLE status_history DROP CONSTRAINT IF EXISTS ck_status_history_from_status")
    op.execute(
        "ALTER TABLE status_history ADD CONSTRAINT ck_status_history_from_status "
        "CHECK (from_status IS NULL OR from_status IN ('waiting', 'in_progress', 'quality_check', 'completed', 'delivered', 'cancelled', 'wrong'))"
    )

    op.execute("ALTER TABLE status_history DROP CONSTRAINT IF EXISTS ck_status_history_to_status")
    op.execute(
        "ALTER TABLE status_history ADD CONSTRAINT ck_status_history_to_status "
        "CHECK (to_status IN ('waiting', 'in_progress', 'quality_check', 'completed', 'delivered', 'cancelled', 'wrong'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS ck_service_orders_status")
    op.execute(
        "ALTER TABLE service_orders ADD CONSTRAINT ck_service_orders_status "
        "CHECK (status IN ('waiting', 'in_progress', 'quality_check', 'completed', 'delivered', 'cancelled'))"
    )

    op.execute("ALTER TABLE status_history DROP CONSTRAINT IF EXISTS ck_status_history_from_status")
    op.execute(
        "ALTER TABLE status_history ADD CONSTRAINT ck_status_history_from_status "
        "CHECK (from_status IS NULL OR from_status IN ('waiting', 'in_progress', 'quality_check', 'completed', 'delivered', 'cancelled'))"
    )

    op.execute("ALTER TABLE status_history DROP CONSTRAINT IF EXISTS ck_status_history_to_status")
    op.execute(
        "ALTER TABLE status_history ADD CONSTRAINT ck_status_history_to_status "
        "CHECK (to_status IN ('waiting', 'in_progress', 'quality_check', 'completed', 'delivered', 'cancelled'))"
    )
