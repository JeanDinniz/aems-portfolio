"""add_is_return_is_courtesy_to_service_orders

Revision ID: eb1c636616ce
Revises: 042_update_users_role_constraint
Create Date: 2026-04-07 09:24:51.119595-03:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'eb1c636616ce'
down_revision: Union[str, None] = '042_update_users_role_constraint'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'service_orders',
        sa.Column('is_return', sa.Boolean(), server_default='false', nullable=False),
    )
    op.add_column(
        'service_orders',
        sa.Column('is_courtesy', sa.Boolean(), server_default='false', nullable=False),
    )


def downgrade() -> None:
    op.drop_column('service_orders', 'is_courtesy')
    op.drop_column('service_orders', 'is_return')
