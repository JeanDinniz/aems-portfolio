"""time clock: imutabilidade + correção administrativa vinculada

Adiciona a time_clock_records (aditivo, sem tocar dados existentes):
- source ('employee' | 'admin_adjustment'), created_by_user_id, adjustment_reason,
  annuls_record_id (auto-FK): correções são NOVOS registros vinculados, o bruto
  nunca é sobrescrito.
- relaxa NOT NULL de latitude/longitude/photo_url (ajuste do RH não tem GPS/selfie).
- trigger no Postgres que BLOQUEIA UPDATE/DELETE em time_clock_records
  (imutabilidade — Portaria MTP 671/2021). Inserts continuam permitidos.

Revision ID: 20260805_111
Revises: 20260805_110
Create Date: 2026-08-05
"""

import sqlalchemy as sa

from alembic import op

revision = "20260805_111"
down_revision = "20260805_110"
branch_labels = None
depends_on = None


_TRIGGER_FN = """
CREATE OR REPLACE FUNCTION trg_time_clock_records_immutable()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'time_clock_records eh imutavel: use ajuste/anulacao vinculado (Portaria 671/2021)';
END;
$$ LANGUAGE plpgsql;
"""

_TRIGGER = """
CREATE TRIGGER time_clock_records_no_update_delete
BEFORE UPDATE OR DELETE ON time_clock_records
FOR EACH ROW EXECUTE FUNCTION trg_time_clock_records_immutable();
"""


def upgrade() -> None:
    op.add_column(
        "time_clock_records",
        sa.Column("source", sa.String(length=20), server_default="employee", nullable=False),
    )
    op.add_column(
        "time_clock_records",
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "time_clock_records",
        sa.Column("adjustment_reason", sa.Text(), nullable=True),
    )
    op.add_column(
        "time_clock_records",
        sa.Column("annuls_record_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_tcr_created_by_user",
        "time_clock_records",
        "users",
        ["created_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_tcr_annuls_record",
        "time_clock_records",
        "time_clock_records",
        ["annuls_record_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    # Ajuste administrativo não tem GPS/selfie → relaxa NOT NULL.
    op.alter_column("time_clock_records", "latitude", existing_type=sa.Numeric(9, 6), nullable=True)
    op.alter_column(
        "time_clock_records", "longitude", existing_type=sa.Numeric(9, 6), nullable=True
    )
    op.alter_column(
        "time_clock_records", "photo_url", existing_type=sa.String(length=500), nullable=True
    )

    # Imutabilidade no banco (Postgres): bloqueia UPDATE/DELETE. Inserts permitidos.
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(_TRIGGER_FN)
        op.execute(_TRIGGER)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "DROP TRIGGER IF EXISTS time_clock_records_no_update_delete ON time_clock_records"
        )
        op.execute("DROP FUNCTION IF EXISTS trg_time_clock_records_immutable()")

    op.alter_column(
        "time_clock_records", "photo_url", existing_type=sa.String(length=500), nullable=False
    )
    op.alter_column(
        "time_clock_records", "longitude", existing_type=sa.Numeric(9, 6), nullable=False
    )
    op.alter_column(
        "time_clock_records", "latitude", existing_type=sa.Numeric(9, 6), nullable=False
    )

    op.drop_constraint("fk_tcr_annuls_record", "time_clock_records", type_="foreignkey")
    op.drop_constraint("fk_tcr_created_by_user", "time_clock_records", type_="foreignkey")
    op.drop_column("time_clock_records", "annuls_record_id")
    op.drop_column("time_clock_records", "adjustment_reason")
    op.drop_column("time_clock_records", "created_by_user_id")
    op.drop_column("time_clock_records", "source")
