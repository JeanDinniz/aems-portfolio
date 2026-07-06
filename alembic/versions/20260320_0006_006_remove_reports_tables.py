"""Remove reports tables (dashboard removed)

Revision ID: 006_remove_reports_tables
Revises: 005_phase5_reports
Create Date: 2026-03-20
"""
from alembic import op

revision = '006_remove_reports_tables'
down_revision = '005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('DROP TABLE IF EXISTS metrics_cache')
    op.execute('DROP TABLE IF EXISTS quality_audits')
    op.execute('DROP TABLE IF EXISTS monthly_goals')


def downgrade() -> None:
    pass
