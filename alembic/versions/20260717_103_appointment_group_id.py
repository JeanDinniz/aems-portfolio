"""Agendamento combinado multi-departamento.

Coluna appointment_group_id (UUID em texto) em appointments: agendamentos
criados juntos pelo fluxo combinado (1 por departamento, mesmo carro) dividem
o mesmo group_id e aparecem vinculados na lista/drawer. NULL = agendamento
avulso. Sem tabela de grupo — o grupo não tem atributos próprios e a edição/
cancelamento de cada irmão é independente por design.

Revision ID: 20260717_103
Revises: 20260717_102
Create Date: 2026-07-17
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260717_103"
down_revision = "20260717_102"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "appointments",
        sa.Column("appointment_group_id", sa.String(length=36), nullable=True),
    )
    op.create_index(
        "ix_appointments_appointment_group_id",
        "appointments",
        ["appointment_group_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_appointments_appointment_group_id", table_name="appointments")
    op.drop_column("appointments", "appointment_group_id")
