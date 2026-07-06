"""add tonality and roll_code to service_order_items

Revision ID: 029
Revises: 028
Create Date: 2026-03-21

"""
from alembic import op
import sqlalchemy as sa

revision = '029'
down_revision = '028'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('service_order_items', sa.Column('tonality', sa.String(20), nullable=True))
    op.add_column('service_order_items', sa.Column('roll_code', sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column('service_order_items', 'roll_code')
    op.drop_column('service_order_items', 'tonality')
