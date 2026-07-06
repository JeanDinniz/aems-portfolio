"""add department to film_types, nullable tonality in film_rolls

Revision ID: 056_add_department_film_types
Revises: 055_remove_abandoned_status_fields
Create Date: 2026-04-29
"""

import sqlalchemy as sa
from alembic import op

revision = "056_add_department_film_types"
down_revision = "055_rm_abandoned_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "film_types",
        sa.Column("department", sa.String(10), nullable=False, server_default="film"),
    )
    op.create_index("ix_film_types_department", "film_types", ["department"])
    op.alter_column("film_rolls", "tonality", existing_type=sa.String(20), nullable=True)


def downgrade() -> None:
    op.alter_column("film_rolls", "tonality", existing_type=sa.String(20), nullable=False)
    op.drop_index("ix_film_types_department", table_name="film_types")
    op.drop_column("film_types", "department")
