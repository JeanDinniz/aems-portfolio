"""add appointments table

Revision ID: 058_add_appointments_table
Revises: 057_supplier_nfe_film_rolls
Create Date: 2026-04-30
"""

import sqlalchemy as sa
from alembic import op

revision = "058_add_appointments_table"
down_revision = "057_supplier_nfe_film_rolls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "appointments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "store_id",
            sa.Integer(),
            sa.ForeignKey("stores.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("department", sa.String(20), nullable=False),
        sa.Column("scheduled_date", sa.Date(), nullable=False),
        sa.Column("delivery_date", sa.Date(), nullable=False),
        sa.Column("external_os_number", sa.String(100), nullable=True),
        sa.Column("vehicle_plate", sa.String(17), nullable=False),
        sa.Column("vehicle_model", sa.String(100), nullable=True),
        sa.Column("vehicle_color", sa.String(50), nullable=True),
        sa.Column(
            "consultant_id",
            sa.Integer(),
            sa.ForeignKey("consultants.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("consultant_name", sa.String(200), nullable=True),
        sa.Column(
            "film_type_id",
            sa.Integer(),
            sa.ForeignKey("film_types.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("film_tonality", sa.String(20), nullable=True),
        sa.Column("ppf_type", sa.String(100), nullable=True),
        sa.Column("ppf_brand", sa.String(100), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="scheduled"),
        sa.Column(
            "service_order_id",
            sa.Integer(),
            sa.ForeignKey("service_orders.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancellation_reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_appointments_store_id", "appointments", ["store_id"])
    op.create_index("ix_appointments_delivery_date", "appointments", ["delivery_date"])
    op.create_index("ix_appointments_status", "appointments", ["status"])
    op.create_index("ix_appointments_vehicle_plate", "appointments", ["vehicle_plate"])
    op.create_index("ix_appointments_department", "appointments", ["department"])
    op.create_index(
        "ix_appointments_store_delivery", "appointments", ["store_id", "delivery_date"]
    )


def downgrade() -> None:
    op.drop_index("ix_appointments_store_delivery", "appointments")
    op.drop_index("ix_appointments_department", "appointments")
    op.drop_index("ix_appointments_vehicle_plate", "appointments")
    op.drop_index("ix_appointments_status", "appointments")
    op.drop_index("ix_appointments_delivery_date", "appointments")
    op.drop_index("ix_appointments_store_id", "appointments")
    op.drop_table("appointments")
