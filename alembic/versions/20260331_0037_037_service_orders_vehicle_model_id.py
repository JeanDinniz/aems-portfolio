"""service_orders_vehicle_model_id

Revision ID: 037_so_vehicle_model_id
Revises: 036_vehicle_models_to_brand
Create Date: 2026-03-31 00:37:00.000000-03:00

Adiciona vehicle_model_id (FK opcional -> vehicle_models) em service_orders.
Permite vincular uma O.S. a um modelo do catálogo sem perder os campos de texto livre.
ondelete=SET NULL para preservar O.S. ao excluir modelos de veículo.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '037_so_vehicle_model_id'
down_revision: Union[str, None] = '036_vehicle_models_to_brand'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'service_orders',
        sa.Column('vehicle_model_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_service_orders_vehicle_model_id',
        'service_orders',
        'vehicle_models',
        ['vehicle_model_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_index(
        'ix_service_orders_vehicle_model_id',
        'service_orders',
        ['vehicle_model_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_service_orders_vehicle_model_id', table_name='service_orders')
    op.drop_constraint(
        'fk_service_orders_vehicle_model_id',
        'service_orders',
        type_='foreignkey',
    )
    op.drop_column('service_orders', 'vehicle_model_id')
