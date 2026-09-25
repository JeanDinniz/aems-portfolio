"""Estoque Opção A: extrato como fonte da verdade da bobina.

Adiciona a film_consumptions:
- kind (String): tipo do movimento — consumo | estorno | ajuste | reconciliacao
  (NULL = movimento legado, inferir pelos FKs de O.S./saída avulsa).
- adjustment_reason (String): motivo obrigatório quando kind='ajuste'.

Reconciliação de dados (jeito seguro): para cada bobina onde o saldo (remaining)
já diverge do extrato (total - soma(consumos)), insere UMA linha 'reconciliacao'
que carimba exatamente a diferença — de forma que, a partir de agora,
total - soma(extrato) == remaining atual. Nenhum saldo visível muda; apenas passa
a ter lastro no extrato. Daí em diante o saldo é sempre derivado do extrato.

Revision ID: 20260730_107
Revises: 20260728_106
Create Date: 2026-07-30
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260730_107"
down_revision = "20260728_106"
branch_labels = None
depends_on = None

_RECONCILE_SQL = """
INSERT INTO film_consumptions
    (film_roll_id, meters_consumed, kind, adjustment_reason, created_at)
SELECT fr.id,
       (fr.total_meters - fr.remaining_meters) - COALESCE(c.s, 0),
       'reconciliacao',
       'Reconciliação inicial saldo x extrato (migração 107)',
       now()
FROM film_rolls fr
LEFT JOIN (
    SELECT film_roll_id, SUM(meters_consumed) AS s
    FROM film_consumptions
    GROUP BY film_roll_id
) c ON c.film_roll_id = fr.id
WHERE ABS((fr.total_meters - fr.remaining_meters) - COALESCE(c.s, 0)) > 0.001
"""


def upgrade() -> None:
    op.add_column("film_consumptions", sa.Column("kind", sa.String(length=20), nullable=True))
    op.add_column(
        "film_consumptions",
        sa.Column("adjustment_reason", sa.String(length=500), nullable=True),
    )
    op.create_index(
        "ix_film_consumptions_kind", "film_consumptions", ["kind"], unique=False
    )
    # Carimba a divergência saldo x extrato preservando o saldo atual.
    op.execute(_RECONCILE_SQL)


def downgrade() -> None:
    # Remove as linhas criadas pela reconciliação antes de dropar as colunas.
    op.execute("DELETE FROM film_consumptions WHERE kind = 'reconciliacao'")
    op.drop_index("ix_film_consumptions_kind", table_name="film_consumptions")
    op.drop_column("film_consumptions", "adjustment_reason")
    op.drop_column("film_consumptions", "kind")
