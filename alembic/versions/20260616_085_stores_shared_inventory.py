"""stores shared inventory

Revision ID: 20260616_085
Revises: 20260615_084
Create Date: 2026-06-16

"""

import sqlalchemy as sa
from alembic import op

revision = "20260616_085"
down_revision = "20260615_084"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "stores",
        sa.Column(
            "has_shared_inventory", sa.Boolean(), server_default="false", nullable=False
        ),
    )
    op.create_table(
        "store_inventory_links",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("linked_store_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["linked_store_id"], ["stores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("store_id", "linked_store_id", name="uq_store_inventory_link"),
    )
    op.create_index(
        "ix_store_inventory_links_store_id", "store_inventory_links", ["store_id"]
    )
    op.create_index(
        "ix_store_inventory_links_linked_store_id",
        "store_inventory_links",
        ["linked_store_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_store_inventory_links_linked_store_id", table_name="store_inventory_links"
    )
    op.drop_index(
        "ix_store_inventory_links_store_id", table_name="store_inventory_links"
    )
    op.drop_table("store_inventory_links")
    op.drop_column("stores", "has_shared_inventory")
