"""Update store names to real dealership names

Revision ID: 008
Revises: 007
Create Date: 2026-02-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '008'
down_revision: Union[str, None] = '007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Update store names from generic 'Loja XX' to real dealership names."""

    # Update each store name based on its code
    op.execute(
        """
        UPDATE stores
        SET name = 'Toyota Unidade 01'
        WHERE code = 'LJ01'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'Toyota Unidade 02'
        WHERE code = 'LJ02'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'Toyota Unidade 03'
        WHERE code = 'LJ03'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'BYD Unidade 04'
        WHERE code = 'LJ04'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'BYD Unidade 05'
        WHERE code = 'LJ05'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'BYD Unidade 06'
        WHERE code = 'LJ06'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'BYD Unidade 07'
        WHERE code = 'LJ07'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'BYD Unidade 08'
        WHERE code = 'LJ08'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'Hyundai Unidade 09'
        WHERE code = 'LJ09'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'Hyundai Unidade 10'
        WHERE code = 'LJ10'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'Fiat Unidade 11'
        WHERE code = 'LJ11'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'Fiat Unidade 12'
        WHERE code = 'LJ12'
        """
    )


def downgrade() -> None:
    """Revert store names back to generic 'Loja XX' format."""

    # Revert each store name back to the generic format
    op.execute(
        """
        UPDATE stores
        SET name = 'Loja 01'
        WHERE code = 'LJ01'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'Loja 02'
        WHERE code = 'LJ02'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'Loja 03'
        WHERE code = 'LJ03'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'Loja 04'
        WHERE code = 'LJ04'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'Loja 05'
        WHERE code = 'LJ05'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'Loja 06'
        WHERE code = 'LJ06'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'Loja 07'
        WHERE code = 'LJ07'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'Loja 08'
        WHERE code = 'LJ08'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'Loja 09'
        WHERE code = 'LJ09'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'Loja 10'
        WHERE code = 'LJ10'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'Loja 11'
        WHERE code = 'LJ11'
        """
    )
    op.execute(
        """
        UPDATE stores
        SET name = 'Loja 12'
        WHERE code = 'LJ12'
        """
    )
