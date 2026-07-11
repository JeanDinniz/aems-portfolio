"""Normaliza valores de tonalidade em dados existentes.

Tonalidades gravadas com espaços nas bordas ou minúsculas ("g05", "G05 ")
quebram a comparação exata usada no seletor de bobinas da finalização de O.S.
e duplicam grupos na página de Estoque. Esta migration aplica a mesma regra
do validator ``normalize_tonality`` (app/core/validators.py) aos dados:
trim sempre; UPPER para o padrão G##; string vazia vira NULL.

Colunas texto: film_rolls.tonality, service_order_items.tonality,
appointments.film_tonality. Colunas JSON: film_types.available_tonalities,
appointments.film_entries (chave "tonality" de cada entrada).

Revision ID: 20260709_093
Revises: 20260706_092
Create Date: 2026-07-09
"""

import json
import re

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260709_093"
down_revision = "20260706_092"
branch_labels = None
depends_on = None

_G_TONALITY_REGEX = re.compile(r"^[Gg]\d{1,3}$")

_TEXT_COLUMNS = [
    ("film_rolls", "tonality"),
    ("service_order_items", "tonality"),
    ("appointments", "film_tonality"),
]


def _normalize(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if _G_TONALITY_REGEX.match(value):
        return value.upper()
    return value


def upgrade() -> None:
    conn = op.get_bind()

    for table, column in _TEXT_COLUMNS:
        # Trim + string vazia vira NULL
        conn.execute(
            sa.text(
                f"UPDATE {table} SET {column} = NULLIF(BTRIM({column}), '') "
                f"WHERE {column} IS NOT NULL AND {column} IS DISTINCT FROM NULLIF(BTRIM({column}), '')"
            )
        )
        # UPPER apenas no padrão G##
        conn.execute(
            sa.text(
                f"UPDATE {table} SET {column} = UPPER({column}) "
                f"WHERE {column} ~ '^[Gg][0-9]{{1,3}}$' AND {column} <> UPPER({column})"
            )
        )

    # film_types.available_tonalities (JSON list[str])
    rows = conn.execute(sa.text("SELECT id, available_tonalities FROM film_types")).fetchall()
    for film_type_id, tonalities in rows:
        if not tonalities:
            continue
        normalized: list[str] = []
        for item in tonalities:
            value = _normalize(item)
            if value is not None and value not in normalized:
                normalized.append(value)
        if normalized != list(tonalities):
            conn.execute(
                sa.text("UPDATE film_types SET available_tonalities = :val WHERE id = :id"),
                {"val": json.dumps(normalized), "id": film_type_id},
            )

    # appointments.film_entries (JSON list[dict] com chave "tonality")
    rows = conn.execute(
        sa.text("SELECT id, film_entries FROM appointments WHERE film_entries IS NOT NULL")
    ).fetchall()
    for appointment_id, entries in rows:
        if not isinstance(entries, list):
            continue
        changed = False
        for entry in entries:
            if isinstance(entry, dict) and "tonality" in entry:
                value = _normalize(entry.get("tonality"))
                if value != entry.get("tonality"):
                    entry["tonality"] = value
                    changed = True
        if changed:
            conn.execute(
                sa.text("UPDATE appointments SET film_entries = :val WHERE id = :id"),
                {"val": json.dumps(entries), "id": appointment_id},
            )


def downgrade() -> None:
    # Normalização de dados não é reversível (os valores originais são perdidos).
    pass
