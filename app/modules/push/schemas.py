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
