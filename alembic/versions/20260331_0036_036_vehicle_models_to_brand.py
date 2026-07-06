"""vehicle_models_to_brand

Revision ID: 036_vehicle_models_to_brand
Revises: 035_services_brand_id
Create Date: 2026-03-31 00:36:00.000000-03:00

Move vehicle_models de store para brand:
- Adiciona brand_id (FK -> brands) derivado do store.brand_id
- Remove store_id e brand (string)
- Atualiza constraint única de (store_id, name) para (brand_id, name)
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '036_vehicle_models_to_brand'
down_revision: Union[str, None] = '035_services_brand_id'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Adicionar brand_id nullable
    op.add_column('vehicle_models', sa.Column('brand_id', sa.Integer(), nullable=True))

    # 2. Popular brand_id a partir do store.brand_id
    op.execute(
        """
        UPDATE vehicle_models vm
        SET brand_id = s.brand_id
        FROM stores s
        WHERE vm.store_id = s.id
        """
    )

    # 3. Fallback para modelos sem store (não deveria ocorrer, mas por segurança)
    op.execute(
        "UPDATE vehicle_models SET brand_id = 1 WHERE brand_id IS NULL"
    )

    # 4. Tornar NOT NULL
    op.alter_column('vehicle_models', 'brand_id', nullable=False)

    # 5. Criar FK e índice
    op.create_foreign_key(
        'fk_vehicle_models_brand_id',
        'vehicle_models',
        'brands',
        ['brand_id'],
        ['id'],
    )
    op.create_index('ix_vehicle_models_brand_id', 'vehicle_models', ['brand_id'], unique=False)

    # 6. Remover constraint única antiga (store_id, name)
    op.drop_constraint('uq_vehicle_model_store_name', 'vehicle_models', type_='unique')

    # 6b. Deduplicar: múltiplas lojas da mesma marca tinham modelos com o mesmo nome.
    # Mantém o registro de menor ID por (brand_id, name) e deleta os demais.
    op.execute(
        """
        DELETE FROM vehicle_models vm
        WHERE vm.id NOT IN (
            SELECT MIN(id)
            FROM vehicle_models
            GROUP BY brand_id, name
        )
        """
    )

    # 7. Criar nova constraint única (brand_id, name)
    op.create_unique_constraint(
        'uq_vehicle_model_brand_name',
        'vehicle_models',
        ['brand_id', 'name'],
    )

    # 8. Remover FK de store_id usando helper dinâmico (nome pode variar)
    op.execute(
        """
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
              AND tc.table_name = 'vehicle_models'
              AND kcu.column_name = 'store_id'
            LIMIT 1;

            IF _con IS NOT NULL THEN
                EXECUTE 'ALTER TABLE vehicle_models DROP CONSTRAINT ' || quote_ident(_con);
            END IF;
        END;
        $$;
        """
    )

    # 9. Remover índice de store_id
    op.drop_index('ix_vehicle_models_store_id', table_name='vehicle_models')

    # 10. Remover colunas obsoletas
    op.drop_column('vehicle_models', 'store_id')
    op.drop_column('vehicle_models', 'brand')


def downgrade() -> None:
    # Recriar colunas
    op.add_column('vehicle_models', sa.Column('brand', sa.String(length=50), nullable=True))
    op.add_column('vehicle_models', sa.Column('store_id', sa.Integer(), nullable=True))

    # Tentar recuperar store_id a partir do brand_id (pega a primeira loja da marca)
    op.execute(
        """
        UPDATE vehicle_models vm
        SET store_id = (
            SELECT s.id FROM stores s WHERE s.brand_id = vm.brand_id LIMIT 1
        )
        """
    )

    # Restaurar brand string
    op.execute(
        """
        UPDATE vehicle_models vm
        SET brand = b.name
        FROM brands b
        WHERE b.id = vm.brand_id
        """
    )

    op.alter_column('vehicle_models', 'store_id', nullable=False)

    # Recriar FK e índice de store_id
    op.create_foreign_key(
        None,
        'vehicle_models',
        'stores',
        ['store_id'],
        ['id'],
    )
    op.create_index('ix_vehicle_models_store_id', 'vehicle_models', ['store_id'], unique=False)

    # Remover nova constraint
    op.drop_constraint('uq_vehicle_model_brand_name', 'vehicle_models', type_='unique')

    # Recriar constraint antiga
    op.create_unique_constraint(
        'uq_vehicle_model_store_name',
        'vehicle_models',
        ['store_id', 'name'],
    )

    # Remover brand_id
    op.drop_index('ix_vehicle_models_brand_id', table_name='vehicle_models')
    op.drop_constraint('fk_vehicle_models_brand_id', 'vehicle_models', type_='foreignkey')
    op.drop_column('vehicle_models', 'brand_id')
