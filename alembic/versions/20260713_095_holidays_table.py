"""Cadastro de feriados para cálculo de dias úteis do Resumo Diário.

Tabela holidays: date + name + store_id opcional (NULL = feriado válido
para todas as lojas). Usada para descontar feriados dos dias úteis
(seg-sáb) na projeção do mês do Resumo Diário da loja.

Revision ID: 20260713_095
Revises: 20260713_094
Create Date: 2026-07-13
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260713_095"
down_revision = "20260713_094"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "holidays",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("date", "store_id", name="uq_holidays_date_store"),
    )
    op.create_index("ix_holidays_date", "holidays", ["date"])
    op.create_index("ix_holidays_store_id", "holidays", ["store_id"])


def downgrade() -> None:
    op.drop_index("ix_holidays_store_id", table_name="holidays")
    op.drop_index("ix_holidays_date", table_name="holidays")
    op.drop_table("holidays")
