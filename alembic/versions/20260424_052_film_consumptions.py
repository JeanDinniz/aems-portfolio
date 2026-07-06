"""create film_consumptions table

Revision ID: 052_film_consumptions
Revises: 051_film_rolls
Create Date: 2026-04-24
"""

import sqlalchemy as sa

from alembic import op

revision = "052_film_consumptions"
down_revision = "051_film_rolls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "film_consumptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("film_roll_id", sa.Integer(), nullable=False),
        sa.Column("service_order_item_id", sa.Integer(), nullable=True),
        sa.Column("meters_consumed", sa.Float(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["film_roll_id"],
            ["film_rolls.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["service_order_item_id"],
            ["service_order_items.id"],
            ondelete="SET NULL",
        ),
    )
    op.create_index("ix_film_consumptions_film_roll_id", "film_consumptions", ["film_roll_id"])
    op.create_index(
        "ix_film_consumptions_service_order_item_id",
        "film_consumptions",
        ["service_order_item_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_film_consumptions_service_order_item_id", table_name="film_consumptions"
    )
    op.drop_index("ix_film_consumptions_film_roll_id", table_name="film_consumptions")
    op.drop_table("film_consumptions")
