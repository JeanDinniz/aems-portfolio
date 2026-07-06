"""
Push module router - Endpoints for device token registration.
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.modules.push import service
from app.modules.push.schemas import PushDeviceRegister, PushDeviceResponse

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
