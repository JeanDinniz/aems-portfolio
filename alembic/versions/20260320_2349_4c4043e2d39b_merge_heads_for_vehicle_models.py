"""merge_heads_for_vehicle_models

Revision ID: 4c4043e2d39b
Revises: 8cc20038945d, 011_remove_direct_sales_fields
Create Date: 2026-03-20 23:49:50.419481-03:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4c4043e2d39b'
down_revision: Union[str, None] = ('8cc20038945d', '011_remove_direct_sales_fields')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
