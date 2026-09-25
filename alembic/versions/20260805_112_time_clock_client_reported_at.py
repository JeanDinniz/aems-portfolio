"""time clock: client_reported_at (horário do dispositivo como metadado)

Adiciona time_clock_records.client_reported_at (nullable): horário do relógio do
aparelho no momento da batida. É apenas metadado auxiliar — o horário oficial
continua sendo o do servidor (recorded_at). Útil para detectar delay de rede/fraude.

Revision ID: 20260805_112
Revises: 20260805_111
Create Date: 2026-08-05
"""

import sqlalchemy as sa

from alembic import op

revision = "20260805_112"
down_revision = "20260805_111"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "time_clock_records",
        sa.Column("client_reported_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("time_clock_records", "client_reported_at")
