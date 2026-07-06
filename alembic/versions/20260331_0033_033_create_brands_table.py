"""create_brands_table

Revision ID: 033_create_brands
Revises: c8d9e0f1a2b3
Create Date: 2026-03-31 00:33:00.000000-03:00

Cria a tabela brands e insere as 4 marcas iniciais (Toyota, BYD, Fiat, Hyundai).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '033_create_brands'
down_revision: Union[str, None] = 'c8d9e0f1a2b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'brands',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('code', sa.String(length=10), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name', name='uq_brands_name'),
        sa.UniqueConstraint('code', name='uq_brands_code'),
    )
    op.create_index('ix_brands_code', 'brands', ['code'], unique=True)

    # Inserir marcas iniciais
    op.execute(
        """
        INSERT INTO brands (id, name, code, is_active, created_at)
        VALUES
            (1, 'Toyota',  'toyota',  true, now()),
            (2, 'BYD',     'byd',     true, now()),
            (3, 'Fiat',    'fiat',    true, now()),
            (4, 'Hyundai', 'hyundai', true, now())
        """
    )

    # Ajustar a sequence para continuar após os IDs inseridos manualmente
    op.execute("SELECT setval('brands_id_seq', 4, true)")


def downgrade() -> None:
    op.drop_index('ix_brands_code', table_name='brands')
    op.drop_table('brands')
