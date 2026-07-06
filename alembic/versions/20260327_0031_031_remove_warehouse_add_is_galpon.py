"""remove_warehouse_add_is_galpon

Revision ID: b7c2d3e4f5a6
Revises: a3f1b2c4d5e6
Create Date: 2026-03-27 00:00:00.000000-03:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c2d3e4f5a6'
down_revision: Union[str, None] = 'a3f1b2c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Delete service_order_items linked to OS from GP01
    conn.execute(sa.text("""
        DELETE FROM service_order_items
        WHERE service_order_id IN (
            SELECT id FROM service_orders
            WHERE store_id = (SELECT id FROM stores WHERE code = 'GP01')
        )
    """))

    # 2. Delete service_order_workers linked to OS from GP01
    conn.execute(sa.text("""
        DELETE FROM service_order_workers
        WHERE service_order_id IN (
            SELECT id FROM service_orders
            WHERE store_id = (SELECT id FROM stores WHERE code = 'GP01')
        )
    """))

    # 3. Delete status_history linked to OS from GP01
    conn.execute(sa.text("""
        DELETE FROM status_history
        WHERE service_order_id IN (
            SELECT id FROM service_orders
            WHERE store_id = (SELECT id FROM stores WHERE code = 'GP01')
        )
    """))

    # 4. Delete O.S. linked to GP01
    conn.execute(sa.text("""
        DELETE FROM service_orders
        WHERE store_id = (SELECT id FROM stores WHERE code = 'GP01')
    """))

    # 5. Set store_id = NULL for users linked to GP01
    conn.execute(sa.text("""
        UPDATE users
        SET store_id = NULL
        WHERE store_id = (SELECT id FROM stores WHERE code = 'GP01')
    """))

    # 6. Delete GP01 store
    conn.execute(sa.text("""
        DELETE FROM stores WHERE code = 'GP01'
    """))

    # 7. Drop CHECK constraint ck_stores_store_type (if exists)
    conn.execute(sa.text("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'ck_stores_store_type'
                  AND table_name = 'stores'
            ) THEN
                ALTER TABLE stores DROP CONSTRAINT ck_stores_store_type;
            END IF;
        END $$;
    """))

    # 8. Drop index ix_service_orders_destination_store_id (if exists)
    conn.execute(sa.text("""
        DROP INDEX IF EXISTS ix_service_orders_destination_store_id
    """))

    # 9. Drop FK constraint fk_service_orders_destination_store_id_stores (if exists)
    conn.execute(sa.text("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'fk_service_orders_destination_store_id_stores'
                  AND table_name = 'service_orders'
            ) THEN
                ALTER TABLE service_orders
                    DROP CONSTRAINT fk_service_orders_destination_store_id_stores;
            END IF;
        END $$;
    """))

    # 10. Drop column destination_store_id from service_orders (if exists)
    conn.execute(sa.text("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'service_orders'
                  AND column_name = 'destination_store_id'
            ) THEN
                ALTER TABLE service_orders DROP COLUMN destination_store_id;
            END IF;
        END $$;
    """))

    # 11. Drop column store_type from stores (if exists)
    conn.execute(sa.text("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'stores'
                  AND column_name = 'store_type'
            ) THEN
                ALTER TABLE stores DROP COLUMN store_type;
            END IF;
        END $$;
    """))

    # 12. Add is_galpon column to service_orders
    op.add_column(
        'service_orders',
        sa.Column('is_galpon', sa.Boolean(), nullable=False, server_default='false')
    )


def downgrade() -> None:
    pass
