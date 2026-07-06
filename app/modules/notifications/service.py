"""
Notifications service - Business logic for notification management.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.modules.notifications.models import Notification
from app.modules.notifications.schemas import NotificationType

if TYPE_CHECKING:
    from app.modules.auth.models import User


async def create_notification(
    db: AsyncSession,
    user_id: int,
    type: NotificationType | str,
    title: str,
    body: str,
    is_galpon: bool = False,
) -> Notification:
    """
    Cria uma nova notificacao para um usuario.

    Funcao de uso interno: chamada por outros modulos ao disparar eventos.

    Args:
        db: Sessao do banco de dados
        user_id: ID do usuario destinatario
        type: Tipo da notificacao (NotificationType ou string)
        title: Titulo da notificacao
        body: Corpo/mensagem da notificacao
        is_galpon: Se True, notificacao é relativa ao galpão

    Returns:
        Notification criada
    """
    type_value = type.value if isinstance(type, NotificationType) else type

    notification = Notification(
        user_id=user_id,
        type=type_value,
        title=title,
        body=body,
        is_read=False,
        is_galpon=is_galpon,
        created_at=datetime.now(UTC),
    )
    db.add(notification)
    await db.flush()
    await db.refresh(notification)

    # Broadcast em tempo real para o usuário destinatário
    try:
        from app.websocket.manager import manager as ws_manager

        await ws_manager.send_to_store(
            f"user:{user_id}",
            "notification",
            {"id": notification.id, "title": title, "body": body, "type": type_value},
        )
    except Exception:
        pass  # Falha no broadcast não deve quebrar o fluxo principal

    # Disparo de push notification nativa (assíncrono via Celery)
    # Importacao local para evitar dependencia circular workers ↔ modules
    try:
        from app.workers.tasks import send_push_notification

        send_push_notification.delay(
            user_id,
            title,
            body,
            type_value,
            {"notification_id": notification.id, "type": type_value},
        )
    except Exception:
        pass  # Broker indisponivel nao deve quebrar o request principal

    return notification


async def list_notifications(
    db: AsyncSession,
    user: "User",
    page: int = 1,
    limit: int = 20,
) -> tuple[list[Notification], int]:
    """
    Lista notificacoes do usuario, nao lidas primeiro.

    Args:
        db: Sessao do banco de dados
        user: Usuario autenticado
        page: Pagina atual
        limit: Itens por pagina

    Returns:
        Tuple com lista de notificacoes e total
    """
    from app.core.permissions import hide_galpon_user, is_galpon_profile_user

    query = select(Notification).where(Notification.user_id == user.id)

    if is_galpon_profile_user(user):
        query = query.where(Notification.is_galpon.is_(True))
    elif hide_galpon_user(user):
        query = query.where(Notification.is_galpon.is_(False))

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    offset = (page - 1) * limit
    query = (
        query.order_by(Notification.is_read.asc(), Notification.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(query)
    notifications = list(result.scalars().all())

    return notifications, total


async def mark_as_read(db: AsyncSession, notification_id: int, user_id: int) -> Notification:
    """
    Marca uma notificacao como lida.

    Args:
        db: Sessao do banco de dados
        notification_id: ID da notificacao
        user_id: ID do usuario (verifica propriedade)

    Raises:
        NotFoundError: Notificacao nao encontrada ou nao pertence ao usuario
    """
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == user_id,
        )
    )
    notification = result.scalar_one_or_none()

    if not notification:
        raise NotFoundError(resource="Notificacao")

    notification.is_read = True
    await db.commit()
    await db.refresh(notification)
    return notification


async def mark_all_read(db: AsyncSession, user_id: int) -> dict:
    """
    Marca todas as notificacoes do usuario como lidas.

    Args:
        db: Sessao do banco de dados
        user_id: ID do usuario

    Returns:
        Dict com contagem de notificacoes atualizadas
    """
    result = await db.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.is_read.is_(False))
        .values(is_read=True)
        .returning(Notification.id)
    )
    updated_count = len(result.fetchall())
    await db.commit()
    return {"updated": updated_count, "message": "Todas as notificacoes marcadas como lidas"}


async def get_unread_count(db: AsyncSession, user: "User") -> int:
    """
    Retorna o numero de notificacoes nao lidas do usuario.

    Args:
        db: Sessao do banco de dados
        user: Usuario autenticado

    Returns:
        Contagem de notificacoes nao lidas
    """
    from app.core.permissions import hide_galpon_user, is_galpon_profile_user

    query = select(func.count(Notification.id)).where(
        Notification.user_id == user.id,
        Notification.is_read.is_(False),
    )
    if is_galpon_profile_user(user):
        query = query.where(Notification.is_galpon.is_(True))
    elif hide_galpon_user(user):
        query = query.where(Notification.is_galpon.is_(False))
    result = await db.execute(query)
    return result.scalar() or 0
