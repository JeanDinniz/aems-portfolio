"""Update departments - Remove esthetics, add vn, vu, workshop

Revision ID: 006
Revises: 005
Create Date: 2026-02-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '006'
down_revision: Union[str, None] = '005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop old constraints
    op.drop_constraint('ck_services_department', 'services', type_='check')
    op.drop_constraint('ck_service_orders_department', 'service_orders', type_='check')

    # Update any existing 'esthetics' records to 'vn' (default migration)
    # You may want to handle this differently based on your business logic
    op.execute(
        """
        UPDATE services
        SET department = 'vn'
        WHERE department = 'esthetics'
        """
    )
    op.execute(
        """
        UPDATE service_orders
        SET department = 'vn'
        WHERE department = 'esthetics'
        """
    )
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'monthly_goals' in inspector.get_table_names():
        op.execute(
            """
            UPDATE monthly_goals
            SET department = 'vn'
            WHERE department = 'esthetics'
            """
        )

    # Add new constraints with updated departments
    op.create_check_constraint(
        'ck_services_department',
        'services',
        "department IN ('film', 'bodywork', 'vn', 'vu', 'workshop')"
    )
    op.create_check_constraint(
        'ck_service_orders_department',
        'service_orders',
        "department IN ('film', 'bodywork', 'vn', 'vu', 'workshop')"
    )


def downgrade() -> None:
    # Drop new constraints
    op.drop_constraint('ck_services_department', 'services', type_='check')
    op.drop_constraint('ck_service_orders_department', 'service_orders', type_='check')

    # Restore old constraints
    op.create_check_constraint(
        'ck_services_department',
        'services',
        "department IN ('film', 'bodywork', 'esthetics')"
    )
    op.create_check_constraint(
        'ck_service_orders_department',
        'service_orders',
        "department IN ('film', 'bodywork', 'esthetics')"
    )

    # Revert department changes
    op.execute(
        """
        UPDATE services
        SET department = 'esthetics'
        WHERE department IN ('vn', 'vu', 'workshop')
        """
    )
    op.execute(
        """
        UPDATE service_orders
        SET department = 'esthetics'
        WHERE department IN ('vn', 'vu', 'workshop')
        """
    )
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'monthly_goals' in inspector.get_table_names():
        op.execute(
            """
            UPDATE monthly_goals
            SET department = 'esthetics'
            WHERE department IN ('vn', 'vu', 'workshop')
            """
        )
