"""Reconhecimento facial no ponto: embedding de referência no funcionário.

Adiciona a employees:
- face_embedding (JSON): vetor do rosto gerado NO APP (a imagem crua não é
  armazenada — só o embedding). Usado na verificação 1:1 do ponto.
- face_enrolled_at: quando o rosto de referência foi cadastrado.
- face_consent_at: consentimento LGPD do funcionário para uso do dado biométrico.

Revision ID: 20260728_105
Revises: 20260719_104
Create Date: 2026-07-28
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260728_105"
down_revision = "20260719_104"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("face_embedding", sa.JSON(), nullable=True))
    op.add_column(
        "employees",
        sa.Column("face_enrolled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("face_consent_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("employees", "face_consent_at")
    op.drop_column("employees", "face_enrolled_at")
    op.drop_column("employees", "face_embedding")
