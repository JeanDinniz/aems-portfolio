"""consolida "Geral" duplicadas e cria índice UNIQUE parcial por loja

Corrige o bug da concessionária fantasma "Geral" auto-criada: sob concorrência
(ou antes do fix no service), duas transações podiam criar múltiplas "Geral" na
mesma loja. Esta migration:

1. Consolida as "Geral" duplicadas de cada loja na de menor id (reaponta
   consultores e ordens de serviço, depois apaga as sobras). "Geral" é um
   encaixe genérico/fungível — a consolidação é segura.
2. Cria um índice UNIQUE PARCIAL (só `brand = 'Geral'`) garantindo no máximo
   uma "Geral" por loja. Concessionárias reais (marcas de verdade) não são
   afetadas — duas marcas iguais na mesma loja seguem permitidas.

Revision ID: 20260823_123
Revises: 20260820_122
Create Date: 2026-08-23

"""

import sqlalchemy as sa

from alembic import op

revision = "20260823_123"
down_revision = "20260820_122"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Passo 1: consolidar "Geral" duplicadas (só faz sentido no Postgres real;
    # em SQLite o bloco roda igual mas normalmente não há dados a consolidar).
    # Reaponta consultores das "Geral" duplicadas para a canônica (menor id).
    op.execute(
        sa.text(
            """
            WITH canonical AS (
                SELECT store_id, MIN(id) AS keep_id
                FROM dealerships
                WHERE brand = 'Geral'
                GROUP BY store_id
            ),
            dups AS (
                SELECT d.id AS dup_id, c.keep_id
                FROM dealerships d
                JOIN canonical c ON d.store_id = c.store_id
                WHERE d.brand = 'Geral' AND d.id <> c.keep_id
            )
            UPDATE consultants
            SET dealership_id = dups.keep_id
            FROM dups
            WHERE consultants.dealership_id = dups.dup_id
            """
        )
    )
    # Reaponta ordens de serviço das "Geral" duplicadas para a canônica.
    op.execute(
        sa.text(
            """
            WITH canonical AS (
                SELECT store_id, MIN(id) AS keep_id
                FROM dealerships
                WHERE brand = 'Geral'
                GROUP BY store_id
            ),
            dups AS (
                SELECT d.id AS dup_id, c.keep_id
                FROM dealerships d
                JOIN canonical c ON d.store_id = c.store_id
                WHERE d.brand = 'Geral' AND d.id <> c.keep_id
            )
            UPDATE service_orders
            SET dealership_id = dups.keep_id
            FROM dups
            WHERE service_orders.dealership_id = dups.dup_id
            """
        )
    )
    # Apaga as "Geral" duplicadas (mantém apenas a de menor id por loja).
    op.execute(
        sa.text(
            """
            DELETE FROM dealerships d
            USING (
                SELECT store_id, MIN(id) AS keep_id
                FROM dealerships
                WHERE brand = 'Geral'
                GROUP BY store_id
            ) canonical
            WHERE d.brand = 'Geral'
              AND d.store_id = canonical.store_id
              AND d.id <> canonical.keep_id
            """
        )
    )

    # Passo 2: índice UNIQUE parcial (uma "Geral" por loja).
    op.create_index(
        "uq_dealership_geral_per_store",
        "dealerships",
        ["store_id"],
        unique=True,
        postgresql_where=sa.text("brand = 'Geral'"),
        sqlite_where=sa.text("brand = 'Geral'"),
    )


def downgrade() -> None:
    # Só o índice é revertido. A consolidação de dados do upgrade (fusão das
    # "Geral" duplicadas) é IRREVERSÍVEL por natureza — não há como recriar as
    # duplicatas apagadas. O downgrade apenas remove a trava de unicidade.
    op.drop_index("uq_dealership_geral_per_store", table_name="dealerships")
