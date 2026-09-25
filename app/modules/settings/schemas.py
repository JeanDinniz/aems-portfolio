"""Schemas das Configurações globais do sistema."""

from pydantic import BaseModel, Field


class RevenueGoalConfig(BaseModel):
    """Metas de faturamento POR FUNCIONÁRIO (multiplicadas pelo Nº de funcionários)."""

    tier_1: float = Field(..., ge=0, description="Meta 1 por funcionário (R$)")
    tier_2: float = Field(..., ge=0, description="Meta 2 por funcionário (R$)")
    tier_3: float = Field(..., ge=0, description="Meta 3 por funcionário (R$)")
