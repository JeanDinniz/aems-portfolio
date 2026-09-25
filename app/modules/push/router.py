"""
Push module router - Endpoints for device token registration.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.security import get_current_user
from app.db.session import get_db
from app.modules.push import service
from app.modules.push.schemas import (
    PushDeviceRegister,
    PushDeviceResponse,
    WebPushPublicKeyResponse,
    WebPushSubscribe,
    WebPushUnsubscribe,
)

router = APIRouter(prefix="/push", tags=["Push Notifications"])


@router.post(
    "/devices",
    response_model=PushDeviceResponse,
    status_code=status.HTTP_200_OK,
    summary="Registrar dispositivo para push notifications",
)
async def register_device(
    data: PushDeviceRegister,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
) -> PushDeviceResponse:
    """
    Registra ou atualiza o token de push notification de um dispositivo.

    - Se o token nao existir, cria um novo registro (semantica de upsert).
    - Se o token ja existir (mesmo aparelho, conta diferente ou re-registro),
      atualiza user_id, platform, app_version e last_seen.

    Deve ser chamado pelo app mobile apos obter o token via
    `expo-notifications` (FCM no Android, APNs no iOS).
    """
    device = await service.register_device(db=db, user=current_user, data=data)
    return PushDeviceResponse.model_validate(device)


@router.delete(
    "/devices/{token:path}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remover dispositivo do registro de push",
)
async def delete_device(
    token: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
) -> None:
    """
    Remove o token de push notification do dispositivo.

    Idempotente: se o token nao existir ou nao pertencer ao usuario
    autenticado, retorna 204 sem erro.

    Deve ser chamado ao fazer logout ou ao desativar notificacoes no app.
    """
    await service.delete_device(db=db, user=current_user, token=token)


@router.get(
    "/web-public-key",
    response_model=WebPushPublicKeyResponse,
    summary="Chave pública VAPID para Web Push",
)
async def web_public_key(current_user=Depends(get_current_user)) -> WebPushPublicKeyResponse:
    """
    Retorna a chave pública VAPID usada pelo navegador em
    pushManager.subscribe(). Servida por endpoint (e não build-time) para
    permitir rotação de chave sem rebuild do frontend.
    """
    settings = get_settings()
    return WebPushPublicKeyResponse(
        public_key=settings.VAPID_PUBLIC_KEY,
        enabled=bool(settings.WEB_PUSH_ENABLED and settings.VAPID_PUBLIC_KEY),
    )


@router.post(
    "/web-subscriptions",
    status_code=status.HTTP_200_OK,
    summary="Registrar assinatura de Web Push (PWA)",
)
async def register_web_subscription(
    data: WebPushSubscribe,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
) -> dict:
    """Registra/atualiza a assinatura de Web Push do navegador (upsert por endpoint)."""
    subscription = await service.register_web_subscription(db=db, user=current_user, data=data)
    return {"id": subscription.id}


@router.delete(
    "/web-subscriptions",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remover assinatura de Web Push",
)
async def delete_web_subscription(
    data: WebPushUnsubscribe,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
) -> None:
    """Remove a assinatura (idempotente). Chamar no logout (best-effort)."""
    await service.delete_web_subscription(db=db, user=current_user, endpoint=data.endpoint)
