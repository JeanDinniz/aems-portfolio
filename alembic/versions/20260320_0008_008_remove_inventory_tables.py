"""Remove inventory tables

Revision ID: 008_remove_inventory_tables
Revises: 007_remove_clients_vehicles_tables
Create Date: 2026-03-20
"""
from alembic import op

revision = '008_remove_inventory_tables'
down_revision = '007_remove_clients_vehicles'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('DROP TABLE IF EXISTS film_usage_logs CASCADE')
    op.execute('DROP TABLE IF EXISTS film_reels CASCADE')


def downgrade() -> None:
    pass
