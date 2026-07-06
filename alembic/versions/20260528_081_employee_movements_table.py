"""create employee_movements table

Revision ID: 20260528_081
Revises: 20260528_080
Create Date: 2026-05-28

"""

import sqlalchemy as sa
from alembic import op

revision = "20260528_081"
down_revision = "20260528_080"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "employee_movements",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "employee_id",
            sa.Integer(),
            sa.ForeignKey("employees.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("type", sa.String(50), nullable=False, index=True),
        sa.Column("movement_date", sa.Date(), nullable=False),
        sa.Column("movement_data", sa.JSON(), nullable=True),
        sa.Column("attachment_url", sa.String(500), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("employee_movements")
