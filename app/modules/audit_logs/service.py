"""
Audit logs service - Business logic for querying audit log entries.
"""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.audit import AuditLog
from app.core.pagination import paginate
from app.modules.audit_logs.schemas import AuditLogResponse
from app.modules.auth.models import User


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

    logs, total = await paginate(db, query, page, limit, order_by=AuditLog.created_at.desc())

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
        )
        for log in logs
    ]

    return items, total
