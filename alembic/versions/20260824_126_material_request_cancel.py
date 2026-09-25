"""adiciona status/cancelamento em material_requests (cancelar em vez de excluir)

Permite cancelar (invalidar) um pedido de material mantendo-o visível com o
motivo, em vez de apagá-lo. `status='active'` para os pedidos existentes.

Revision ID: 20260824_126
Revises: 20260824_125
Create Date: 2026-08-24

"""

import sqlalchemy as sa

from alembic import op

revision = "20260824_126"
down_revision = "20260824_125"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "material_requests",
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
    )
    op.create_index("ix_material_requests_status", "material_requests", ["status"])
    op.add_column(
        "material_requests",
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "material_requests",
        sa.Column("cancellation_reason", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("material_requests", "cancellation_reason")
    op.drop_column("material_requests", "cancelled_at")
    op.drop_index("ix_material_requests_status", table_name="material_requests")
    op.drop_column("material_requests", "status")
