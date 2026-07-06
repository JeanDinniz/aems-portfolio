"""Add store_type and AEMS store

Revision ID: 011
Revises: 010
Create Date: 2026-02-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '011'
down_revision: Union[str, None] = '010'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add store_type column, client fields to service_orders, and insert AEMS store."""

    # 1. Add store_type column to stores with default value
    op.add_column(
        'stores',
        sa.Column(
            'store_type',
            sa.String(20),
            nullable=False,
            server_default='dealership'
        )
    )

    # 2. Update existing 12 stores to be dealership type (explicit update)
    op.execute("""
        UPDATE stores
        SET store_type = 'dealership'
        WHERE code IN ('LJ01', 'LJ02', 'LJ03', 'LJ04', 'LJ05', 'LJ06',
                      'LJ07', 'LJ08', 'LJ09', 'LJ10', 'LJ11', 'LJ12')
    """)

    # 3. Make dealership_id nullable in service_orders
    op.alter_column(
        'service_orders',
        'dealership_id',
        existing_type=sa.Integer(),
        nullable=True
    )

    # 4. Add client fields to service_orders for direct sales
    op.add_column(
        'service_orders',
        sa.Column('client_name', sa.String(200), nullable=True)
    )
    op.add_column(
        'service_orders',
        sa.Column('client_phone', sa.String(20), nullable=True)
    )
    op.add_column(
        'service_orders',
        sa.Column('total_value', sa.Numeric(10, 2), nullable=True)
    )

    # 5. Insert AEMS store (direct sales)
    op.execute("""
        INSERT INTO stores (name, code, address, is_active, store_type, created_at)
        VALUES (
            'AEMS',
            'WC01',
            'Endereço da AEMS',
            true,
            'direct_sales',
            NOW()
        )
    """)


def downgrade() -> None:
    """Remove AEMS store, client fields, and store_type column."""

    # 1. Delete AEMS store
    op.execute("""
        DELETE FROM stores
        WHERE code = 'WC01' AND store_type = 'direct_sales'
    """)

    # 2. Drop client fields from service_orders
    op.drop_column('service_orders', 'total_value')
    op.drop_column('service_orders', 'client_phone')
    op.drop_column('service_orders', 'client_name')

    # 3. Make dealership_id NOT NULL again in service_orders
    op.alter_column(
        'service_orders',
        'dealership_id',
        existing_type=sa.Integer(),
        nullable=False
    )

    # 4. Drop store_type column from stores
    op.drop_column('stores', 'store_type')
