"""create film_types table

Revision ID: 049_film_types
Revises: 048_hide_galpon_option
Create Date: 2026-04-24
"""

import sqlalchemy as sa

from alembic import op

revision = "049_film_types"
down_revision = "048_hide_galpon_option"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "film_types",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("yellow_threshold_meters", sa.Float(), nullable=False, server_default="10.0"),
        sa.Column("red_threshold_meters", sa.Float(), nullable=False, server_default="3.0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_film_types_name", "film_types", ["name"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_film_types_name", table_name="film_types")
    op.drop_table("film_types")
