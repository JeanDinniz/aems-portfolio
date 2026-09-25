"""
Audit logs service - Business logic for querying audit log entries.
"""

import json
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.core.audit import AuditLog
from app.core.pagination import paginate
from app.modules.audit_logs.schemas import AuditLogResponse
from app.modules.auth.models import User
from app.modules.inventory.models import FilmRoll

# Limite de linhas exportadas por chamada. Audit logs crescem rápido — 50k cobre
# vários meses de operação e cabe em um CSV de poucas dezenas de MB. Exports
# maiores devem ir por job assíncrono no futuro.
EXPORT_MAX_ROWS = 50_000

# Tamanho do lote lido do banco a cada iteração do streaming, para não carregar
# tudo em memória de uma vez.
EXPORT_BATCH_SIZE = 1_000

CSV_HEADERS = (
    "created_at",
    "action",
    "resource_type",
    "resource_id",
    "user_id",
    "user_name",
    "ip_address",
    "user_agent",
    "old_value",
    "new_value",
)


async def _film_roll_details(db: AsyncSession, roll_ids: set[int]) -> dict[int, dict]:
    """
    Resolve detalhes identificadores das bobinas afetadas pelos registros de
    auditoria (tipo, tonalidade, data de recebimento e data de criação).

    Busca em lote pelo id atual da bobina; bobinas já excluídas simplesmente não
    entram no mapa (o registro de auditoria continua exibindo só o #id).
    """
    if not roll_ids:
        return {}
    result = await db.execute(
        select(FilmRoll).options(selectinload(FilmRoll.film_type)).where(FilmRoll.id.in_(roll_ids))
    )
    details: dict[int, dict] = {}
    for roll in result.scalars().all():
        details[roll.id] = {
            "film_type_name": roll.film_type.name if roll.film_type else None,
            "tonality": roll.tonality,
            "receipt_date": roll.receipt_date.isoformat() if roll.receipt_date else None,
            "created_at": roll.created_at.isoformat() if roll.created_at else None,
        }
    return details


def _build_filtered_query(
    action: str | None = None,
    resource_type: str | None = None,
    resource_id: int | None = None,
    user_id: int | None = None,
    user_name: str | None = None,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
) -> Select:
    """
    Monta o ``select`` de auditoria com os filtros opcionais aplicados.

    Compartilhado pela listagem paginada e pelo export CSV para garantir que
    ambos apliquem exatamente o mesmo recorte.
    """
    query = select(AuditLog).options(joinedload(AuditLog.user))

    if action:
        query = query.where(AuditLog.action == action)
    if resource_type:
        query = query.where(AuditLog.resource_type == resource_type)
    if resource_id is not None:
        query = query.where(AuditLog.resource_id == resource_id)
    if user_id is not None:
        query = query.where(AuditLog.user_id == user_id)
    if user_name:
        pattern = f"%{user_name}%"
        query = query.where(AuditLog.user.has(User.full_name.ilike(pattern)))
    if start_date:
        query = query.where(AuditLog.created_at >= start_date)
    if end_date:
        query = query.where(AuditLog.created_at <= end_date)

    return query


async def list_audit_logs(
    db: AsyncSession,
    action: str | None = None,
    resource_type: str | None = None,
    resource_id: int | None = None,
    user_id: int | None = None,
    user_name: str | None = None,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
    page: int = 1,
    limit: int = 50,
) -> tuple[list[AuditLogResponse], int]:
    """
    Lista entradas de auditoria com filtros opcionais e paginação.

    Returns:
        Tuple com lista de AuditLogResponse e total de registros.
    """
    query = _build_filtered_query(
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        user_id=user_id,
        user_name=user_name,
        start_date=start_date,
        end_date=end_date,
    )

    logs, total = await paginate(db, query, page, limit, order_by=AuditLog.created_at.desc())

    # Enriquece registros de bobina com dados identificadores (tipo, tonalidade,
    # datas), resolvidos em lote pelo id do recurso.
    roll_ids = {
        log.resource_id
        for log in logs
        if log.resource_type == "film_roll" and log.resource_id is not None
    }
    roll_details = await _film_roll_details(db, roll_ids)

    items = [
        AuditLogResponse(
            id=log.id,
            action=log.action,
            resource_type=log.resource_type,
            resource_id=log.resource_id,
            old_value=log.old_value,
            new_value=log.new_value,
            ip_address=log.ip_address,
            user_agent=log.user_agent,
            created_at=log.created_at,
            user_id=log.user_id,
            user_name=log.user.full_name if log.user else None,
            resource_detail=(
                roll_details.get(log.resource_id) if log.resource_type == "film_roll" else None
            ),
        )
        for log in logs
    ]

    return items, total


# ─── Export CSV ──────────────────────────────────────────────────────────────


def _csv_escape(value: Any) -> str:
    """
    Escapa um campo conforme RFC 4180: envolve em aspas duplas qualquer valor
    contendo ``,``, ``"``, CR ou LF, duplicando as aspas internas.
    ``None`` vira string vazia; dict/list são serializados em JSON.
    """
    if value is None:
        return ""
    if isinstance(value, str):
        text = value
    elif isinstance(value, (dict, list)):
        text = json.dumps(value, ensure_ascii=False, default=str)
    else:
        text = str(value)
    if any(ch in text for ch in (",", '"', "\r", "\n")):
        return '"' + text.replace('"', '""') + '"'
    return text


def _to_csv_line(values: tuple[Any, ...]) -> str:
    """Junta os campos escapados em uma linha CSV terminada em CRLF."""
    return ",".join(_csv_escape(v) for v in values) + "\r\n"


def build_export_filename(now: datetime | None = None) -> str:
    """Nome do arquivo no padrão ``audit-YYYY-MM-DD-HHMM.csv`` em UTC."""
    moment = now or datetime.now(UTC)
    return f"audit-{moment.strftime('%Y-%m-%d-%H%M')}.csv"


async def stream_audit_csv(
    db: AsyncSession,
    action: str | None = None,
    resource_type: str | None = None,
    resource_id: int | None = None,
    user_id: int | None = None,
    user_name: str | None = None,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
) -> AsyncGenerator[str, None]:
    """
    Gera o CSV da auditoria linha a linha, aplicando os mesmos filtros da
    listagem. Lê em lotes de ``EXPORT_BATCH_SIZE`` com teto de ``EXPORT_MAX_ROWS``
    para não estourar a memória.
    """
    # BOM UTF-8 — faz o Excel abrir como UTF-8 em vez de Windows-1252.
    yield "﻿"
    yield _to_csv_line(CSV_HEADERS)

    base_query = _build_filtered_query(
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        user_id=user_id,
        user_name=user_name,
        start_date=start_date,
        end_date=end_date,
    ).order_by(AuditLog.created_at.desc())

    exported = 0
    offset = 0

    while exported < EXPORT_MAX_ROWS:
        take = min(EXPORT_BATCH_SIZE, EXPORT_MAX_ROWS - exported)
        result = await db.execute(base_query.offset(offset).limit(take))
        batch = result.scalars().all()
        if not batch:
            break

        for log in batch:
            yield _to_csv_line(
                (
                    log.created_at.isoformat() if log.created_at else "",
                    log.action,
                    log.resource_type,
                    log.resource_id if log.resource_id is not None else "",
                    log.user_id if log.user_id is not None else "",
                    log.user.full_name if log.user else "",
                    log.ip_address or "",
                    log.user_agent or "",
                    log.old_value,
                    log.new_value,
                )
            )
            exported += 1

        offset += len(batch)
        if len(batch) < take:
            break
