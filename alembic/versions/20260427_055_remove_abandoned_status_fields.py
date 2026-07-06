"""remove abandoned status fields quality_checklist and delivery_time

Revision ID: 055_remove_abandoned_status_fields
Revises: 054_ix_service_orders_entry_time
Create Date: 2026-04-27
"""

import sqlalchemy as sa
from alembic import op

revision = "055_rm_abandoned_fields"
down_revision = "054_ix_service_orders_entry_time"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # v_day_panel é uma view legada que referencia delivery_time — deve ser removida antes
    op.execute("DROP VIEW IF EXISTS v_day_panel")
    op.drop_column("service_orders", "quality_checklist")
    op.drop_column("service_orders", "delivery_time")


def downgrade() -> None:
    op.add_column(
        "service_orders",
        sa.Column("delivery_time", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.add_column(
        "service_orders",
        sa.Column("quality_checklist", sa.Text(), nullable=True),
    )
