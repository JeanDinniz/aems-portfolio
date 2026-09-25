"""
Ajuste de metros (conferência de estoque).
"""

from datetime import date

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.inventory.models import FilmRoll, FilmType
from app.modules.stores.models import Store


@pytest_asyncio.fixture
async def a_roll(db_session: AsyncSession, test_store: Store) -> FilmRoll:
    ft = FilmType(name="LabelType", department="film", available_tonalities=["G20"])
    db_session.add(ft)
    await db_session.flush()
    roll = FilmRoll(
        store_id=test_store.id,
        film_type_id=ft.id,
        tonality="G20",
        total_meters=14.0,
        remaining_meters=14.0,
        receipt_date=date(2026, 7, 20),
        status="em_uso",
    )
    db_session.add(roll)
    await db_session.commit()
    await db_session.refresh(roll)
    return roll


class TestAdjustMeters:
    @pytest.mark.asyncio
    async def test_adjust_sets_remaining(
        self, owner_client: AsyncClient, db_session: AsyncSession, a_roll: FilmRoll
    ):
        resp = await owner_client.patch(
            f"/api/v1/inventory/rolls/{a_roll.id}/adjust-meters",
            json={"remaining_meters": 7.3, "note": "conferencia 27/07"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["remaining_meters"] == pytest.approx(7.3)
        await db_session.refresh(a_roll)
        assert a_roll.remaining_meters == pytest.approx(7.3)

    @pytest.mark.asyncio
    async def test_adjust_above_total_rejected(self, owner_client: AsyncClient, a_roll: FilmRoll):
        resp = await owner_client.patch(
            f"/api/v1/inventory/rolls/{a_roll.id}/adjust-meters",
            json={"remaining_meters": 99.0},
        )
        assert resp.status_code in (400, 422)

    @pytest.mark.asyncio
    async def test_adjust_negative_rejected(self, owner_client: AsyncClient, a_roll: FilmRoll):
        resp = await owner_client.patch(
            f"/api/v1/inventory/rolls/{a_roll.id}/adjust-meters",
            json={"remaining_meters": -1},
        )
        assert resp.status_code == 422  # schema ge=0
