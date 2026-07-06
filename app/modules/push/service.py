"""
Push module service - Business logic for device token management.
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.push.models import PushDevice
from app.modules.push.schemas import PushDeviceRegister

if TYPE_CHECKING:
    from app.modules.auth.models import User


async def register_device(
    db: AsyncSession,
    user: "User",
    data: PushDeviceRegister,
) -> PushDevice:
    """
    Registra ou atualiza um dispositivo de push notification.

    Regras de negocio:
    - O token e a chave de unicidade. Se ja existir, atualiza user_id,
      platform, app_version e last_seen (suporte a troca de conta no
      mesmo aparelho).
    - Se nao existir, cria um novo registro.

    Args:
        db: Sessao async do banco de dados.
        user: Usuario autenticado que esta registrando o device.
        data: Payload com token, platform e app_version.

    Returns:
        PushDevice persistido (novo ou atualizado).
    """
    now = datetime.now(UTC)

    result = await db.execute(select(PushDevice).where(PushDevice.token == data.token))
    device = result.scalar_one_or_none()

    if device is not None:
        # UPSERT: token migra de conta — atualiza dados
        device.user_id = user.id
        device.platform = data.platform
        device.app_version = data.app_version
        device.last_seen = now
    else:
        device = PushDevice(
            user_id=user.id,
            token=data.token,
            platform=data.platform,
            app_version=data.app_version,
            created_at=now,
            last_seen=now,
        )
        db.add(device)

    await db.commit()
    await db.refresh(device)
    return device


async def delete_device(
    db: AsyncSession,
    user: "User",
    token: str,
) -> None:
    """
    Remove o registro de um dispositivo pelo token.

    Idempotente: se o token nao existir (ou nao pertencer ao usuario),
    retorna sem erro.

    Regra de seguranca: o DELETE filtra por token E user_id, garantindo
    que um usuario nao possa remover o device de outro usuario.

    Args:
        db: Sessao async do banco de dados.
        user: Usuario autenticado.
        token: Token FCM/APNs a remover.
    """
    await db.execute(
        delete(PushDevice).where(
            PushDevice.token == token,
            PushDevice.user_id == user.id,
        )
    )
    await db.commit()
