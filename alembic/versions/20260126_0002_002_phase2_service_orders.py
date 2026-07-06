"""Phase 2 - Service Orders tables - dealerships, consultants, services, service_orders

Revision ID: 002
Revises: 001
Create Date: 2026-01-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '002'
down_revision: Union[str, None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create dealerships table
    op.create_table(
        'dealerships',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('store_id', sa.Integer(), sa.ForeignKey('stores.id', ondelete='CASCADE'), nullable=False),
        sa.Column('brand', sa.String(100), nullable=False),
        sa.Column('address', sa.String(500), nullable=True),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_dealerships_store_id', 'dealerships', ['store_id'])

    # Create consultants table
    op.create_table(
        'consultants',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('dealership_id', sa.Integer(), sa.ForeignKey('dealerships.id', ondelete='CASCADE'), nullable=False),
        sa.Column('phone', sa.String(20), nullable=True),
        sa.Column('email', sa.String(200), nullable=True),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_consultants_dealership_id', 'consultants', ['dealership_id'])

    # Create services table
    op.create_table(
        'services',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('department', sa.String(20), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('base_price', sa.Numeric(10, 2), nullable=False, default=0),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("department IN ('film', 'bodywork', 'esthetics')", name='ck_services_department'),
    )
    op.create_index('ix_services_name', 'services', ['name'])
    op.create_index('ix_services_department', 'services', ['department'])

    # Create service_orders table
    op.create_table(
        'service_orders',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('store_id', sa.Integer(), sa.ForeignKey('stores.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('dealership_id', sa.Integer(), sa.ForeignKey('dealerships.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('consultant_id', sa.Integer(), sa.ForeignKey('consultants.id', ondelete='SET NULL'), nullable=True),

        # Vehicle data
        sa.Column('vehicle_plate', sa.String(10), nullable=False),
        sa.Column('vehicle_brand', sa.String(100), nullable=True),
        sa.Column('vehicle_model', sa.String(100), nullable=True),
        sa.Column('vehicle_color', sa.String(50), nullable=True),
        sa.Column('vehicle_year', sa.Integer(), nullable=True),

        # Department and status
        sa.Column('department', sa.String(20), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, default='waiting'),

        # Time tracking
        sa.Column('entry_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('start_time', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completion_time', sa.DateTime(timezone=True), nullable=True),
        sa.Column('delivery_time', sa.DateTime(timezone=True), nullable=True),

        # Damage map and photos
        sa.Column('damage_map', sa.Text(), nullable=True),
        sa.Column('photos', sa.Text(), nullable=True),

        # Notes
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('internal_notes', sa.Text(), nullable=True),

        # Quality and invoice
        sa.Column('requires_invoice', sa.Boolean(), default=False),
        sa.Column('invoice_number', sa.String(100), nullable=True),
        sa.Column('quality_checklist', sa.Text(), nullable=True),

        # Creator
        sa.Column('created_by_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False),

        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),

        sa.CheckConstraint("department IN ('film', 'bodywork', 'esthetics')", name='ck_service_orders_department'),
        sa.CheckConstraint(
            "status IN ('waiting', 'in_progress', 'quality_check', 'completed', 'delivered')",
            name='ck_service_orders_status'
        ),
    )
    op.create_index('ix_service_orders_store_id', 'service_orders', ['store_id'])
    op.create_index('ix_service_orders_dealership_id', 'service_orders', ['dealership_id'])
    op.create_index('ix_service_orders_vehicle_plate', 'service_orders', ['vehicle_plate'])
    op.create_index('ix_service_orders_department', 'service_orders', ['department'])
    op.create_index('ix_service_orders_status', 'service_orders', ['status'])
    op.create_index('ix_service_orders_entry_time', 'service_orders', ['entry_time'])
    # Composite index for day panel queries
    op.create_index(
        'ix_service_orders_store_status',
        'service_orders',
        ['store_id', 'status'],
    )

    # Create service_order_items table
    op.create_table(
        'service_order_items',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('service_order_id', sa.Integer(), sa.ForeignKey('service_orders.id', ondelete='CASCADE'), nullable=False),
        sa.Column('service_id', sa.Integer(), sa.ForeignKey('services.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('quantity', sa.Integer(), default=1, nullable=False),
        sa.Column('unit_price', sa.Numeric(10, 2), nullable=False, default=0),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_service_order_items_service_order_id', 'service_order_items', ['service_order_id'])

    # Create service_order_workers table
    op.create_table(
        'service_order_workers',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('service_order_id', sa.Integer(), sa.ForeignKey('service_orders.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('start_time', sa.DateTime(timezone=True), nullable=True),
        sa.Column('end_time', sa.DateTime(timezone=True), nullable=True),
        sa.Column('hours_worked', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_service_order_workers_service_order_id', 'service_order_workers', ['service_order_id'])

    # Create status_history table
    op.create_table(
        'status_history',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('service_order_id', sa.Integer(), sa.ForeignKey('service_orders.id', ondelete='CASCADE'), nullable=False),
        sa.Column('from_status', sa.String(20), nullable=True),
        sa.Column('to_status', sa.String(20), nullable=False),
        sa.Column('changed_by_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('changed_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_status_history_service_order_id', 'status_history', ['service_order_id'])


def downgrade() -> None:
    op.drop_table('status_history')
    op.drop_table('service_order_workers')
    op.drop_table('service_order_items')
    op.drop_table('service_orders')
    op.drop_table('services')
    op.drop_table('consultants')
    op.drop_table('dealerships')
