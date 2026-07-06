"""service_orders: add updated_by_id (último usuário que atualizou)

Revision ID: 20260626_090
Revises: 20260626_089
Create Date: 2026-06-26

Contexto:
  Adiciona a coluna updated_by_id (FK users, ON DELETE SET NULL) à tabela service_orders
  para rastrear o último usuário que atualizou a O.S. (edição, mudança de status ou
  verificação). Usado nas novas colunas "Atualizado em / Atualizado por" da Conferência.
"""

import sqlalchemy as sa

from alembic import op

revision = "20260626_090"
down_revision = "20260626_089"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "service_orders",
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_service_orders_updated_by_id_users",
        "service_orders",
        "users",
        ["updated_by_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_service_orders_updated_by_id_users", "service_orders", type_="foreignkey"
    )
    op.drop_column("service_orders", "updated_by_id")
