"""Add dealership_brand to stores

Revision ID: 022
Revises: 021
Create Date: 2026-02-23

Contexto:
  Adiciona o campo dealership_brand à tabela stores para identificar qual
  marca de concessionária a loja atende (byd, fiat, hyundai, toyota).
  Preenche automaticamente as lojas existentes com base no nome da loja.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '022'
down_revision: Union[str, None] = '021'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add dealership_brand column to stores table and populate existing rows."""

    op.add_column(
        'stores',
        sa.Column('dealership_brand', sa.String(20), nullable=True),
    )

    # Preenche a marca de concessionária para as lojas existentes com base no nome
    op.execute("UPDATE stores SET dealership_brand = 'byd' WHERE name ILIKE '%BYD%'")
    op.execute("UPDATE stores SET dealership_brand = 'fiat' WHERE name ILIKE '%FIAT%'")
    op.execute("UPDATE stores SET dealership_brand = 'hyundai' WHERE name ILIKE '%HYUNDAI%'")
    op.execute("UPDATE stores SET dealership_brand = 'toyota' WHERE name ILIKE '%TOYOTA%'")


def downgrade() -> None:
    """Remove dealership_brand column from stores table."""

    op.drop_column('stores', 'dealership_brand')
