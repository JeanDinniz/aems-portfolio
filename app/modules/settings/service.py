"""
Lógica das Configurações globais.

As metas de faturamento (por funcionário) ficam numa única linha chave-valor;
quando ainda não foram salvas, valem os defaults acordados com a operação
(quadro: 7.000 / 8.500 / 10.000 por funcionário).
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.modules.auth.models import User
from app.modules.settings.models import SystemSetting

REVENUE_GOALS_KEY = "revenue_goals"

# Defaults do quadro (por funcionário). Usados enquanto o Owner não editar.
DEFAULT_REVENUE_GOALS: dict[str, float] = {
    "tier_1": 7000.0,
    "tier_2": 8500.0,
    "tier_3": 10000.0,
}


async def get_revenue_goals(db: AsyncSession) -> dict[str, float]:
    """Metas de faturamento por funcionário; cai nos defaults se não houver registro."""
    setting = await db.get(SystemSetting, REVENUE_GOALS_KEY)
    if setting is None or not setting.value:
        return dict(DEFAULT_REVENUE_GOALS)
    value = setting.value
    return {k: float(value.get(k, DEFAULT_REVENUE_GOALS[k])) for k in DEFAULT_REVENUE_GOALS}


async def set_revenue_goals(
    db: AsyncSession,
    tier_1: float,
    tier_2: float,
    tier_3: float,
    user: User | None = None,
) -> dict[str, float]:
    """Grava (ou atualiza) as metas de faturamento por funcionário."""
    old = await get_revenue_goals(db)
    new_value = {"tier_1": float(tier_1), "tier_2": float(tier_2), "tier_3": float(tier_3)}

    setting = await db.get(SystemSetting, REVENUE_GOALS_KEY)
    if setting is None:
        setting = SystemSetting(key=REVENUE_GOALS_KEY, value=new_value)
        db.add(setting)
    else:
        setting.value = new_value

    await log_audit(
        db=db,
        action="update",
        resource_type="system_setting",
        user_id=getattr(user, "id", None),
        old_value=old,
        new_value=new_value,
    )
    await db.commit()
    return new_value
