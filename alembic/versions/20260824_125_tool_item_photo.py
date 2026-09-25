"""tool item photo: material_request_tools.photo_url

Adiciona a foto obrigatória por item de ferramenta no recebimento (Controle de
EPIs, Fase A). Nullable: recebimentos históricos e itens ainda não recebidos
não têm foto.

Revision ID: 20260824_125
Revises: 20260823_124
Create Date: 2026-08-24
"""

import sqlalchemy as sa

from alembic import op

revision = "20260824_125"
down_revision = "20260823_124"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "material_request_tools",
        sa.Column("photo_url", sa.String(500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("material_request_tools", "photo_url")
