"""D-01: vínculo único agendamento ↔ O.S. (UNIQUE em appointments.service_order_id).

Impede que dois agendamentos apontem para a MESMA O.S. — condição que quebrava o
sync reverso (O.S. → agendamento) e podia surgir de geração concorrente. Postgres
permite múltiplos NULL num índice único, então agendamentos sem O.S. seguem livres.

Pré-checado nos dados de produção: 0 service_order_id duplicado, então a constraint
entra limpa.

Revision ID: 20260730_108
Revises: 20260730_107
Create Date: 2026-07-30
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260730_108"
down_revision = "20260730_107"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_appointments_service_order_id", "appointments", ["service_order_id"]
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_appointments_service_order_id", "appointments", type_="unique"
    )
