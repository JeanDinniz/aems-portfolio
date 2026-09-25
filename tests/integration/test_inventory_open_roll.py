"""
Testes da abertura de bobina (PATCH /inventory/rolls/{id}/open) e da guarda de
consumo em bobina lacrada.

Regra: só bobinas abertas (em_uso) recebem consumo. Uma bobina nasce lacrada
(em_estoque) e precisa ser aberta deliberadamente — ação restrita a quem tem
permissão de estoque (inventory can_edit) e registrada em auditoria. Isso impede
que instaladores lancem consumo na bobina errada (a primeira que virem).
"""

from datetime import date

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.inventory.models import FilmRoll, FilmType
from app.modules.stores.models import Store


@pytest_asyncio.fixture
async def open_film_type(db_session: AsyncSession) -> FilmType:
    film_type = FilmType(name="Window Blue Open", department="film")
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


class TestOpenRoll:
    @pytest.mark.asyncio
    async def test_open_promotes_em_estoque_to_em_uso(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        open_film_type: FilmType,
    ):
        """Bobina lacrada abre para uso sem alterar os metros."""
        roll = await _make_roll(db_session, test_store, open_film_type, remaining=25.0)

        response = await owner_client.patch(f"/api/v1/inventory/rolls/{roll.id}/open")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "em_uso"
        assert body["remaining_meters"] == pytest.approx(25.0)

        await db_session.refresh(roll)
        assert roll.status == "em_uso"

    @pytest.mark.asyncio
    async def test_open_em_uso_rejected(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        open_film_type: FilmType,
    ):
        """Bobina já aberta não pode ser reaberta."""
        roll = await _make_roll(db_session, test_store, open_film_type, status="em_uso")
        response = await owner_client.patch(f"/api/v1/inventory/rolls/{roll.id}/open")
        assert response.status_code == 422
        assert "estoque" in response.text.lower()

    @pytest.mark.asyncio
    async def test_open_esgotada_rejected(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        open_film_type: FilmType,
    ):
        """Bobina esgotada não abre — precisa restaurar antes."""
        roll = await _make_roll(
            db_session, test_store, open_film_type, status="esgotada", remaining=0.0
        )
        response = await owner_client.patch(f"/api/v1/inventory/rolls/{roll.id}/open")
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_open_requires_inventory_permission(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        open_film_type: FilmType,
    ):
        """Usuário sem permissão de estoque (só service_orders) não abre bobina."""
        roll = await _make_roll(db_session, test_store, open_film_type)
        response = await authenticated_client.patch(f"/api/v1/inventory/rolls/{roll.id}/open")
        assert response.status_code == 403

        await db_session.refresh(roll)
        assert roll.status == "em_estoque"


class TestConsumeGuard:
    @pytest.mark.asyncio
    async def test_withdrawal_on_sealed_roll_rejected(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        open_film_type: FilmType,
        test_employee,
    ):
        """Saída avulsa (via consume_roll) numa bobina lacrada é bloqueada."""
        roll = await _make_roll(db_session, test_store, open_film_type)
        response = await owner_client.post(
            "/api/v1/inventory/withdrawals",
            json={"film_roll_id": roll.id, "employee_id": test_employee.id, "meters": 1.0},
        )
        assert response.status_code == 422
        assert "lacrada" in response.text.lower()

        await db_session.refresh(roll)
        assert roll.remaining_meters == pytest.approx(30.0)
        assert roll.status == "em_estoque"

    @pytest.mark.asyncio
    async def test_withdrawal_after_open_succeeds(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        open_film_type: FilmType,
        test_employee,
    ):
        """Após abrir a bobina, a saída avulsa passa e debita os metros."""
        roll = await _make_roll(db_session, test_store, open_film_type)

        open_resp = await owner_client.patch(f"/api/v1/inventory/rolls/{roll.id}/open")
        assert open_resp.status_code == 200, open_resp.text

        response = await owner_client.post(
            "/api/v1/inventory/withdrawals",
            json={"film_roll_id": roll.id, "employee_id": test_employee.id, "meters": 1.0},
        )
        assert response.status_code == 201, response.text

        await db_session.refresh(roll)
        assert roll.remaining_meters == pytest.approx(29.0)
        assert roll.status == "em_uso"
