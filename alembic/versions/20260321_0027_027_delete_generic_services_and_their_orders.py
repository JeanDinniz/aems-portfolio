"""Delete generic services and their service orders

Revision ID: 027
Revises: 026
Create Date: 2026-03-21

Contexto:
  Os 11 serviços genéricos inseridos na migration 007 (brand=NULL,
  available_for_all_departments=TRUE) estavam aparecendo em todos os
  departamentos do dropdown de criação de OS.

  Esta migration:
  1. Apaga as ordens de serviço que referenciam esses serviços genéricos
     (o CASCADE cuida de service_order_items, service_order_workers e status_history).
  2. Apaga os próprios serviços genéricos.
"""

from typing import Sequence, Union

from alembic import op

revision: str = '027'
down_revision: Union[str, None] = '026'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Passo 1: deletar as ordens de serviço que têm itens referenciando
    # os serviços genéricos. O CASCADE nas FKs cuida de:
    #   service_order_items (ondelete=CASCADE)
    #   service_order_workers (ondelete=CASCADE)
    #   status_history (ondelete=CASCADE)
    op.execute(
        """
        DELETE FROM service_orders
        WHERE id IN (
            SELECT DISTINCT service_order_id
            FROM service_order_items
            WHERE service_id IN (
                SELECT id FROM services
                WHERE available_for_all_departments = TRUE
                  AND brand IS NULL
            )
        )
        """
    )

    # Passo 2: agora que nenhum service_order_item os referencia,
    # deletar os serviços genéricos (a constraint RESTRICT é satisfeita).
    op.execute(
        """
        DELETE FROM services
        WHERE available_for_all_departments = TRUE
          AND brand IS NULL
        """
    )


def downgrade() -> None:
    # Não é possível restaurar OS deletadas — downgrade intencional vazio.
    pass
