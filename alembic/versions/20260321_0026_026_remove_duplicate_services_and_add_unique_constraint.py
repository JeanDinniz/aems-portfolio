"""Remove duplicate services and add unique constraint

Revision ID: 026
Revises: 610abc0ad970
Create Date: 2026-03-21

Contexto:
  Registros de serviços duplicados (mesmo nome, departamento e marca) foram
  inseridos manualmente. Esta migration:
  1. Remove as duplicatas mantendo apenas o registro com menor ID.
  2. Adiciona índice único em (name, department, COALESCE(brand, ''))
     para evitar duplicatas futuras (brand pode ser NULL).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '026'
down_revision: Union[str, None] = '610abc0ad970'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Remover duplicatas — manter apenas o registro com menor ID
    #    para cada combinação (name, department, brand).
    #    brand pode ser NULL; usamos COALESCE para agrupamento consistente.
    op.execute(
        """
        DELETE FROM services
        WHERE id NOT IN (
            SELECT MIN(id)
            FROM services
            GROUP BY name, department, COALESCE(brand, '')
        )
        """
    )

    # 2. Adicionar índice único funcional para prevenir futuras duplicatas.
    #    Usamos índice funcional com COALESCE porque NULL != NULL no PostgreSQL,
    #    o que permitiria inserir duplicatas com brand = NULL usando UNIQUE simples.
    op.execute(
        """
        CREATE UNIQUE INDEX uq_services_name_department_brand
        ON services (name, department, COALESCE(brand, ''))
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_services_name_department_brand")
