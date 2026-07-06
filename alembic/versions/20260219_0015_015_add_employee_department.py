"""Add department column to employees table

Revision ID: 015
Revises: 014
Create Date: 2026-02-19

Mudanças:
  - Adiciona coluna `department` (VARCHAR 50, nullable) na tabela `employees`
  - Cria índice em `employees.department` para filtros eficientes
  - Funcionários sem department (NULL) aparecem em todos os filtros de departamento
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '015'
down_revision: Union[str, None] = '014'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Adicionar coluna department (nullable para não quebrar registros existentes)
    op.add_column(
        'employees',
        sa.Column('department', sa.String(50), nullable=True),
    )

    # Criar índice para filtros por departamento
    op.create_index('ix_employees_department', 'employees', ['department'])


def downgrade() -> None:
    op.drop_index('ix_employees_department', table_name='employees')
    op.drop_column('employees', 'department')
