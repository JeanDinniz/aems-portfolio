"""employees last_name birth_date hr_status fields

Revision ID: 20260528_080
Revises: 20260526_079
Create Date: 2026-05-28

"""

import sqlalchemy as sa
from alembic import op

revision = "20260528_080"
down_revision = "20260526_079"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("last_name", sa.String(200), nullable=True))
    op.add_column("employees", sa.Column("birth_date", sa.Date(), nullable=True))
    op.add_column(
        "employees",
        sa.Column(
            "hr_status",
            sa.String(20),
            nullable=False,
            server_default="active",
        ),
    )
    op.create_index("ix_employees_hr_status", "employees", ["hr_status"])
    # Migrar dados: funcionários inativos (is_active=False) → hr_status='dismissed'
    op.execute("UPDATE employees SET hr_status = 'dismissed' WHERE is_active = FALSE")


def downgrade() -> None:
    op.drop_index("ix_employees_hr_status", table_name="employees")
    op.drop_column("employees", "hr_status")
    op.drop_column("employees", "birth_date")
    op.drop_column("employees", "last_name")
