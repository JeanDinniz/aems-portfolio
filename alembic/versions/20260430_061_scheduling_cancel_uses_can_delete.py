"""scheduling: cancel uses can_delete; backfill from can_edit

Revision ID: 20260430_061
Revises: 20260430_060
Create Date: 2026-04-30
"""

from alembic import op

revision = "20260430_061"
down_revision = "060_add_appointment_flags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        UPDATE access_profile_module_permissions
        SET can_delete = can_edit
        WHERE sub_module = 'scheduling'
    """)


def downgrade() -> None:
    pass
