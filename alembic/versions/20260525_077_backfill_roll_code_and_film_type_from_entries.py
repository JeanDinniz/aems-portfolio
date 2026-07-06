"""backfill roll_code and film_type_id from film_entries on service_order_items

Revision ID: 20260525_077
Revises: 20260525_076
Create Date: 2026-05-25

Complementa a migration 076 com dois passos adicionais:

Passo 1 — roll_code nulo com bobina vinculada:
  Itens que possuem film_roll_id atribuído mas roll_code NULL (a computação pode
  ter falhado silenciosamente). Reconstrói o código visual replicando
  compute_visual_id() em SQL puro.

Passo 2 — film_type_id via film_entries JSON (PPF sem bobina):
  Para agendamentos PPF onde appointment.film_type_id é NULL, a migration 076
  Priority 2 não conseguiu preencher film_type_id nos itens. Esta migration
  busca o film_type_id diretamente dentro do JSON film_entries do agendamento,
  correlacionando por service_id.
"""

from alembic import op

revision = "20260525_077"
down_revision = "20260525_076"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Passo 1: Reconstruir roll_code para itens com bobina mas sem código ──
    # Replica compute_visual_id(): NomeTipo[_Tonalidade]_DDMMAAAA [Metros]
    op.execute("""
        UPDATE service_order_items soi
        SET
            roll_code = CASE
                WHEN fr.tonality IS NOT NULL THEN
                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    REPLACE(ft.name, ' ', ''), 'é', 'e'), 'ê', 'e'),
                    'ã', 'a'), 'ç', 'c'), 'ó', 'o'), 'ô', 'o'),
                    'á', 'a'), 'â', 'a'), 'í', 'i'), 'ú', 'u')
                    || '_' || fr.tonality
                    || '_' || TO_CHAR(fr.receipt_date, 'DDMMYYYY')
                    || ' [' || FLOOR(fr.total_meters)::int::text || ']'
                ELSE
                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    REPLACE(ft.name, ' ', ''), 'é', 'e'), 'ê', 'e'),
                    'ã', 'a'), 'ç', 'c'), 'ó', 'o'), 'ô', 'o'),
                    'á', 'a'), 'â', 'a'), 'í', 'i'), 'ú', 'u')
                    || '_' || TO_CHAR(fr.receipt_date, 'DDMMYYYY')
                    || ' [' || FLOOR(fr.total_meters)::int::text || ']'
            END,
            film_type_id = COALESCE(soi.film_type_id, fr.film_type_id)
        FROM film_rolls fr
        JOIN film_types ft ON ft.id = fr.film_type_id
        WHERE soi.film_roll_id = fr.id
          AND soi.roll_code IS NULL
    """)

    # ── Passo 2: film_type_id via JSON film_entries do agendamento (PPF) ──
    # Cobre o caso onde appointment.film_type_id é NULL mas cada entrada em
    # film_entries possui seu próprio film_type_id (formato PPF por serviço).
    op.execute("""
        UPDATE service_order_items soi
        SET film_type_id = (entry->>'film_type_id')::int
        FROM appointments a,
             jsonb_array_elements(a.film_entries::jsonb) AS entry
        WHERE a.service_order_id = soi.service_order_id
          AND soi.film_type_id IS NULL
          AND (entry->>'service_id')::int = soi.service_id
          AND entry->>'film_type_id' IS NOT NULL
          AND a.film_entries IS NOT NULL
    """)


def downgrade() -> None:
    # Backfill de dados calculados não é revertível sem snapshot — no-op intencional
    pass
