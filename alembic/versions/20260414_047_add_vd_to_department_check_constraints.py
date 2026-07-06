"""Add 'vd' (Venda Direta) to department CHECK constraints

Revision ID: 047
Revises: 046
Create Date: 2026-04-14

Contexto:
  O departamento VD (Venda Direta) foi adicionado ao enum ServiceDepartment,
  mas as CHECK constraints criadas na migration 025 não incluíam 'vd'.
  Isso causava IntegrityError (500) ao tentar criar OS ou serviços com
  department = 'vd'.
"""

from typing import Sequence, Union

from alembic import op

revision: str = '047'
down_revision: Union[str, None] = '046_payment_consultants'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS ck_service_orders_department")
    op.execute(
        "ALTER TABLE service_orders ADD CONSTRAINT ck_service_orders_department "
        "CHECK (department IN ('film', 'ppf', 'bodywork', 'vn', 'vd', 'vu', 'workshop'))"
    )

    op.execute("ALTER TABLE services DROP CONSTRAINT IF EXISTS ck_services_department")
    op.execute(
        "ALTER TABLE services ADD CONSTRAINT ck_services_department "
        "CHECK (department IN ('film', 'ppf', 'bodywork', 'vn', 'vd', 'vu', 'workshop'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS ck_service_orders_department")
    op.execute(
        "ALTER TABLE service_orders ADD CONSTRAINT ck_service_orders_department "
        "CHECK (department IN ('film', 'ppf', 'bodywork', 'vn', 'vu', 'workshop'))"
    )

    op.execute("ALTER TABLE services DROP CONSTRAINT IF EXISTS ck_services_department")
    op.execute(
        "ALTER TABLE services ADD CONSTRAINT ck_services_department "
        "CHECK (department IN ('film', 'ppf', 'bodywork', 'vn', 'vu', 'workshop'))"
    )
