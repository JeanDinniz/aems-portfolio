"""
Testes da transferência de bobina entre lojas (POST /inventory/rolls/{id}/transfer).

Regra: bobinas em_estoque OU em_uso podem ser transferidas — a parcialmente
usada leva os metros restantes e o histórico de consumo junto (as O.S. da loja
de origem continuam referenciando-a). Esgotada não pode (restaurar antes).
"""

from datetime import date

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.inventory.models import FilmConsumption, FilmRoll, FilmType
from app.modules.stores.models import Store


@pytest_asyncio.fixture
async def target_store(db_session: AsyncSession, test_brand) -> Store:
    store = Store(
        name="Loja Destino Transferência",
        code="LJTR",
        brand_id=test_brand.id,
        is_active=True,
    )
    db_session.add(store)
    await db_session.commit()
    await db_session.refresh(store)
    return store


@pytest_asyncio.fixture
async def transfer_film_type(db_session: AsyncSession) -> FilmType:
    film_type = FilmType(name="Poliester Transfer", department="film")
    db_session.add(film_type)
    await db_session.commit()
    await db_session.refresh(film_type)
    return film_type


async def _make_roll(
    db_session: AsyncSession,
    store: Store,
    film_type: FilmType,
    status: str = "em_estoque",
    total: float = 30.0,
    remaining: float = 30.0,
) -> FilmRoll:
    roll = FilmRoll(
        store_id=store.id,
        film_type_id=film_type.id,
        tonality="G20",
        total_meters=total,
        remaining_meters=remaining,
        receipt_date=date(2026, 7, 1),
        status=status,
    )
    db_session.add(roll)
    await db_session.commit()
    await db_session.refresh(roll)
    return roll


class TestTransferRoll:
    @pytest.mark.asyncio
    async def test_transfer_em_estoque(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        target_store: Store,
        transfer_film_type: FilmType,
    ):
        """Comportamento original: bobina intocada transfere normalmente."""
        roll = await _make_roll(db_session, test_store, transfer_film_type)
        response = await owner_client.post(
            f"/api/v1/inventory/rolls/{roll.id}/transfer",
            json={"target_store_id": target_store.id},
        )
        assert response.status_code == 200, response.text
        assert response.json()["store_id"] == target_store.id

    @pytest.mark.asyncio
    async def test_transfer_em_uso_keeps_meters_status_and_history(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        target_store: Store,
        transfer_film_type: FilmType,
    ):
        """
        Bobina parcialmente usada transfere: muda só a loja — metros restantes,
        status em_uso e histórico de consumo permanecem intactos.
        """
        roll = await _make_roll(
            db_session,
            test_store,
            transfer_film_type,
            status="em_uso",
            total=30.0,
            remaining=18.5,
        )
        db_session.add(
            FilmConsumption(film_roll_id=roll.id, service_order_item_id=None, meters_consumed=11.5)
        )
        await db_session.commit()

        response = await owner_client.post(
            f"/api/v1/inventory/rolls/{roll.id}/transfer",
            json={"target_store_id": target_store.id},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["store_id"] == target_store.id
        assert body["status"] == "em_uso"
        assert body["remaining_meters"] == pytest.approx(18.5)

        consumptions = list(
            (
                await db_session.execute(
                    select(FilmConsumption).where(FilmConsumption.film_roll_id == roll.id)
                )
            ).scalars()
        )
        assert len(consumptions) == 1
        assert consumptions[0].meters_consumed == pytest.approx(11.5)

    @pytest.mark.asyncio
    async def test_transfer_esgotada_rejected(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        target_store: Store,
        transfer_film_type: FilmType,
    ):
        """Esgotada não transfere — precisa restaurar antes."""
        roll = await _make_roll(
            db_session,
            test_store,
            transfer_film_type,
            status="esgotada",
            remaining=0.0,
        )
        response = await owner_client.post(
            f"/api/v1/inventory/rolls/{roll.id}/transfer",
            json={"target_store_id": target_store.id},
        )
        assert response.status_code == 400
        assert "esgotada" in response.text.lower()

    @pytest.mark.asyncio
    async def test_transfer_same_store_rejected(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        transfer_film_type: FilmType,
    ):
        roll = await _make_roll(db_session, test_store, transfer_film_type, status="em_uso")
        response = await owner_client.post(
            f"/api/v1/inventory/rolls/{roll.id}/transfer",
            json={"target_store_id": test_store.id},
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_transferred_roll_available_at_target_store(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        target_store: Store,
        transfer_film_type: FilmType,
    ):
        """Após transferir, a bobina em uso aparece na listagem da loja destino."""
        roll = await _make_roll(
            db_session,
            test_store,
            transfer_film_type,
            status="em_uso",
            remaining=10.0,
        )
        response = await owner_client.post(
            f"/api/v1/inventory/rolls/{roll.id}/transfer",
            json={"target_store_id": target_store.id},
        )
        assert response.status_code == 200

        listing = await owner_client.get(
            "/api/v1/inventory/rolls",
            params={"store_id": target_store.id, "limit": 100},
        )
        assert listing.status_code == 200
        ids = [r["id"] for r in listing.json()["items"]]
        assert roll.id in ids
