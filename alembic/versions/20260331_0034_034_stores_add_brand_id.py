"""stores_add_brand_id

Revision ID: 034_stores_add_brand_id
Revises: 033_create_brands
Create Date: 2026-03-31 00:34:00.000000-03:00

Adiciona brand_id (FK -> brands) na tabela stores.
Popula brand_id a partir de dealership_brand existente.
Lojas sem dealership_brand recebem brand_id=1 (Toyota) como fallback.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '034_stores_add_brand_id'
down_revision: Union[str, None] = '033_create_brands'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Adicionar coluna nullable inicialmente
    op.add_column('stores', sa.Column('brand_id', sa.Integer(), nullable=True))

    # 2. Popular brand_id a partir de dealership_brand
    op.execute(
        """
        UPDATE stores s
        SET brand_id = b.id
        FROM brands b
        WHERE b.code = s.dealership_brand
        """
    )

    # 3. Fallback: lojas sem dealership_brand (ou sem match) recebem Toyota (id=1)
    op.execute(
        "UPDATE stores SET brand_id = 1 WHERE brand_id IS NULL"
    )

    # 4. Tornar NOT NULL
    op.alter_column('stores', 'brand_id', nullable=False)

    # 5. Criar FK e índice
    op.create_foreign_key(
        'fk_stores_brand_id',
        'stores',
        'brands',
        ['brand_id'],
        ['id'],
    )
    op.create_index('ix_stores_brand_id', 'stores', ['brand_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_stores_brand_id', table_name='stores')
    op.drop_constraint('fk_stores_brand_id', 'stores', type_='foreignkey')
    op.drop_column('stores', 'brand_id')
