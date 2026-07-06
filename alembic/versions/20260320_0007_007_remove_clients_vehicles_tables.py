"""Remove clients and vehicles tables

Revision ID: 007_remove_clients_vehicles_tables
Revises: 006_remove_reports_tables
Create Date: 2026-03-20
"""
from alembic import op

revision = '007_remove_clients_vehicles'
down_revision = '006_remove_reports_tables'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('DROP TABLE IF EXISTS vehicles')
    op.execute('DROP TABLE IF EXISTS clients')


def downgrade() -> None:
    pass
