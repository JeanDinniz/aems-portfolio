"""
Testes da saída avulsa de película (POST /inventory/withdrawals).

Regra: metros entregues a um funcionário fora de O.S. dão baixa na bobina
(via consume_roll — ledger FilmConsumption + threshold) e ficam registrados
para o resumo mensal por funcionário (desconto em folha). Estorno é soft:
devolve os metros, marca reversed_at/by e sai do resumo.
"""

from datetime import date

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.employees.models import Employee
from app.modules.inventory.models import FilmConsumption, FilmRoll, FilmType
from app.modules.stores.models import Store


@pytest_asyncio.fixture
async def withdrawal_film_type(db_session: AsyncSession) -> FilmType:
    film_type = FilmType(name="Window Blue Withdrawal", department="film")
    db_session.add(film_type)
    await db_session.commit()
    await db_session.refresh(film_type)
    return film_type


@pytest_asyncio.fixture
async def active_employee(db_session: AsyncSession, test_store: Store) -> Employee:
    employee = Employee(
        name="Vitor Withdrawal",
        store_id=test_store.id,
        position="Instalador de Película",
        is_active=True,
    )
    db_session.add(employee)
    await db_session.commit()
    await db_session.refresh(employee)
    return employee


@pytest_asyncio.fixture
async def inactive_employee(db_session: AsyncSession, test_store: Store) -> Employee:
    employee = Employee(
        name="Demitido Withdrawal",
        store_id=test_store.id,
        position="Instalador de Película",
        is_active=False,
    )
    db_session.add(employee)
    await db_session.commit()
    await db_session.refresh(employee)
    return employee


async def _make_roll(
    db_session: AsyncSession,
    store: Store,
    film_type: FilmType,
    status: str = "em_uso",
    total: float = 30.0,
    remaining: float = 30.0,
) -> FilmRoll:
    roll = FilmRoll(
        store_id=store.id,
        film_type_id=film_type.id,
        tonality="G05",
        total_meters=total,
        remaining_meters=remaining,
        receipt_date=date(2026, 7, 1),
        status=status,
    )
    db_session.add(roll)
    await db_session.commit()
    await db_session.refresh(roll)
    return roll


async def _create_withdrawal(
    client: AsyncClient,
    roll: FilmRoll,
    employee: Employee,
    meters: float = 1.6,
    reason: str | None = "pedaço p/ retrabalho",
):
    return await client.post(
        "/api/v1/inventory/withdrawals",
        json={
            "film_roll_id": roll.id,
            "employee_id": employee.id,
            "meters": meters,
            "reason": reason,
        },
    )


