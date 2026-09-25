"""
Configurações globais do sistema - endpoints (restrito a Owner).
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import UserRole, require_roles
from app.core.security import get_current_user
from app.db.session import get_db
from app.modules.settings import service
from app.modules.settings.schemas import RevenueGoalConfig

router = APIRouter(
    prefix="/settings",
    tags=["Configurações"],
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)


@router.get("/revenue-goals", response_model=RevenueGoalConfig)
async def get_revenue_goals(db: AsyncSession = Depends(get_db)) -> RevenueGoalConfig:
    """Metas de faturamento por funcionário (Meta 1/2/3)."""
    goals = await service.get_revenue_goals(db)
    return RevenueGoalConfig(**goals)


@router.put("/revenue-goals", response_model=RevenueGoalConfig)
async def update_revenue_goals(
    data: RevenueGoalConfig,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
) -> RevenueGoalConfig:
    """Atualiza as metas de faturamento por funcionário."""
    goals = await service.set_revenue_goals(
        db, data.tier_1, data.tier_2, data.tier_3, user=current_user
    )
    return RevenueGoalConfig(**goals)
