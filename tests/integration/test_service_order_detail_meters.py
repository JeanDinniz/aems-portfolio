"""
Testes do detalhe da O.S. (GET /service-orders/{id}) — HML-245.

O modal read-only do frontend precisa, por item: os metros de película
consumidos (`linear_meters`) e o instalador vinculado ao item
(`workers[].service_order_item_id`). Só o DETALHE calcula `linear_meters`
(a listagem deixa `None` para não fazer N+1).

Os cenários montam o estado da O.S. já finalizada direto via ORM (item +
FilmConsumption + ServiceOrderWorker), no mesmo padrão de
`test_film_scrap.py::TestScrapRatioAlert` — chamar o endpoint de finalize só
para popular o cenário reintroduziria, dentro do MESMO teste, a leitura do
detalhe numa sessão que já teria a O.S. no identity map (o fixture de teste
usa `expire_on_commit=False`); ao montar o estado direto, o GET é a primeira
leitura da O.S. nesta sessão e reflete o extrato normalmente.
"""

from datetime import UTC, date, datetime

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.employees.models import Employee
from app.modules.inventory.models import FilmConsumption, FilmRoll, FilmType
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem, ServiceOrderWorker
from app.modules.services.models import Service
from app.modules.stores.models import Store

WP1_METERS = 2.0


@pytest_asyncio.fixture
async def meters_film_service(db_session: AsyncSession, test_brand) -> Service:
    service = Service(
        name="Película Lateral e Traseira",
        code="WP1-DET",
        department="film",
        base_price=500.00,
        is_active=True,
        brand_id=test_brand.id,
    )
    db_session.add(service)
    await db_session.commit()
    await db_session.refresh(service)
    return service


@pytest_asyncio.fixture
async def meters_installer(db_session: AsyncSession, test_store: Store) -> Employee:
    employee = Employee(
        name="Instalador Detalhe",
        store_id=test_store.id,
        department="film",
        position="Instalador de Película",
        is_active=True,
    )
    db_session.add(employee)
    await db_session.commit()
    await db_session.refresh(employee)
    return employee


@pytest_asyncio.fixture
async def meters_roll(
    db_session: AsyncSession, test_store: Store, meters_film_service: Service
) -> FilmRoll:
    film_type = FilmType(
        name="WindowBlue Detalhe",
        department="film",
        available_tonalities=["G20"],
    )
    db_session.add(film_type)
    await db_session.flush()
    roll = FilmRoll(
        store_id=test_store.id,
        film_type_id=film_type.id,
        tonality="G20",
        total_meters=14.0,
        remaining_meters=14.0 - WP1_METERS,
        receipt_date=date(2026, 8, 13),
        status="em_uso",
    )
    db_session.add(roll)
    await db_session.commit()
    await db_session.refresh(roll)
    return roll


async def _make_completed_film_os(
    db_session: AsyncSession, store: Store, user: User, service: Service
) -> tuple[ServiceOrder, ServiceOrderItem]:
    """O.S. de Película já finalizada, com 1 item — sem passar pelo endpoint de
    finalize (ver docstring do módulo)."""
    now = datetime(2026, 8, 24, 8, 0, tzinfo=UTC)
    so = ServiceOrder(
        store_id=store.id,
        vehicle_plate="DET1A23",
        department="film",
        status="completed",
        entry_time=now,
        start_time=now,
        completion_time=now,
        created_by_id=user.id,
    )
    db_session.add(so)
    await db_session.flush()
    item = ServiceOrderItem(
        service_order_id=so.id,
        service_id=service.id,
        unit_price=service.base_price,
        quantity=1,
        tonality="G20",
    )
    db_session.add(item)
    await db_session.commit()
    await db_session.refresh(so)
    await db_session.refresh(item)
    return so, item


class TestServiceOrderDetailLinearMeters:
    """GET /service-orders/{id} — metros por item + instalador por item."""

    @pytest.mark.asyncio
    async def test_finalized_film_order_returns_linear_meters_and_worker_item(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        meters_film_service: Service,
        meters_installer: Employee,
        meters_roll: FilmRoll,
    ):
        """O.S. de Película finalizada com bobina vinculada: detalhe traz os
        metros consumidos pelo item e o instalador vinculado a esse item."""
        so, item = await _make_completed_film_os(
            db_session, test_store, test_user, meters_film_service
        )
        item.film_roll_id = meters_roll.id
        db_session.add(
            FilmConsumption(
                film_roll_id=meters_roll.id,
                service_order_item_id=item.id,
                meters_consumed=WP1_METERS,
                kind="consumo",
            )
        )
        db_session.add(
            ServiceOrderWorker(
                service_order_id=so.id,
                employee_id=meters_installer.id,
                service_order_item_id=item.id,
            )
        )
        await db_session.commit()

        detail = await owner_client.get(f"/api/v1/service-orders/{so.id}")
        assert detail.status_code == 200, detail.text
        data = detail.json()

        assert len(data["items"]) == 1
        item_resp = data["items"][0]
        assert item_resp["id"] == item.id
        assert item_resp["linear_meters"] == WP1_METERS

        assert len(data["workers"]) == 1
        worker = data["workers"][0]
        assert worker["employee_id"] == meters_installer.id
        assert worker["service_order_item_id"] == item.id

    @pytest.mark.asyncio
    async def test_order_without_film_consumption_has_none_linear_meters(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        meters_film_service: Service,
    ):
        """Item sem nenhum registro de consumo (nunca finalizado com bobina):
        `linear_meters` fica None — não vira 0.0 por engano."""
        so, _item = await _make_completed_film_os(
            db_session, test_store, test_user, meters_film_service
        )

        detail = await owner_client.get(f"/api/v1/service-orders/{so.id}")
        assert detail.status_code == 200, detail.text
        data = detail.json()

        assert len(data["items"]) == 1
        assert data["items"][0]["linear_meters"] is None
