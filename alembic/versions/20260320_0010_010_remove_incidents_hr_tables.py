"""Remove incidents and HR tables

Revision ID: 010_remove_incidents_hr_tables
Revises: 009_remove_purchase_requests
Create Date: 2026-03-20
"""
from alembic import op

revision = '010_remove_incidents_hr_tables'
down_revision = '009_remove_purchase_requests'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('DROP TABLE IF EXISTS incident_comments')
    op.execute('DROP TABLE IF EXISTS incidents')
    op.execute('DROP TABLE IF EXISTS occurrences')


def downgrade() -> None:
    pass
