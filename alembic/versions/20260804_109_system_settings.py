"""Tabela system_settings (configurações globais chave-valor).

Guarda parâmetros de escopo de sistema editáveis pelo Owner — hoje as metas de
faturamento por funcionário (chave "revenue_goals"). Uma linha por chave, valor
em JSON. Sem seed: o service cai nos defaults (7.000/8.500/10.000) até o Owner
salvar.

Revision ID: 20260804_109
Revises: 20260730_108
Create Date: 2026-08-04
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260804_109"
down_revision = "20260730_108"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_settings",
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("system_settings")
