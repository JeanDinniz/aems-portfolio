"""backfill film_type_id from film_roll for all items missing it

Revision ID: 20260525_078
Revises: 20260525_077
Create Date: 2026-05-25

A migration 077 Step 1 atualizava film_type_id apenas quando roll_code era NULL.
Itens cujo film_roll_id foi atribuído após a migration 076 (e cujo roll_code já
estava preenchido) ficaram sem film_type_id. Este passo cobre esse caso residual.
"""

from alembic import op

revision = "20260525_078"
down_revision = "20260525_077"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Preenche film_type_id a partir da bobina para qualquer item que ainda
    # tenha film_roll_id definido mas film_type_id NULL.
    op.execute("""
        UPDATE service_order_items soi
        SET film_type_id = fr.film_type_id
        FROM film_rolls fr
        WHERE soi.film_roll_id = fr.id
          AND soi.film_type_id IS NULL
          AND fr.film_type_id IS NOT NULL
    """)


def downgrade() -> None:
    pass
