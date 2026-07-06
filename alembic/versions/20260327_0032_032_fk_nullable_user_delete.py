"""make_created_by_and_changed_by_nullable

Revision ID: c8d9e0f1a2b3
Revises: b7c2d3e4f5a6
Create Date: 2026-03-27 00:32:00.000000-03:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c8d9e0f1a2b3'
down_revision: Union[str, None] = 'b7c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _drop_fk_if_exists(table: str, column: str) -> None:
    """Encontra e dropa a FK constraint de uma coluna usando information_schema."""
    op.execute(f"""
        DO $$
        DECLARE
            _con TEXT;
        BEGIN
            SELECT tc.constraint_name INTO _con
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_name = kcu.table_name
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_name = '{table}'
              AND kcu.column_name = '{column}'
            LIMIT 1;

            IF _con IS NOT NULL THEN
                EXECUTE 'ALTER TABLE {table} DROP CONSTRAINT ' || quote_ident(_con);
            END IF;
        END;
        $$;
    """)


def upgrade() -> None:
    # --- service_orders.created_by_id ---
    _drop_fk_if_exists('service_orders', 'created_by_id')

    op.alter_column(
        'service_orders',
        'created_by_id',
        existing_type=sa.Integer(),
        nullable=True,
    )
    op.create_foreign_key(
        'fk_service_orders_created_by_id_users',
        'service_orders',
        'users',
        ['created_by_id'],
        ['id'],
        ondelete='SET NULL',
    )

    # --- status_history.changed_by_id ---
    _drop_fk_if_exists('status_history', 'changed_by_id')

    op.alter_column(
        'status_history',
        'changed_by_id',
        existing_type=sa.Integer(),
        nullable=True,
    )
    op.create_foreign_key(
        'fk_status_history_changed_by_id_users',
        'status_history',
        'users',
        ['changed_by_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    # status_history
    op.drop_constraint(
        'fk_status_history_changed_by_id_users',
        'status_history',
        type_='foreignkey',
    )
    op.alter_column(
        'status_history',
        'changed_by_id',
        existing_type=sa.Integer(),
        nullable=False,
    )
    op.create_foreign_key(
        'status_history_changed_by_id_fkey',
        'status_history',
        'users',
        ['changed_by_id'],
        ['id'],
        ondelete='RESTRICT',
    )

    # service_orders
    op.drop_constraint(
        'fk_service_orders_created_by_id_users',
        'service_orders',
        type_='foreignkey',
    )
    op.alter_column(
        'service_orders',
        'created_by_id',
        existing_type=sa.Integer(),
        nullable=False,
    )
    op.create_foreign_key(
        'service_orders_created_by_id_fkey',
        'service_orders',
        'users',
        ['created_by_id'],
        ['id'],
        ondelete='RESTRICT',
    )
