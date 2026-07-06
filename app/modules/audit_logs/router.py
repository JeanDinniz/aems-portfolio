"""
Audit logs router - API endpoints for querying audit log entries.
Restricted to Owner role only.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import UserRole, require_roles
from app.db.session import get_db
from app.dependencies import PaginatedResponse
from app.modules.audit_logs import service
from app.modules.audit_logs.schemas import AuditLogListResponse

router = APIRouter(prefix="/audit-logs", tags=["Auditoria"])


@router.get(
    "",
    response_model=AuditLogListResponse,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def list_audit_logs(
    db: AsyncSession = Depends(get_db),
    action: str | None = Query(None, description="Filtrar por ação (ex: login, create, update)"),
    resource_type: str | None = Query(
        None, description="Filtrar por tipo de recurso (ex: user, service_order)"
    ),
    resource_id: int | None = Query(None, description="Filtrar por ID do recurso"),
    user_id: int | None = Query(None, description="Filtrar por ID do usuário que executou a ação"),
    user_name: str | None = Query(None, description="Buscar por nome do usuário (parcial)"),
    start_date: datetime | None = Query(None, description="Data/hora inicial (ISO 8601)"),
    end_date: datetime | None = Query(None, description="Data/hora final (ISO 8601)"),
    page: int = Query(1, ge=1, description="Página atual"),
    limit: int = Query(50, ge=1, le=200, description="Itens por página"),
):
    """
    Lista entradas de auditoria com filtros opcionais.
    Restrito a Owner.
    """
    items, total = await service.list_audit_logs(
        db=db,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        user_id=user_id,
        user_name=user_name,
        start_date=start_date,
        end_date=end_date,
        page=page,
        limit=limit,
    )

    return PaginatedResponse.create(
        items=items,
        total=total,
        page=page,
        limit=limit,
    )
