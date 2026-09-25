"""
Push module schemas - Pydantic models for device registration.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PushDeviceRegister(BaseModel):
    """Body para registrar (ou atualizar) um dispositivo de push."""

    token: str = Field(..., min_length=1, max_length=512, description="Token FCM ou APNs")
    platform: Literal["ios", "android"] = Field(..., description="Plataforma do dispositivo")
    app_version: str | None = Field(None, max_length=32, description="Versao do app (ex.: '1.2.3')")


class PushDeviceResponse(BaseModel):
    """Resposta apos registrar/consultar um dispositivo."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    token: str
    platform: str
    app_version: str | None
    created_at: datetime
    last_seen: datetime


class WebPushKeys(BaseModel):
    """Chaves da subscription retornadas pelo navegador."""

    p256dh: str = Field(..., min_length=1, max_length=255)
    auth: str = Field(..., min_length=1, max_length=255)


class WebPushSubscribe(BaseModel):
    """Body para registrar (ou atualizar) uma assinatura de Web Push."""

    endpoint: str = Field(..., min_length=10, max_length=1024)
    keys: WebPushKeys
    user_agent: str | None = Field(None, max_length=500)


class WebPushUnsubscribe(BaseModel):
    """Body para remover uma assinatura de Web Push."""

    endpoint: str = Field(..., min_length=10, max_length=1024)


class WebPushPublicKeyResponse(BaseModel):
    """Chave pública VAPID para o pushManager.subscribe do navegador."""

    public_key: str
    enabled: bool
