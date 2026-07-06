"""003_phase3_inventory

Revision ID: 003
Revises: 002_phase2_service_orders
Create Date: 2026-01-26

Phase 3: Gestão de Suprimentos e Estoque
- Purchase Requests (Solicitações de Compra)
- Inventory (Rastreabilidade de Películas)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create Phase 3 tables."""

    # ========================================
    # PURCHASE REQUESTS
    # ========================================
    op.create_table(
        "purchase_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("requested_by_id", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("urgency", sa.String(length=20), nullable=False, server_default="normal"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("total_amount", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("internal_notes", sa.Text(), nullable=True),
        sa.Column("approved_by_id", sa.Integer(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("ordered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["store_id"],
            ["stores.id"],
            name="fk_purchase_requests_store_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["requested_by_id"],
            ["users.id"],
            name="fk_purchase_requests_requested_by_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["approved_by_id"],
            ["users.id"],
            name="fk_purchase_requests_approved_by_id",
            ondelete="RESTRICT",
        ),
    )
    op.create_index(
        "ix_purchase_requests_store_id",
        "purchase_requests",
        ["store_id"],
    )
    op.create_index(
        "ix_purchase_requests_requested_by_id",
        "purchase_requests",
        ["requested_by_id"],
    )
    op.create_index(
        "ix_purchase_requests_category",
        "purchase_requests",
        ["category"],
    )
    op.create_index(
        "ix_purchase_requests_status",
        "purchase_requests",
        ["status"],
    )

    # ========================================
    # PURCHASE REQUEST ITEMS
    # ========================================
    op.create_table(
        "purchase_request_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("purchase_request_id", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("estimated_unit_price", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0"),
        sa.Column("approved_quantity", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["purchase_request_id"],
            ["purchase_requests.id"],
            name="fk_purchase_request_items_purchase_request_id",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_purchase_request_items_purchase_request_id",
        "purchase_request_items",
        ["purchase_request_id"],
    )

    # ========================================
    # FILM REELS (Bobinas de Película)
    # ========================================
    op.create_table(
        "film_reels",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("smart_id", sa.String(length=50), nullable=False),
        sa.Column("store_id", sa.Integer(), nullable=False),
        sa.Column("film_type", sa.String(length=20), nullable=False),
        sa.Column("nominal_length_meters", sa.Float(), nullable=False),
        sa.Column("used_length_meters", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("remaining_length_meters", sa.Float(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="in_stock"),
        sa.Column("purchase_request_id", sa.Integer(), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("first_use_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("depleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("smart_id", name="uq_film_reels_smart_id"),
        sa.ForeignKeyConstraint(
            ["store_id"],
            ["stores.id"],
            name="fk_film_reels_store_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["purchase_request_id"],
            ["purchase_requests.id"],
            name="fk_film_reels_purchase_request_id",
            ondelete="SET NULL",
        ),
    )
    op.create_index(
        "ix_film_reels_smart_id",
        "film_reels",
        ["smart_id"],
        unique=True,
    )
    op.create_index(
        "ix_film_reels_store_id",
        "film_reels",
        ["store_id"],
    )
    op.create_index(
        "ix_film_reels_film_type",
        "film_reels",
        ["film_type"],
    )
    op.create_index(
        "ix_film_reels_status",
        "film_reels",
        ["status"],
    )

    # ========================================
    # FILM USAGE LOGS
    # ========================================
    op.create_table(
        "film_usage_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("film_reel_id", sa.Integer(), nullable=False),
        sa.Column("service_order_id", sa.Integer(), nullable=False),
        sa.Column("meters_used", sa.Float(), nullable=False),
        sa.Column("used_by_id", sa.Integer(), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["film_reel_id"],
            ["film_reels.id"],
            name="fk_film_usage_logs_film_reel_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["service_order_id"],
            ["service_orders.id"],
            name="fk_film_usage_logs_service_order_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["used_by_id"],
            ["users.id"],
            name="fk_film_usage_logs_used_by_id",
            ondelete="RESTRICT",
        ),
    )
    op.create_index(
        "ix_film_usage_logs_film_reel_id",
        "film_usage_logs",
        ["film_reel_id"],
    )
    op.create_index(
        "ix_film_usage_logs_service_order_id",
        "film_usage_logs",
        ["service_order_id"],
    )


def downgrade() -> None:
    """Drop Phase 3 tables."""
    op.drop_table("film_usage_logs")
    op.drop_table("film_reels")
    op.drop_table("purchase_request_items")
    op.drop_table("purchase_requests")
