"""Allow cancelled status in service_orders

Revision ID: 024
Revises: 023
Create Date: 2026-02-23

Contexto:
  Remove a CHECK constraint ck_service_orders_status para permitir o
  valor 'cancelled' (cancelamento de O.S. via soft delete).
  A validação de status fica a cargo do Python/Pydantic.
"""

from typing import Sequence, Union

from alembic import op

revision: str = '024'
down_revision: Union[str, None] = '023'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Remove a CHECK constraint de status para permitir 'cancelled'."""
    op.drop_constraint('ck_service_orders_status', 'service_orders', type_='check')


def downgrade() -> None:
    """Restaura a constraint original (sem cancelled)."""
    op.create_check_constraint(
        'ck_service_orders_status',
        'service_orders',
        "status IN ('waiting', 'in_progress', 'quality_check', 'completed', 'delivered')"
    )
