"""create film_rolls table

Revision ID: 051_film_rolls
Revises: 050_film_type_services
Create Date: 2026-04-24
"""

import sqlalchemy as sa

from alembic import op

revision = "051_film_rolls"
down_revision = "050_film_type_services"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "film_rolls",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("film_type_id", sa.Integer(), nullable=False),
        sa.Column("tonality", sa.String(20), nullable=False),
        sa.Column("total_meters", sa.Float(), nullable=False),
        sa.Column("remaining_meters", sa.Float(), nullable=False),
        sa.Column("receipt_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="em_estoque"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["film_type_id"], ["film_types.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_film_rolls_store_id", "film_rolls", ["store_id"])
    op.create_index("ix_film_rolls_film_type_id", "film_rolls", ["film_type_id"])
    op.create_index("ix_film_rolls_tonality", "film_rolls", ["tonality"])
    op.create_index("ix_film_rolls_receipt_date", "film_rolls", ["receipt_date"])
    op.create_index("ix_film_rolls_status", "film_rolls", ["status"])


def downgrade() -> None:
    op.drop_index("ix_film_rolls_status", table_name="film_rolls")
    op.drop_index("ix_film_rolls_receipt_date", table_name="film_rolls")
    op.drop_index("ix_film_rolls_tonality", table_name="film_rolls")
    op.drop_index("ix_film_rolls_film_type_id", table_name="film_rolls")
    op.drop_index("ix_film_rolls_store_id", table_name="film_rolls")
    op.drop_table("film_rolls")
