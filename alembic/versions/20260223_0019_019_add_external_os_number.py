"""Add external_os_number to service_orders

Revision ID: 019
Revises: 018
Create Date: 2026-02-23

Contexto:
  Armazena o número de OS gerado pelo sistema próprio da concessionária
  (Toyota, BYD, Fiat, Hyundai) para permitir rastreabilidade cruzada
  entre o AEMS e o sistema externo. Usado principalmente para lojas
  do tipo 'dealership'.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '019'
down_revision: Union[str, None] = '018'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add external_os_number column and index to service_orders."""

    op.add_column(
        'service_orders',
        sa.Column('external_os_number', sa.String(100), nullable=True),
    )

    op.create_index(
        'ix_service_orders_external_os_number',
        'service_orders',
        ['external_os_number'],
    )


def downgrade() -> None:
    """Remove external_os_number index and column from service_orders."""

    op.drop_index(
        'ix_service_orders_external_os_number',
        table_name='service_orders',
    )

    op.drop_column('service_orders', 'external_os_number')
