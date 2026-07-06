"""backfill film_type_id on service_order_items

Revision ID: 20260525_076
Revises: 20260523_075
Create Date: 2026-05-25

Popula film_type_id nos itens de O.S. de película/PPF gerados pelo agendamento,
onde o campo ficou null por não estar no schema FilmEntryItem.

Prioridade 1: itens com film_roll_id atribuído → busca film_type_id da bobina.
Prioridade 2: itens sem bobina mas com agendamento vinculado → busca
             film_type_id do campo raiz do agendamento.
"""

from alembic import op

revision = "20260525_076"
down_revision = "20260523_075"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Prioridade 1: itens que já foram finalizados com bobina
    # → herda film_type_id da própria bobina (fonte mais confiável)
    op.execute("""
        UPDATE service_order_items soi
        SET film_type_id = fr.film_type_id
        FROM film_rolls fr
        WHERE soi.film_roll_id = fr.id
          AND soi.film_type_id IS NULL
          AND fr.film_type_id IS NOT NULL
    """)

    # Prioridade 2: itens ainda sem bobina (em_progresso ou bobina deletada)
    # → usa o film_type_id do agendamento que originou a O.S.
    op.execute("""
        UPDATE service_order_items soi
        SET film_type_id = a.film_type_id
        FROM appointments a
        WHERE a.service_order_id = soi.service_order_id
          AND soi.film_type_id IS NULL
          AND a.film_type_id IS NOT NULL
    """)


def downgrade() -> None:
    # Backfill de dados não é revertível sem snapshot — no-op intencional
    pass
