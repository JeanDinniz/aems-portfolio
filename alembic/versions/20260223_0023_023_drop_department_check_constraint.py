"""Drop department check constraint to allow aesthetics department

Revision ID: 023
Revises: 022
Create Date: 2026-02-23

Contexto:
  Remove a constraint CHECK ck_services_department para permitir o valor
  'aesthetics' (serviços gerais de estética automotiva como lavagem,
  polimento, higienização, etc.). A validação fica a cargo do Pydantic.
"""

from typing import Sequence, Union

from alembic import op

revision: str = '023'
down_revision: Union[str, None] = '022'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Remove a constraint de CHECK para permitir novos departamentos."""
    op.drop_constraint('ck_services_department', 'services', type_='check')


def downgrade() -> None:
    """Restaura a constraint original (sem aesthetics)."""
    op.create_check_constraint(
        'ck_services_department',
        'services',
        "department IN ('film', 'bodywork', 'esthetics', 'vn', 'vu', 'workshop')"
    )
