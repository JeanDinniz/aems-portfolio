"""service order execution notes: service_orders.execution_notes

Relato técnico do instalador, preenchido no Finalizar (distinto do `notes`,
que é o briefing do consultor copiado do Agendamento). Campo livre, opcional,
não sincronizado pela edição do agendamento.

Revision ID: 20260924_132
Revises: 20260921_131
Create Date: 2026-09-24
"""

import sqlalchemy as sa

from alembic import op

revision = "20260924_132"
down_revision = "20260921_131"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "service_orders",
        sa.Column("execution_notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("service_orders", "execution_notes")
