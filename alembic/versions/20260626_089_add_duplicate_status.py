"""service_orders: add 'duplicate' status to check constraints

Revision ID: 20260626_089
Revises: 20260625_088
Create Date: 2026-06-26

Contexto:
  Transforma a duplicidade em um STATUS real e persistido ("duplicate"). Uma O.S.
  lançada que duplique outra (mesma placa/chassi + serviço em comum + mesmo mês) nasce
  com status "duplicate". Este é um valor adicional aceito pelo CHECK constraint de
  service_orders.status e pelos CHECKs de status_history (from_status/to_status), já que
  o histórico inicial passa a registrar a criação com esse status.
"""

from alembic import op

revision = "20260626_089"
down_revision = "20260625_088"
branch_labels = None
depends_on = None

_WITH_DUPLICATE = (
    "'waiting', 'in_progress', 'quality_check', 'completed', "
    "'delivered', 'cancelled', 'wrong', 'duplicate'"
)
_WITHOUT_DUPLICATE = (
    "'waiting', 'in_progress', 'quality_check', 'completed', "
    "'delivered', 'cancelled', 'wrong'"
)


def _apply_constraints(values: str) -> None:
    op.execute("ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS ck_service_orders_status")
    op.execute(
        "ALTER TABLE service_orders ADD CONSTRAINT ck_service_orders_status "
        f"CHECK (status IN ({values}))"
    )

    op.execute("ALTER TABLE status_history DROP CONSTRAINT IF EXISTS ck_status_history_from_status")
    op.execute(
        "ALTER TABLE status_history ADD CONSTRAINT ck_status_history_from_status "
        f"CHECK (from_status IS NULL OR from_status IN ({values}))"
    )

    op.execute("ALTER TABLE status_history DROP CONSTRAINT IF EXISTS ck_status_history_to_status")
    op.execute(
        "ALTER TABLE status_history ADD CONSTRAINT ck_status_history_to_status "
        f"CHECK (to_status IN ({values}))"
    )


def upgrade() -> None:
    _apply_constraints(_WITH_DUPLICATE)


def downgrade() -> None:
    # Reverte O.S. duplicadas para "waiting" antes de remover o valor da constraint.
    op.execute("UPDATE service_orders SET status = 'waiting' WHERE status = 'duplicate'")
    op.execute("UPDATE status_history SET from_status = 'waiting' WHERE from_status = 'duplicate'")
    op.execute("UPDATE status_history SET to_status = 'waiting' WHERE to_status = 'duplicate'")
    _apply_constraints(_WITHOUT_DUPLICATE)
