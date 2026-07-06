"""Add predefined services and all_departments flag

Revision ID: 007
Revises: 006
Create Date: 2026-02-11

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import table, column
from datetime import datetime

# revision identifiers, used by Alembic.
revision: str = '007'
down_revision: Union[str, None] = '006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add available_for_all_departments column
    op.add_column(
        'services',
        sa.Column(
            'available_for_all_departments',
            sa.Boolean(),
            nullable=False,
            server_default='false'
        )
    )

    # Create a reference to the services table for data insertion
    services = table(
        'services',
        column('name', sa.String),
        column('department', sa.String),
        column('description', sa.Text),
        column('base_price', sa.Numeric),
        column('is_active', sa.Boolean),
        column('available_for_all_departments', sa.Boolean),
        column('created_at', sa.DateTime),
    )

    # Insert predefined services
    # These services are available for all departments
    predefined_services = [
        {
            'name': 'Lavagem Cortesia',
            'department': 'vn',  # Default department (can be any)
            'description': 'Serviço de lavagem cortesia',
            'base_price': 0.00,
            'is_active': True,
            'available_for_all_departments': True,
            'created_at': datetime.utcnow(),
        },
        {
            'name': 'Lavagem + Aspiração',
            'department': 'vn',
            'description': 'Serviço de lavagem com aspiração',
            'base_price': 0.00,
            'is_active': True,
            'available_for_all_departments': True,
            'created_at': datetime.utcnow(),
        },
        {
            'name': 'Lavagem + Aspiração + Motor',
            'department': 'vn',
            'description': 'Serviço de lavagem completa com motor',
            'base_price': 0.00,
            'is_active': True,
            'available_for_all_departments': True,
            'created_at': datetime.utcnow(),
        },
        {
            'name': 'Enceramento',
            'department': 'vn',
            'description': 'Serviço de enceramento',
            'base_price': 0.00,
            'is_active': True,
            'available_for_all_departments': True,
            'created_at': datetime.utcnow(),
        },
        {
            'name': 'Polimento',
            'department': 'vn',
            'description': 'Serviço de polimento',
            'base_price': 0.00,
            'is_active': True,
            'available_for_all_departments': True,
            'created_at': datetime.utcnow(),
        },
        {
            'name': 'Higienização Interna',
            'department': 'vn',
            'description': 'Serviço de higienização interna do veículo',
            'base_price': 0.00,
            'is_active': True,
            'available_for_all_departments': True,
            'created_at': datetime.utcnow(),
        },
        {
            'name': 'Impermeabilização Do Estofado',
            'department': 'vn',
            'description': 'Serviço de impermeabilização de estofado',
            'base_price': 0.00,
            'is_active': True,
            'available_for_all_departments': True,
            'created_at': datetime.utcnow(),
        },
        {
            'name': 'Hidratação',
            'department': 'vn',
            'description': 'Serviço de hidratação',
            'base_price': 0.00,
            'is_active': True,
            'available_for_all_departments': True,
            'created_at': datetime.utcnow(),
        },
        {
            'name': 'Vitrificação - Pintura',
            'department': 'vn',
            'description': 'Serviço de vitrificação de pintura',
            'base_price': 0.00,
            'is_active': True,
            'available_for_all_departments': True,
            'created_at': datetime.utcnow(),
        },
        {
            'name': 'Vitrificação - Banco de Couro',
            'department': 'vn',
            'description': 'Serviço de vitrificação de banco de couro',
            'base_price': 0.00,
            'is_active': True,
            'available_for_all_departments': True,
            'created_at': datetime.utcnow(),
        },
        {
            'name': 'VIP-CAR',
            'department': 'vn',
            'description': 'Serviço VIP-CAR completo',
            'base_price': 0.00,
            'is_active': True,
            'available_for_all_departments': True,
            'created_at': datetime.utcnow(),
        },
    ]

    op.bulk_insert(services, predefined_services)


def downgrade() -> None:
    # Remove predefined services
    op.execute(
        """
        DELETE FROM services
        WHERE available_for_all_departments = true
        AND name IN (
            'Lavagem Cortesia',
            'Lavagem + Aspiração',
            'Lavagem + Aspiração + Motor',
            'Enceramento',
            'Polimento',
            'Higienização Interna',
            'Impermeabilização Do Estofado',
            'Hidratação',
            'Vitrificação - Pintura',
            'Vitrificação - Banco de Couro',
            'VIP-CAR'
        )
        """
    )

    # Drop available_for_all_departments column
    op.drop_column('services', 'available_for_all_departments')
