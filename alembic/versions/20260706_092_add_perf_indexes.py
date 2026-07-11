"""Índices de performance: appointments.service_order_id e composto store+is_galpon

- ix_appointments_service_order_id: acelera o LEFT JOIN do resumo de
  agendamentos por loja (scheduling/service.py) e os lookups appointment→O.S.
- ix_service_orders_store_galpon: cobre os filtros combinados de loja +
  perfil galpão usados em analytics, listagens e permissões.

Revision ID: 20260706_092
Revises: 20260626_091
Create Date: 2026-07-06
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260706_092"
down_revision = "20260626_091"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_appointments_service_order_id",
        "appointments",
        ["service_order_id"],
        unique=False,
    )
    op.create_index(
        "ix_service_orders_store_galpon",
        "service_orders",
        ["store_id", "is_galpon"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_service_orders_store_galpon", table_name="service_orders")
    op.drop_index("ix_appointments_service_order_id", table_name="appointments")
