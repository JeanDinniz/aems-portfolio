"""Add brand, code, category to services

Revision ID: 021
Revises: 020
Create Date: 2026-02-23

Contexto:
  Adiciona campos brand, code e category à tabela services para suportar
  o catálogo de serviços segmentado por marca de concessionária (BYD, FIAT,
  HYUNDAI, TOYOTA) com categorias visuais para agrupamento no frontend.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '021'
down_revision: Union[str, None] = '020'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add brand, code and category columns to services table."""

    op.add_column(
        'services',
        sa.Column('brand', sa.String(20), nullable=True),
    )
    op.add_column(
        'services',
        sa.Column('code', sa.String(50), nullable=True),
    )
    op.add_column(
        'services',
        sa.Column('category', sa.String(50), nullable=True),
    )

    op.create_index('ix_services_brand', 'services', ['brand'])
    op.create_index('ix_services_category', 'services', ['category'])


def downgrade() -> None:
    """Remove brand, code and category columns from services table."""

    op.drop_index('ix_services_category', table_name='services')
    op.drop_index('ix_services_brand', table_name='services')

    op.drop_column('services', 'category')
    op.drop_column('services', 'code')
    op.drop_column('services', 'brand')
