"""Reconhecimento facial no ponto (Fase 2): score de similaridade na batida.

Adiciona a time_clock_records:
- face_match_score (Float): similaridade de cosseno entre a selfie da batida e o
  rosto de referência do funcionário (null = sem cadastro/sem embedding).
- face_verified (Boolean): resultado advisory pelo limiar atual (Fase 2a não
  bloqueia; serve para calibrar o limiar antes de ativar a trava).

Revision ID: 20260728_106
Revises: 20260728_105
Create Date: 2026-07-28
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260728_106"
down_revision = "20260728_105"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "time_clock_records",
        sa.Column("face_match_score", sa.Float(), nullable=True),
    )
    op.add_column(
        "time_clock_records",
        sa.Column("face_verified", sa.Boolean(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("time_clock_records", "face_verified")
    op.drop_column("time_clock_records", "face_match_score")
