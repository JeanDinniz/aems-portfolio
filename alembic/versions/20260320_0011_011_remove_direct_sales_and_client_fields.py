"""Remove direct_sales store type and client fields from service_orders

Revision ID: 011_remove_direct_sales_fields
Revises: 010_remove_incidents_hr_tables
Create Date: 2026-03-20
"""
from alembic import op
import sqlalchemy as sa

revision = '011_remove_direct_sales_fields'
down_revision = '010_remove_incidents_hr_tables'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop views that depend on client columns before removing the columns
    op.execute('DROP VIEW IF EXISTS v_day_panel CASCADE')

    # Remove client fields from service_orders if they exist
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_cols = [c['name'] for c in inspector.get_columns('service_orders')]
    for col in ('client_name', 'client_phone', 'total_value'):
        if col in existing_cols:
            op.drop_column('service_orders', col)

    # Delete any stores with direct_sales type (only if store_type column exists)
    store_cols = [c['name'] for c in inspector.get_columns('stores')]
    if 'store_type' in store_cols:
        op.execute("DELETE FROM stores WHERE store_type = 'direct_sales'")


def downgrade() -> None:
    pass
