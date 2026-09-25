"""
Metas de faturamento: config global (settings) + card de meta no Dashboard.
"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.employees.models import Employee
from app.modules.stores.models import Store


@pytest.mark.asyncio
async def test_revenue_goals_defaults_and_update(owner_client: AsyncClient):
    """GET traz os defaults do quadro; PUT persiste e GET reflete."""
    r = await owner_client.get("/api/v1/settings/revenue-goals")
    assert r.status_code == 200, r.text
    assert r.json() == {"tier_1": 7000.0, "tier_2": 8500.0, "tier_3": 10000.0}

    r = await owner_client.put(
        "/api/v1/settings/revenue-goals",
        json={"tier_1": 6000, "tier_2": 8000, "tier_3": 12000},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"tier_1": 6000.0, "tier_2": 8000.0, "tier_3": 12000.0}

    r = await owner_client.get("/api/v1/settings/revenue-goals")
    assert r.json()["tier_3"] == 12000.0


@pytest.mark.asyncio
async def test_revenue_goals_forbidden_for_non_owner(authenticated_client: AsyncClient):
    """Somente Owner acessa as metas."""
    r = await authenticated_client.get("/api/v1/settings/revenue-goals")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_meta_employee_count_excludes_installers(
    owner_client: AsyncClient,
    db_session: AsyncSession,
    test_store: Store,
):
    """
    O Nº de funcionários da meta conta ativos e ignora instaladores (cargo).
    Com metas default (7.000/8.500/10.000) e 2 funcionários válidos, a Meta 1 = 14.000.
    """
    db_session.add_all(
        [
            Employee(name="Ana Estetica", store_id=test_store.id, position="Lavador", is_active=True, hr_status="active"),
            Employee(name="Bia Polidora", store_id=test_store.id, position="Polidora", is_active=True, hr_status="active"),
            Employee(name="Caio Instalador", store_id=test_store.id, position="Instalador de Película", is_active=True, hr_status="active"),
            Employee(name="Dan Inativo", store_id=test_store.id, position="Lavador", is_active=False, hr_status="active"),
        ]
    )
    await db_session.commit()

    # Garante metas default para o cálculo
    await owner_client.put(
        "/api/v1/settings/revenue-goals",
        json={"tier_1": 7000, "tier_2": 8500, "tier_3": 10000},
    )

    r = await owner_client.get(
        "/api/v1/analytics/dashboard/overview",
        params={
            "start_date": "2026-07-01T00:00:00",
            "end_date": "2026-07-31T23:59:59",
            "store_id": test_store.id,
        },
    )
    assert r.status_code == 200, r.text
    goal = r.json()["revenue_goal"]
    # 2 válidos (Ana, Bia); Caio é instalador, Dan é inativo → fora
    assert goal["employee_count"] == 2
    assert goal["targets"] == [14000.0, 17000.0, 20000.0]
    assert goal["per_employee"] == [7000.0, 8500.0, 10000.0]
