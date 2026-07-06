"""add hide_galpon_option to access_profiles

Revision ID: 048_hide_galpon_option
Revises: 20260414_047_add_vd_to_department_check_constraints
Create Date: 2026-04-14
"""

from alembic import op
import sqlalchemy as sa

revision = "048_hide_galpon_option"
down_revision = "047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "access_profiles",
        sa.Column(
            "hide_galpon_option",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    op.drop_column("access_profiles", "hide_galpon_option")
