"""Integridade dos registros de ponto: NSR sequencial + hash encadeado.

Cada batida guarda `record_hash = SHA-256(campos legais | prev_hash)`, formando
uma corrente. Adulterar qualquer registro quebra a verificação (verify_chain).
Não substitui assinatura ICP-Brasil (REP-P) — é integridade interna (REP-A).

O CPF entra no hash como `cpf_snapshot` (congelado no INSERT, imutável pela
guarda/trigger) — nunca o CPF ATUAL do funcionário: assim, editar o cadastro do
funcionário não falsifica "adulteração" da corrente.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.time_clock.models import TimeClockRecord

# Chave fixa do advisory lock que serializa a escrita da corrente (Postgres).
ADVISORY_LOCK_KEY = 6712021


def compute_record_hash(
    *,
    nsr: int,
    cpf: str | None,
    type_: str,
    recorded_at: datetime,
    store_id: int,
    source: str,
    annuls_record_id: int | None,
    prev_hash: str | None,
) -> str:
    """SHA-256 (hex maiúsculo) dos campos legais + o hash do elo anterior.

    `recorded_at` naive é tratado como UTC — mantém o hash estável entre gravar e
    verificar mesmo quando o banco não preserva o fuso (SQLite dos testes); em
    Postgres o valor já volta timezone-aware.
    """
    if recorded_at.tzinfo is None:
        recorded_utc = recorded_at.replace(tzinfo=UTC).isoformat()
    else:
        recorded_utc = recorded_at.astimezone(UTC).isoformat()
    payload = "|".join(
        [
            str(nsr),
            cpf or "",
            type_,
            recorded_utc,
            str(store_id),
            source,
            str(annuls_record_id) if annuls_record_id else "",
            prev_hash or "",
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest().upper()


async def assign_chain_fields(db: AsyncSession, record: TimeClockRecord, cpf: str | None) -> None:
    """Serializa a escrita da corrente e atribui nsr/prev_hash/record_hash.

    Requer `record.recorded_at` já definido. No Postgres usa advisory lock
    transacional; em SQLite (testes) a serialização vem do próprio lock de escrita.
    O CPF recebido é congelado em `record.cpf_snapshot` e usado no hash.
    """
    if db.bind.dialect.name == "postgresql":
        await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": ADVISORY_LOCK_KEY})
    last = (
        await db.execute(
            select(TimeClockRecord.nsr, TimeClockRecord.record_hash)
            .order_by(TimeClockRecord.nsr.desc())
            .limit(1)
        )
    ).first()
    next_nsr = 1 if last is None or last.nsr is None else last.nsr + 1
    prev_hash = None if last is None else last.record_hash
    record.nsr = next_nsr
    record.prev_hash = prev_hash
    record.cpf_snapshot = cpf
    record.record_hash = compute_record_hash(
        nsr=next_nsr,
        cpf=cpf,
        type_=record.type,
        recorded_at=record.recorded_at,
        store_id=record.store_id,
        source=record.source,
        annuls_record_id=record.annuls_record_id,
        prev_hash=prev_hash,
    )


async def verify_chain(db: AsyncSession) -> tuple[bool, int | None]:
    """Recomputa a corrente por NSR. Retorna (ok, primeiro_nsr_corrompido).

    Usa `cpf_snapshot` (congelado no INSERT), nunca o CPF atual do funcionário —
    o hash é função apenas de dados imutáveis da própria linha.
    """
    records = (
        (await db.execute(select(TimeClockRecord).order_by(TimeClockRecord.nsr.asc())))
        .scalars()
        .all()
    )
    prev_hash = None
    for rec in records:
        expected = compute_record_hash(
            nsr=rec.nsr,
            cpf=rec.cpf_snapshot,
            type_=rec.type,
            recorded_at=rec.recorded_at,
            store_id=rec.store_id,
            source=rec.source,
            annuls_record_id=rec.annuls_record_id,
            prev_hash=prev_hash,
        )
        if expected != rec.record_hash or rec.prev_hash != prev_hash:
            return False, rec.nsr
        prev_hash = rec.record_hash
    return True, None
