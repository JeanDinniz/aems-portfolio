"""services_brand_id_and_cleanup

Revision ID: 035_services_brand_id
Revises: 034_stores_add_brand_id
Create Date: 2026-03-31 00:35:00.000000-03:00

Migra services.brand (string) para services.brand_id (FK -> brands).
Remove colunas obsoletas: brand (string), category, available_for_all_departments.
Substitui o índice único antigo por uq_service_code_brand_dept (code, brand_id, department).
O índice funciona corretamente com NULL em code: PostgreSQL ignora entradas com NULL
em qualquer coluna indexada em UNIQUE INDEX por padrão.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '035_services_brand_id'
down_revision: Union[str, None] = '034_stores_add_brand_id'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Adicionar coluna brand_id nullable
    op.add_column('services', sa.Column('brand_id', sa.Integer(), nullable=True))

    # 2. Popular brand_id a partir da coluna brand (string)
    op.execute(
        """
        UPDATE services s
        SET brand_id = b.id
        FROM brands b
        WHERE b.code = s.brand
        """
    )

    # 3. Serviços sem brand (genéricos) recebem brand_id=1 (Toyota) como fallback
    #    Na prática, migration 027 já garantiu que todos têm brand definida.
    op.execute(
        "UPDATE services SET brand_id = 1 WHERE brand_id IS NULL"
    )

    # 4. Tornar NOT NULL
    op.alter_column('services', 'brand_id', nullable=False)

    # 5. Criar FK
    op.create_foreign_key(
        'fk_services_brand_id',
        'services',
        'brands',
        ['brand_id'],
        ['id'],
    )
    op.create_index('ix_services_brand_id', 'services', ['brand_id'], unique=False)

    # 6. Remover índice único antigo (funcional com COALESCE)
    op.execute("DROP INDEX IF EXISTS uq_services_name_department_brand")

    # 7. Criar novo índice único (code, brand_id, department)
    #    NULL em code é excluído automaticamente pelo PostgreSQL — sem colisões espúrias.
    op.execute(
        """
        CREATE UNIQUE INDEX uq_service_code_brand_dept
        ON services (code, brand_id, department)
        WHERE code IS NOT NULL
        """
    )

    # 8. Remover colunas obsoletas
    op.drop_column('services', 'brand')
    op.drop_column('services', 'category')
    op.drop_column('services', 'available_for_all_departments')


def downgrade() -> None:
    # Recriar colunas removidas
    op.add_column('services', sa.Column('available_for_all_departments', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('services', sa.Column('category', sa.String(length=50), nullable=True))
    op.add_column('services', sa.Column('brand', sa.String(length=20), nullable=True))

    # Restaurar brand string a partir de brand_id
    op.execute(
        """
        UPDATE services s
        SET brand = b.code
        FROM brands b
        WHERE b.id = s.brand_id
        """
    )

    # Remover novo índice
    op.execute("DROP INDEX IF EXISTS uq_service_code_brand_dept")

    # Recriar índice antigo
    op.execute(
        """
        CREATE UNIQUE INDEX uq_services_name_department_brand
        ON services (name, department, COALESCE(brand, ''))
        """
    )

    # Remover FK e coluna brand_id
    op.drop_index('ix_services_brand_id', table_name='services')
    op.drop_constraint('fk_services_brand_id', 'services', type_='foreignkey')
    op.drop_column('services', 'brand_id')
