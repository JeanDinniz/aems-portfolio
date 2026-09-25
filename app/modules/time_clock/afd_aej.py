"""
Geração dos arquivos AFD e AEJ COMPATÍVEIS com o leiaute da Portaria MTP 671/2021
(layout versão 003), para fiscalização informal e/ou futura migração legal.

⚠️ LIMITES CONSCIENTES (este é um CONTROLE INTERNO, não um REP-P legal):
  1. SEM assinatura digital ICP-Brasil. Um AFD de REP-P legal deve ser assinado
     pelo desenvolvedor (padrão CAdES, arquivo .p7s destacado — Art. 33). Aqui o
     arquivo é gerado sem assinatura.
  2. O AEJ é o resultado do PÓS-PROCESSAMENTO de um Programa de Tratamento (PTRP):
     jornada contratual, banco de horas, ausências tratadas etc. Como o sistema
     não roda um PTRP completo, o AEJ aqui é uma versão SIMPLIFICADA com os dados
     disponíveis (empregador, empregados, horário contratual e marcações).
  3. Identificadores (CNPJ do empregador, CPF do trabalhador) vêm de configuração
     e do cadastro; quando ausentes são preenchidos com zeros — o arquivo fica
     estruturalmente compatível, porém com identificadores incompletos.

Referências de leiaute: Anexos V (AFD) e VI (AEJ) da Portaria 671/2021.
Datas/horas em ISO 8601 com fuso (America/Sao_Paulo). Linhas separadas por CRLF.
"""

from __future__ import annotations

import hashlib
from datetime import date as date_type
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.modules.stores.models import Store
from app.modules.time_clock.models import TimeClockRecord
from app.modules.time_clock.service import TZ_LOCAL

LAYOUT_VERSION = "003"
CRLF = "\r\n"


# ─── Helpers de formatação ────────────────────────────────────────────────────
def _digits(value: str | None) -> str:
    return "".join(ch for ch in (value or "") if ch.isdigit())


def _num(value: str | int | None, width: int) -> str:
    """Numérico alinhado à direita, preenchido com zeros à esquerda (trunca à esquerda)."""
    s = _digits(str(value)) if value is not None else ""
    return s.rjust(width, "0")[-width:]


def _text(value: str | None, width: int) -> str:
    """Texto alinhado à esquerda, preenchido com espaços (trunca à direita)."""
    s = (value or "").encode("latin-1", "replace").decode("latin-1")
    return s.ljust(width)[:width]


