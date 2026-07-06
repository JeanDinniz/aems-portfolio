"""Add order_number column to service_orders

Revision ID: 017
Revises: 016
Create Date: 2026-02-20

A coluna order_number é gerada automaticamente pelo trigger
fn_generate_order_number (criado na migration 013).
O trigger referenciava NEW.order_number mas a coluna não existia,
causando 500 em toda criação de O.S.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '017'
down_revision: Union[str, None] = '016'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'service_orders',
        sa.Column('order_number', sa.String(30), nullable=True, unique=True)
    )
    op.create_index(
        'ix_service_orders_order_number',
        'service_orders',
        ['order_number'],
        unique=True
    )


def downgrade() -> None:
    op.drop_index('ix_service_orders_order_number', table_name='service_orders')
    op.drop_column('service_orders', 'order_number')
