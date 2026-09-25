"""adiciona original_service_order_id em appointments (vínculo de retorno)

Permite vincular um agendamento de retorno à O.S. de origem (o carro que voltou),
propagado à O.S. gerada pelo agendamento.

Revision ID: 20260823_124
Revises: 20260823_123
Create Date: 2026-08-23

"""

import sqlalchemy as sa

from alembic import op

revision = "20260823_124"
down_revision = "20260823_123"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "appointments",
        sa.Column("original_service_order_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_appointments_original_service_order_id",
        "appointments",
        ["original_service_order_id"],
    )
    op.create_foreign_key(
        "fk_appointments_original_service_order_id",
        "appointments",
        "service_orders",
        ["original_service_order_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_appointments_original_service_order_id", "appointments", type_="foreignkey"
    )
    op.drop_index("ix_appointments_original_service_order_id", table_name="appointments")
    op.drop_column("appointments", "original_service_order_id")