def _fmt_dt(dt: datetime) -> str:
    """Data/hora ISO 8601 com fuso local, 24 chars: 'YYYY-MM-DDTHH:MM:SS-0300'."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ_LOCAL)
    local = dt.astimezone(TZ_LOCAL)
    return local.strftime("%Y-%m-%dT%H:%M:%S%z")


def _fmt_date(d: date_type) -> str:
    return d.strftime("%Y-%m-%d")


def _crc16(payload: str) -> str:
    """CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) em 4 hex maiúsculos."""
    crc = 0xFFFF
    for byte in payload.encode("latin-1", "replace"):
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if (crc & 0x8000) else (crc << 1) & 0xFFFF
    return f"{crc:04X}"


def _sha256(payload: str) -> str:
    return hashlib.sha256(payload.encode("latin-1", "replace")).hexdigest().upper()


# ─── Consulta comum ───────────────────────────────────────────────────────────
async def _fetch(
    db: AsyncSession, store_id: int, start: date_type, end: date_type
) -> tuple[str, list[TimeClockRecord]]:
    """Nome da loja + a JORNADA EFETIVA do período (F3, auditoria).

    A jornada efetiva reflete a realidade do REP-P:
    - INCLUI batidas do funcionário (source='employee') E ajustes do RH
      (source='admin_adjustment' com annuls_record_id nulo — batidas esquecidas);
    - EXCLUI batidas anuladas (referenciadas por annuls_record_id de qualquer
      registro) e os próprios marcadores de anulação (annuls_record_id != nulo).
    Antes o filtro `source=='employee'` omitia os ajustes e mantinha as anuladas,
    deixando o arquivo legalmente inconsistente.
    """
    store_name = (
        await db.execute(select(Store.name).where(Store.id == store_id))
    ).scalar_one_or_none() or str(store_id)

    result = await db.execute(
        select(TimeClockRecord)
        .options(selectinload(TimeClockRecord.employee))
        .where(
            TimeClockRecord.store_id == store_id,
            TimeClockRecord.recorded_date >= start,
            TimeClockRecord.recorded_date <= end,
        )
        .order_by(TimeClockRecord.recorded_at, TimeClockRecord.id)
    )
    records = list(result.scalars().all())

    # IDs das batidas anuladas — a anulação pode ter sido lançada FORA do período
    # (recorded_date = dia da anulação), então varremos as anulações da loja inteira.
    annulled_ids = set(
        (
            await db.execute(
                select(TimeClockRecord.annuls_record_id).where(
                    TimeClockRecord.store_id == store_id,
                    TimeClockRecord.annuls_record_id.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )

    effective = [
        rec for rec in records if rec.annuls_record_id is None and rec.id not in annulled_ids
    ]
    return store_name, effective


# ─── AFD ──────────────────────────────────────────────────────────────────────
async def generate_afd(db: AsyncSession, store_id: int, start: date_type, end: date_type) -> str:
    """
    Gera o AFD (Arquivo Fonte de Dados) com as marcações brutas do período:
    cabeçalho (tipo 1) + uma marcação REP-P (tipo 7) por batida + trailer (tipo 9).
    Retorna o conteúdo texto (o caller decide o encoding do download).
    """
    settings = get_settings()
    if not settings.EMPLOYER_CNPJ or not settings.EMPLOYER_NAME:
        from app.core.exceptions import ValidationError

        raise ValidationError(
            detail="Configure EMPLOYER_CNPJ e EMPLOYER_NAME para exportar o AFD (modo REP-A)."
        )
    _store_name, records = await _fetch(db, store_id, start, end)
    now = datetime.now(TZ_LOCAL)

    lines: list[str] = []

    # Tipo 1 — cabeçalho
    header = (
        _num(0, 9)
        + "1"
        + (settings.EMPLOYER_ID_TYPE or "1")[:1]
        + _num(settings.EMPLOYER_CNPJ, 14)
        + _num("", 14)  # CNO/CAEPF
        + _text(settings.EMPLOYER_NAME, 150)
        + _text(settings.EMPLOYER_INPI, 17)  # registro INPI do programa (REP-P)
        + _fmt_date(start)
        + _fmt_date(end)
        + _fmt_dt(now)
        + LAYOUT_VERSION
        + (settings.DEVELOPER_ID_TYPE or "1")[:1]
        + _num(settings.DEVELOPER_CNPJ, 14)
        + _text("", 30)  # modelo (REP-C apenas)
    )
    header += _crc16(header)
    lines.append(header)

    # Tipo 7 — marcações REP-P (usa NSR/hash PERSISTIDOS: estáveis entre exportações)
    for rec in records:
        cpf = rec.employee.cpf if rec.employee else None
        body = (
            _num(rec.nsr, 9)
            + "7"
            + _fmt_dt(rec.recorded_at)
            + _num(cpf, 12)
            + _fmt_dt(rec.created_at)
            + "01"  # identificador do meio de marcação
            + ("1" if rec.is_offline_record else "0")  # batida offline (sinalização explícita)
        )
        line = body + (rec.record_hash or _sha256(body))
        lines.append(line)

    # Tipo 9 — trailer (totalizadores por tipo de registro)
    total_type7 = len(records)
    trailer = (
        "9" * 9  # NSR do trailer = 999999999
        + "9"
        + _num(0, 9)  # tipo 2
        + _num(0, 9)  # tipo 3
        + _num(0, 9)  # tipo 4
        + _num(0, 9)  # tipo 5
        + _num(0, 9)  # tipo 6
        + _num(total_type7, 9)  # tipo 7 (marcações REP-P)
    )
    lines.append(trailer)

    return CRLF.join(lines) + CRLF


# ─── AEJ (simplificado) ─────────────────────────────────────────────────────
async def generate_aej(db: AsyncSession, store_id: int, start: date_type, end: date_type) -> str:
    """
    Gera o AEJ (Arquivo Eletrônico de Jornada) em versão SIMPLIFICADA — ver o
    aviso no topo do módulo. Estrutura: cabeçalho + empregador + empregados +
    marcações + trailer, com os dados disponíveis (sem jornada contratual/banco
    de horas tratados por um PTRP).
    """
    settings = get_settings()
    _store_name, records = await _fetch(db, store_id, start, end)
    now = datetime.now(TZ_LOCAL)

    lines: list[str] = []

    # Cabeçalho
    lines.append(
        _num(0, 9)
        + "1"
        + (settings.EMPLOYER_ID_TYPE or "1")[:1]
        + _num(settings.EMPLOYER_CNPJ, 14)
        + _text(settings.EMPLOYER_NAME, 150)
        + _fmt_date(start)
        + _fmt_date(end)
        + _fmt_dt(now)
        + LAYOUT_VERSION
        + "AEJ-SIMPLIFICADO-SEM-ASSINATURA"
    )

    # Empregador
    lines.append(
        "2"
        + (settings.EMPLOYER_ID_TYPE or "1")[:1]
        + _num(settings.EMPLOYER_CNPJ, 14)
        + _text(settings.EMPLOYER_NAME, 150)
    )

    # Empregados (um por funcionário com marcações no período) + horário contratual
    seen: dict[int, TimeClockRecord] = {}
    for rec in records:
        if rec.employee and rec.employee_id not in seen:
            seen[rec.employee_id] = rec
    for emp_rec in seen.values():
        emp = emp_rec.employee
        name = f"{emp.name} {emp.last_name}".strip() if emp.last_name else emp.name
        jornada = ""
        if emp.work_start_time and emp.work_end_time:
            jornada = f"{emp.work_start_time.strftime('%H%M')}{emp.work_end_time.strftime('%H%M')}"
        lines.append("3" + _num(emp.cpf, 12) + _text(name, 150) + _text(jornada, 8))

    # Marcações
    for rec in records:
        cpf = rec.employee.cpf if rec.employee else None
        lines.append("4" + _num(cpf, 12) + rec.type.ljust(3) + _fmt_dt(rec.recorded_at))

    # Trailer
    lines.append("9" + _num(len(seen), 9) + _num(len(records), 9))

    return CRLF.join(lines) + CRLF
