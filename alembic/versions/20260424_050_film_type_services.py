"""create film_type_services table

Revision ID: 050_film_type_services
Revises: 049_film_types
Create Date: 2026-04-24
"""

import sqlalchemy as sa

from alembic import op

revision = "050_film_type_services"
down_revision = "049_film_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "film_type_services",
        sa.Column("film_type_id", sa.Integer(), nullable=False),
        sa.Column("service_id", sa.Integer(), nullable=False),
        sa.Column("meters_consumed", sa.Float(), nullable=False, server_default="1.0"),
        sa.ForeignKeyConstraint(
            ["film_type_id"],
            ["film_types.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["service_id"],
            ["services.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("film_type_id", "service_id"),
        sa.UniqueConstraint("film_type_id", "service_id", name="uq_film_type_service"),
    )


def downgrade() -> None:
    op.drop_table("film_type_services")
