"""
Notifications schemas - Pydantic models for notification validation.
"""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict

from app.core.schemas import PaginationMeta


class NotificationType(StrEnum):
    """Tipos de notificacao suportados."""

    ORDER_CREATED = "order_created"
    INVENTORY_ALERT = "inventory_alert"
    ORDER_COMPLETED = "order_completed"
    SCHEDULING_CREATED = "scheduling_created"


class NotificationResponse(BaseModel):
    """Schema para resposta de notificacao."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    type: str
    title: str
    body: str
    is_read: bool
    is_galpon: bool
    created_at: datetime


class NotificationListResponse(BaseModel):
    """Schema para lista paginada de notificacoes."""

    items: list[NotificationResponse]
    pagination: PaginationMeta


class UnreadCountResponse(BaseModel):
    """Schema para contagem de notificacoes nao lidas."""

    count: int
