"""Add store_id to consultants table

Revision ID: 010
Revises: 009
Create Date: 2026-02-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '010'
down_revision: Union[str, None] = '009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add store_id column to consultants and populate from dealership."""

    # Add store_id column (nullable temporarily)
    op.add_column('consultants', sa.Column('store_id', sa.Integer(), nullable=True))

    # Populate store_id from dealership's store_id
    op.execute("""
        UPDATE consultants
        SET store_id = (
            SELECT store_id
            FROM dealerships
            WHERE dealerships.id = consultants.dealership_id
        )
    """)

    # Make store_id NOT NULL
    op.alter_column('consultants', 'store_id', nullable=False)

    # Add foreign key constraint
    op.create_foreign_key(
        'fk_consultants_store_id',
        'consultants',
        'stores',
        ['store_id'],
        ['id'],
        ondelete='CASCADE'
    )

    # Add index on store_id
    op.create_index('ix_consultants_store_id', 'consultants', ['store_id'])


def downgrade() -> None:
    """Remove store_id column from consultants."""

    # Drop index
    op.drop_index('ix_consultants_store_id', table_name='consultants')

    # Drop foreign key constraint
    op.drop_constraint('fk_consultants_store_id', 'consultants', type_='foreignkey')

    # Drop column
    op.drop_column('consultants', 'store_id')
