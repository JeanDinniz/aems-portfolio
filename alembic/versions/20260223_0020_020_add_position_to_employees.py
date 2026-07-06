"""Add position to employees

Revision ID: 020
Revises: 019
Create Date: 2026-02-23

Contexto:
  Adiciona o campo 'position' (cargo) à tabela de funcionários para
  registrar a função/cargo de cada funcionário dentro da loja,
  independente do departamento (ex: instalador, polidor, auxiliar).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '020'
down_revision: Union[str, None] = '019'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add position column to employees table."""

    op.add_column(
        'employees',
        sa.Column('position', sa.String(100), nullable=True),
    )


def downgrade() -> None:
    """Remove position column from employees table."""

    op.drop_column('employees', 'position')
