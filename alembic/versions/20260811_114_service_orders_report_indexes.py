"""service_orders: índices para Conferência/Fechamento/Dashboard

Adiciona índices alinhados às queries reais (revisão de performance):
- (store_id, service_date)            -> filtro de Conferência e Fechamento
- (store_id, completion_time, status) -> Dashboard, Resumo Diário e ranking
- índice PARCIAL em is_verified        -> boolean de baixa cardinalidade

Aditivo — não toca dados. IF NOT EXISTS para conviver com bancos que já
tenham índices equivalentes criados manualmente.

Revision ID: 20260811_114
Revises: 20260805_113
Create Date: 2026-08-11
"""

from alembic import op

revision = "20260811_114"
down_revision = "20260805_113"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_service_orders_store_service_date",
        "service_orders",
        ["store_id", "service_date"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_service_orders_store_completion_status",
        "service_orders",
        ["store_id", "completion_time", "status"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_service_orders_verified",
        "service_orders",
        ["store_id"],
        postgresql_where="is_verified",
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_service_orders_verified", table_name="service_orders", if_exists=True)
    op.drop_index(
        "ix_service_orders_store_completion_status",
        table_name="service_orders",
        if_exists=True,
    )
    op.drop_index(
        "ix_service_orders_store_service_date", table_name="service_orders", if_exists=True
    )
