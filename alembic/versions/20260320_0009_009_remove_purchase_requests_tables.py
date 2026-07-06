"""Remove purchase_requests tables

Revision ID: 009_remove_purchase_requests
Revises: 008_remove_inventory_tables
Create Date: 2026-03-20
"""
from alembic import op

revision = '009_remove_purchase_requests'
down_revision = '008_remove_inventory_tables'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('DROP TABLE IF EXISTS purchase_request_items')
    op.execute('DROP TABLE IF EXISTS purchase_requests')


def downgrade() -> None:
    pass
