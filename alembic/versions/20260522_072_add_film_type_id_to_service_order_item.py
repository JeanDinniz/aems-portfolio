"""add film_type_id to service_order_items

Revision ID: 20260522_072
Revises: 20260521_071_unique_name_constraints
Create Date: 2026-05-22
"""

from alembic import op
import sqlalchemy as sa

revision = "20260522_072"
down_revision = "20260521_071"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "service_order_items",
        sa.Column("film_type_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_service_order_items_film_type_id",
        "service_order_items",
        "film_types",
        ["film_type_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_service_order_items_film_type_id",
        "service_order_items",
        type_="foreignkey",
    )
    op.drop_column("service_order_items", "film_type_id")