class TestCreateWithdrawal:
    @pytest.mark.asyncio
    async def test_create_debits_roll_and_records_ledger(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        withdrawal_film_type: FilmType,
        active_employee: Employee,
    ):
        roll = await _make_roll(db_session, test_store, withdrawal_film_type)

        response = await _create_withdrawal(owner_client, roll, active_employee, meters=1.6)
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["employee_name"] == active_employee.name
        assert body["meters"] == pytest.approx(1.6)
        assert body["store_id"] == test_store.id
        assert body["is_reversed"] is False
        assert body["tonality"] == "G05"

        await db_session.refresh(roll)
        assert roll.remaining_meters == pytest.approx(28.4)
        assert roll.status == "em_uso"

        consumptions = list(
            (
                await db_session.execute(
                    select(FilmConsumption).where(FilmConsumption.film_withdrawal_id == body["id"])
                )
            ).scalars()
        )
        assert len(consumptions) == 1
        assert consumptions[0].meters_consumed == pytest.approx(1.6)
        assert consumptions[0].service_order_item_id is None

    @pytest.mark.asyncio
    async def test_create_exceeding_remaining_rejected(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        withdrawal_film_type: FilmType,
        active_employee: Employee,
    ):
        roll = await _make_roll(
            db_session, test_store, withdrawal_film_type, status="em_uso", remaining=1.0
        )
        response = await _create_withdrawal(owner_client, roll, active_employee, meters=1.5)
        assert response.status_code == 422
        assert "restantes" in response.text

        await db_session.refresh(roll)
        assert roll.remaining_meters == pytest.approx(1.0)

    @pytest.mark.asyncio
    async def test_create_inactive_employee_rejected(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        withdrawal_film_type: FilmType,
        inactive_employee: Employee,
    ):
        roll = await _make_roll(db_session, test_store, withdrawal_film_type)
        response = await _create_withdrawal(owner_client, roll, inactive_employee)
        assert response.status_code == 422
        assert "inativo" in response.text.lower()

    @pytest.mark.asyncio
    async def test_create_unknown_employee_rejected(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        withdrawal_film_type: FilmType,
    ):
        roll = await _make_roll(db_session, test_store, withdrawal_film_type)
        response = await owner_client.post(
            "/api/v1/inventory/withdrawals",
            json={"film_roll_id": roll.id, "employee_id": 999999, "meters": 1.0},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_exhausted_roll_rejected(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        withdrawal_film_type: FilmType,
        active_employee: Employee,
    ):
        roll = await _make_roll(
            db_session, test_store, withdrawal_film_type, status="esgotada", remaining=0.0
        )
        response = await _create_withdrawal(owner_client, roll, active_employee, meters=0.5)
        assert response.status_code == 422
        assert "esgotada" in response.text.lower()


class TestReverseWithdrawal:
    @pytest.mark.asyncio
    async def test_reverse_returns_meters_and_marks_reversed(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        withdrawal_film_type: FilmType,
        active_employee: Employee,
    ):
        roll = await _make_roll(db_session, test_store, withdrawal_film_type)
        created = (await _create_withdrawal(owner_client, roll, active_employee, meters=2.0)).json()

        response = await owner_client.post(f"/api/v1/inventory/withdrawals/{created['id']}/reverse")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["is_reversed"] is True
        assert body["reversed_at"] is not None

        await db_session.refresh(roll)
        assert roll.remaining_meters == pytest.approx(30.0)

        # Ledger: débito de +2.0 na criação e crédito de -2.0 no estorno
        consumptions = list(
            (
                await db_session.execute(
                    select(FilmConsumption).where(
                        FilmConsumption.film_withdrawal_id == created["id"]
                    )
                )
            ).scalars()
        )
        assert sorted(c.meters_consumed for c in consumptions) == [
            pytest.approx(-2.0),
            pytest.approx(2.0),
        ]

        # Continua na listagem, marcada como estornada
        listing = await owner_client.get("/api/v1/inventory/withdrawals")
        items = [w for w in listing.json()["items"] if w["id"] == created["id"]]
        assert len(items) == 1
        assert items[0]["is_reversed"] is True

    @pytest.mark.asyncio
    async def test_reverse_twice_rejected(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        withdrawal_film_type: FilmType,
        active_employee: Employee,
    ):
        roll = await _make_roll(db_session, test_store, withdrawal_film_type)
        created = (await _create_withdrawal(owner_client, roll, active_employee)).json()

        first = await owner_client.post(f"/api/v1/inventory/withdrawals/{created['id']}/reverse")
        assert first.status_code == 200
        second = await owner_client.post(f"/api/v1/inventory/withdrawals/{created['id']}/reverse")
        assert second.status_code == 422
        assert "estornada" in second.text.lower()


class TestListAndSummary:
    @pytest.mark.asyncio
    async def test_list_filters_by_employee(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        withdrawal_film_type: FilmType,
        active_employee: Employee,
    ):
        other = Employee(
            name="Outro Instalador",
            store_id=test_store.id,
            position="Instalador de Película",
            is_active=True,
        )
        db_session.add(other)
        await db_session.commit()
        await db_session.refresh(other)

        roll = await _make_roll(db_session, test_store, withdrawal_film_type)
        assert (await _create_withdrawal(owner_client, roll, active_employee)).status_code == 201
        assert (await _create_withdrawal(owner_client, roll, other)).status_code == 201

        response = await owner_client.get(
            "/api/v1/inventory/withdrawals", params={"employee_id": active_employee.id}
        )
        assert response.status_code == 200
        items = response.json()["items"]
        assert len(items) == 1
        assert items[0]["employee_id"] == active_employee.id

    @pytest.mark.asyncio
    async def test_list_filters_by_period(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        withdrawal_film_type: FilmType,
        active_employee: Employee,
    ):
        roll = await _make_roll(db_session, test_store, withdrawal_film_type)
        created = (await _create_withdrawal(owner_client, roll, active_employee)).json()

        inside = await owner_client.get(
            "/api/v1/inventory/withdrawals",
            params={"date_from": "2026-01-01", "date_to": "2099-12-31"},
        )
        assert created["id"] in [w["id"] for w in inside.json()["items"]]

        outside = await owner_client.get(
            "/api/v1/inventory/withdrawals",
            params={"date_from": "2020-01-01", "date_to": "2020-12-31"},
        )
        assert created["id"] not in [w["id"] for w in outside.json()["items"]]

    @pytest.mark.asyncio
    async def test_summary_groups_by_employee_and_excludes_reversed(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        withdrawal_film_type: FilmType,
        active_employee: Employee,
    ):
        roll = await _make_roll(db_session, test_store, withdrawal_film_type)
        w1 = (await _create_withdrawal(owner_client, roll, active_employee, meters=1.6)).json()
        w2 = (await _create_withdrawal(owner_client, roll, active_employee, meters=1.5)).json()
        assert w1["id"] != w2["id"]

        # Estornar a segunda — só a primeira conta no resumo
        reverse = await owner_client.post(f"/api/v1/inventory/withdrawals/{w2['id']}/reverse")
        assert reverse.status_code == 200

        response = await owner_client.get(
            "/api/v1/inventory/withdrawals/summary",
            params={"employee_id": active_employee.id},
        )
        assert response.status_code == 200
        body = response.json()
        assert len(body["items"]) == 1
        item = body["items"][0]
        assert item["employee_name"] == active_employee.name
        assert item["withdrawal_count"] == 1
        assert item["total_meters"] == pytest.approx(1.6)
        assert body["total_meters"] == pytest.approx(1.6)

    @pytest.mark.asyncio
    async def test_roll_consumptions_show_withdrawal_employee(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        withdrawal_film_type: FilmType,
        active_employee: Employee,
    ):
        roll = await _make_roll(db_session, test_store, withdrawal_film_type)
        created = (await _create_withdrawal(owner_client, roll, active_employee)).json()

        response = await owner_client.get(f"/api/v1/inventory/rolls/{roll.id}/consumptions")
        assert response.status_code == 200
        rows = response.json()
        withdrawal_rows = [c for c in rows if c["film_withdrawal_id"] == created["id"]]
        assert len(withdrawal_rows) == 1
        assert withdrawal_rows[0]["withdrawal_employee_name"] == active_employee.name

    @pytest.mark.asyncio
    async def test_export_returns_xlsx(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        withdrawal_film_type: FilmType,
        active_employee: Employee,
    ):
        roll = await _make_roll(db_session, test_store, withdrawal_film_type)
        assert (await _create_withdrawal(owner_client, roll, active_employee)).status_code == 201

        response = await owner_client.get("/api/v1/inventory/withdrawals/export")
        assert response.status_code == 200
        assert "spreadsheetml" in response.headers["content-type"]
        assert response.content[:2] == b"PK"  # xlsx é um zip
