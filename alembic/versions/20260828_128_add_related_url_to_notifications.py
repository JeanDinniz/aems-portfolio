"""notifications: adiciona related_url (deep-link)

Permite que a notificação carregue um caminho relativo (ex.: "/estoque?roll=42")
para o front web/app rotear diretamente ao abrir a notificação, sem precisar
inferir a rota a partir do `type`.

Revision ID: 20260828_128
Revises: 20260824_127
Create Date: 2026-08-28
"""

import sqlalchemy as sa

from alembic import op

revision = "20260828_128"
down_revision = "20260824_127"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notifications",
        sa.Column("related_url", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("notifications", "related_url")
