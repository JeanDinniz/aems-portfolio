"""
Notifications router - API endpoints for notification management.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.dependencies import PaginatedResponse, get_pagination_params
from app.modules.notifications import service
from app.modules.notifications.schemas import (
    NotificationListResponse,
    NotificationResponse,
    UnreadCountResponse,
)

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    db: AsyncSession = Depends(get_db),
    pagination: dict = Depends(get_pagination_params),
    current_user=Depends(get_current_user),
):
    """
    Lista notificacoes do usuario autenticado.

    - Nao lidas aparecem primeiro
    - Resultado paginado
    """
    notifications, total = await service.list_notifications(
        db=db,
        user=current_user,
        page=pagination["page"],
        limit=pagination["limit"],
    )
    return PaginatedResponse.create(
        items=[NotificationResponse.model_validate(n) for n in notifications],
        total=total,
        page=pagination["page"],
        limit=pagination["limit"],
    )


@router.get("/unread-count", response_model=UnreadCountResponse)
async def get_unread_count(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Retorna a contagem de notificacoes nao lidas do usuario autenticado.
    """
    count = await service.get_unread_count(db=db, user=current_user)
    return UnreadCountResponse(count=count)


@router.patch("/{notification_id}/read", response_model=NotificationResponse)
async def mark_as_read(
    notification_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Marca uma notificacao especifica como lida.
    Apenas o dono da notificacao pode marca-la.
    """
    notification = await service.mark_as_read(
        db=db,
        notification_id=notification_id,
        user_id=current_user.id,
    )
    return NotificationResponse.model_validate(notification)


@router.post("/mark-all-read", status_code=status.HTTP_200_OK)
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Marca todas as notificacoes do usuario autenticado como lidas.
    """
    return await service.mark_all_read(db=db, user_id=current_user.id)
