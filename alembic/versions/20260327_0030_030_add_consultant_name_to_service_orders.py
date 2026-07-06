"""add_consultant_name_to_service_orders

Revision ID: a3f1b2c4d5e6
Revises: c9bc636ab5ab
Create Date: 2026-03-27 00:00:00.000000-03:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3f1b2c4d5e6'
down_revision: Union[str, None] = 'c9bc636ab5ab'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'service_orders',
        sa.Column('consultant_name', sa.String(200), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('service_orders', 'consultant_name')
