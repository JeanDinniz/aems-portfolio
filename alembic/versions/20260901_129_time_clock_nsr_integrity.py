"""time_clock: nsr persistido + hash encadeado + campos offline

Revision ID: 20260901_129
Revises: 20260828_128

Adiciona a integridade REP-A aos registros de ponto: NSR sequencial (contador
global, CNPJ único), record_hash/prev_hash (corrente SHA-256) e os campos de
batida offline. O backfill percorre os registros em ordem cronológica montando
a corrente; depois torna nsr/record_hash NOT NULL.
"""

import hashlib
from datetime import timezone

import sqlalchemy as sa
from alembic import op

revision = "20260901_129"
down_revision = "20260828_128"
branch_labels = None
depends_on = None

_DISABLE_TRIGGER = (
    "ALTER TABLE time_clock_records DISABLE TRIGGER time_clock_records_no_update_delete"
)
_ENABLE_TRIGGER = (
    "ALTER TABLE time_clock_records ENABLE TRIGGER time_clock_records_no_update_delete"
)


def _hash(nsr, cpf, type_, recorded_at, store_id, source, annuls_id, prev_hash):
    if recorded_at.tzinfo is None:
        recorded_utc = recorded_at.replace(tzinfo=timezone.utc).isoformat()
    else:
        recorded_utc = recorded_at.astimezone(timezone.utc).isoformat()
    payload = "|".join(
        [
            str(nsr),
            cpf or "",
            type_,
            recorded_utc,
            str(store_id),
            source,
            str(annuls_id) if annuls_id else "",
            prev_hash or "",
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest().upper()


def upgrade() -> None:
    op.add_column("time_clock_records", sa.Column("nsr", sa.BigInteger(), nullable=True))
    op.add_column("time_clock_records", sa.Column("record_hash", sa.String(64), nullable=True))
    op.add_column("time_clock_records", sa.Column("prev_hash", sa.String(64), nullable=True))
    op.add_column("time_clock_records", sa.Column("cpf_snapshot", sa.String(14), nullable=True))
    op.add_column(
        "time_clock_records",
        sa.Column("is_offline_record", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "time_clock_records",
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
    )

    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"
    if is_pg:
        op.execute(_DISABLE_TRIGGER)
    try:
        # Backfill em ordem cronológica: NSR sequencial + corrente de hash.
        rows = bind.execute(
            sa.text(
                """
                SELECT r.id, r.type, r.recorded_at, r.store_id, r.source,
                       r.annuls_record_id, e.cpf
                FROM time_clock_records r
                LEFT JOIN employees e ON e.id = r.employee_id
                ORDER BY r.recorded_at ASC, r.id ASC
                """
            )
        ).fetchall()

        prev_hash = None
        nsr = 0
        for row in rows:
            nsr += 1
            h = _hash(
                nsr,
                row.cpf,
                row.type,
                row.recorded_at,
                row.store_id,
                row.source,
                row.annuls_record_id,
                prev_hash,
            )
            bind.execute(
                sa.text(
                    "UPDATE time_clock_records "
                    "SET nsr=:nsr, record_hash=:h, prev_hash=:p, cpf_snapshot=:cpf "
                    "WHERE id=:id"
                ),
                {"nsr": nsr, "h": h, "p": prev_hash, "cpf": row.cpf, "id": row.id},
            )
            prev_hash = h
    finally:
        # Reabilita o trigger mesmo se o backfill falhar (rede de segurança;
        # o rollback transacional do Alembic também restauraria o estado).
        if is_pg:
            op.execute(_ENABLE_TRIGGER)

    op.alter_column("time_clock_records", "nsr", nullable=False)
    op.alter_column("time_clock_records", "record_hash", nullable=False)
    op.create_unique_constraint("uq_tcr_nsr", "time_clock_records", ["nsr"])
    op.create_index("ix_tcr_nsr", "time_clock_records", ["nsr"])


def downgrade() -> None:
    op.drop_index("ix_tcr_nsr", table_name="time_clock_records")
    op.drop_constraint("uq_tcr_nsr", "time_clock_records", type_="unique")
    op.drop_column("time_clock_records", "synced_at")
    op.drop_column("time_clock_records", "is_offline_record")
    op.drop_column("time_clock_records", "cpf_snapshot")
    op.drop_column("time_clock_records", "prev_hash")
    op.drop_column("time_clock_records", "record_hash")
    op.drop_column("time_clock_records", "nsr")
