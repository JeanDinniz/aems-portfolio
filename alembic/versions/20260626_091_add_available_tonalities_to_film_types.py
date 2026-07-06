"""film_types: add available_tonalities (tonalidades configuráveis por tipo)

Revision ID: 20260626_091
Revises: 20260626_090
Create Date: 2026-06-26

Contexto:
  Torna as tonalidades configuráveis por tipo de bobina (FilmType). Backfill: tipos de
  película de segurança (department='security_film') recebem a tonalidade "Incolor" além
  das demais; os outros departamentos (film/ppf) ficam SEM "Incolor".
"""

import sqlalchemy as sa

from alembic import op

revision = "20260626_091"
down_revision = "20260626_090"
branch_labels = None
depends_on = None

_BASE = '["G05","G20","G35","G50","G75"]'
_WITH_INCOLOR = '["G05","G20","G35","G50","G75","Incolor"]'


def upgrade() -> None:
    op.add_column(
        "film_types",
        sa.Column(
            "available_tonalities",
            sa.JSON(),
            nullable=False,
            server_default="[]",
        ),
    )
    # Backfill por departamento
    op.execute(
        f"UPDATE film_types SET available_tonalities = '{_WITH_INCOLOR}'::json "
        "WHERE department = 'security_film'"
    )
    op.execute(
        f"UPDATE film_types SET available_tonalities = '{_BASE}'::json "
        "WHERE department <> 'security_film'"
    )


def downgrade() -> None:
    op.drop_column("film_types", "available_tonalities")
