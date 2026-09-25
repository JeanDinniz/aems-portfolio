"""
Audit logs schemas - Pydantic models for audit log queries and responses.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.core.schemas import PaginationMeta


class AuditLogResponse(BaseModel):
    """Schema de resposta para um registro de auditoria."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    action: str
    resource_type: str
    resource_id: int | None
    old_value: dict | None
    new_value: dict | None
    ip_address: str | None
    user_agent: str | None
    created_at: datetime
    user_id: int | None
    user_name: str | None
    # Detalhes identificadores do recurso afetado, resolvidos no momento da
    # consulta (ex.: bobina → tipo, tonalidade, data de recebimento e criação).
    # Preenchido apenas para tipos de recurso suportados; None caso contrário.
    resource_detail: dict | None = None


class AuditLogListResponse(BaseModel):
    """Schema de resposta paginada para lista de audit logs."""

    items: list[AuditLogResponse]
    pagination: PaginationMeta
