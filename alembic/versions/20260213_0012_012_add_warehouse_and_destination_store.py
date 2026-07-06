"""Add warehouse store type and destination_store_id to service_orders

Revision ID: 012
Revises: 011
Create Date: 2026-02-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '012'
down_revision: Union[str, None] = '011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add warehouse store type and destination_store_id column."""

    # 1. Add destination_store_id column to service_orders
    op.add_column(
        'service_orders',
        sa.Column(
            'destination_store_id',
            sa.Integer(),
            nullable=True
        )
    )

    # 2. Add foreign key constraint for destination_store_id
    op.create_foreign_key(
        'fk_service_orders_destination_store_id_stores',
        'service_orders',
        'stores',
        ['destination_store_id'],
        ['id'],
        ondelete='RESTRICT'
    )

    # 3. Add index for destination_store_id
    op.create_index(
        'ix_service_orders_destination_store_id',
        'service_orders',
        ['destination_store_id']
    )

    # 4. Insert Galpão store (warehouse)
    op.execute("""
        INSERT INTO stores (name, code, address, is_active, store_type, created_at)
        VALUES (
            'Galpão',
            'GP01',
            'Endereço do Galpão',
            true,
            'warehouse',
            NOW()
        )
    """)


def downgrade() -> None:
    """Remove Galpão store and destination_store_id column."""

    # 1. Delete Galpão store
    op.execute("""
        DELETE FROM stores
        WHERE code = 'GP01' AND store_type = 'warehouse'
    """)

    # 2. Drop index for destination_store_id
    op.drop_index('ix_service_orders_destination_store_id', 'service_orders')

    # 3. Drop foreign key constraint
    op.drop_constraint(
        'fk_service_orders_destination_store_id_stores',
        'service_orders',
        type_='foreignkey'
    )

    # 4. Drop destination_store_id column from service_orders
    op.drop_column('service_orders', 'destination_store_id')
