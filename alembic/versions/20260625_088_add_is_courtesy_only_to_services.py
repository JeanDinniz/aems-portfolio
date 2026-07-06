"""add is_courtesy_only to services

Revision ID: 20260625_088
Revises: 20260621_087
Create Date: 2026-06-25

Contexto:
  Adiciona o campo is_courtesy_only à tabela services. Serviços marcados como
  exclusivos de cortesia ficam ocultos na seleção de O.S. normais e só aparecem
  quando a O.S./agendamento é marcado como cortesia.
"""

import sqlalchemy as sa

from alembic import op

revision = "20260625_088"
down_revision = "20260621_087"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "services",
        sa.Column("is_courtesy_only", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("services", "is_courtesy_only")
