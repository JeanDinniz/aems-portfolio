"""
Testes do finalize com tonalidades por região (film_applications).

Item com N tonalidades distintas exige 1 bobina POR tonalidade no finalize;
cada bobina consome metros/K. Itens legados (tonalidade única) seguem o fluxo
antigo intacto. Payload legado (sem tonality) contra item multi-tonalidade → 422.
"""

from datetime import UTC, date, datetime

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.employees.models import Employee
from app.modules.inventory.models import (
    FilmConsumption,
    FilmRoll,
    FilmType,
    FilmTypeService,
)
from app.modules.service_orders.models import (
    ServiceOrder,
    ServiceOrderItem,
)
from app.modules.services.models import Service
from app.modules.stores.models import Store

METERS_PER_APPLICATION = 6.0


@pytest_asyncio.fixture
async def film_service(db_session: AsyncSession, test_brand) -> Service:
    service = Service(
        name="Película Poliester Lateral e Traseira",
        code="WP1",
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
async def film_installer(db_session: AsyncSession, test_store: Store) -> Employee:
    employee = Employee(
        name="Instalador Multi",
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
async def film_type_with_rolls(
    db_session: AsyncSession, test_store: Store, film_service: Service
) -> tuple[FilmType, FilmRoll, FilmRoll]:
    """Tipo de película com consumo cadastrado + 1 bobina G20 e 1 bobina G05."""
    film_type = FilmType(
        name="Poliester Multi",
        department="film",
        available_tonalities=["G05", "G20"],
    )
    db_session.add(film_type)
    await db_session.flush()
    db_session.add(
        FilmTypeService(
            film_type_id=film_type.id,
            service_id=film_service.id,
            meters_consumed=METERS_PER_APPLICATION,
        )
    )
    roll_g20 = FilmRoll(
        store_id=test_store.id,
        film_type_id=film_type.id,
        tonality="G20",
        total_meters=30.0,
        remaining_meters=30.0,
        receipt_date=date(2026, 7, 1),
        status="em_uso",
    )
    roll_g05 = FilmRoll(
        store_id=test_store.id,
        film_type_id=film_type.id,
        tonality="G05",
        total_meters=30.0,
        remaining_meters=30.0,
        receipt_date=date(2026, 7, 1),
        status="em_uso",
    )
    db_session.add_all([roll_g20, roll_g05])
    await db_session.commit()
    await db_session.refresh(film_type)
    await db_session.refresh(roll_g20)
    await db_session.refresh(roll_g05)
    return film_type, roll_g20, roll_g05


async def _make_os(
    db_session: AsyncSession,
    store: Store,
    user: User,
    service: Service,
    film_applications: list[dict] | None,
    tonality: str | None = None,
) -> tuple[ServiceOrder, ServiceOrderItem]:
    so = ServiceOrder(
        store_id=store.id,
        vehicle_plate="MLT1A23",
        department="film",
        status="in_progress",
        is_courtesy=False,
        is_galpon=False,
        is_return=False,
        entry_time=datetime(2026, 7, 10, 8, 0, tzinfo=UTC),
        start_time=datetime(2026, 7, 10, 8, 30, tzinfo=UTC),
        created_by_id=user.id,
    )
    db_session.add(so)
    await db_session.flush()
    item = ServiceOrderItem(
        service_order_id=so.id,
        service_id=service.id,
        unit_price=service.base_price,
        quantity=1,
        tonality=tonality,
        film_applications=film_applications,
    )
    db_session.add(item)
    await db_session.commit()
    await db_session.refresh(so)
    await db_session.refresh(item)
    return so, item


MULTI_APPLICATIONS = [
    {"tonality": "G20", "region": "Portas dianteiras"},
    {"tonality": "G05", "region": "Portas traseiras"},
]

# Mesma tonalidade em várias regiões: 1 tonalidade distinta (k=1), N aplicações.
# O consumo deve ocorrer 1x (metros/k = metros), NÃO 1x por região.
SAME_TONALITY_APPLICATIONS = [
    {"tonality": "G20", "region": "Portas dianteiras"},
    {"tonality": "G20", "region": "Portas traseiras"},
    {"tonality": "G20", "region": "Vidro traseiro"},
    {"tonality": "G20", "region": "Para-brisa"},
]


class TestFinalizeMultiTonality:
    @pytest.mark.asyncio
    async def test_requires_one_roll_per_tonality(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_service: Service,
        film_installer: Employee,
        film_type_with_rolls,
    ):
        """Mandar bobina só para G20 → 422 apontando a tonalidade faltante."""
        _, roll_g20, _ = film_type_with_rolls
        so, _ = await _make_os(
            db_session, test_store, test_user, film_service, MULTI_APPLICATIONS, "G20/G05"
        )
        response = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela1.jpg"],
                "film_roll_assignments": [
                    {
                        "service_id": film_service.id,
                        "film_roll_id": roll_g20.id,
                        "tonality": "G20",
                    },
                ],
                "employee_assignments": [
                    {"service_id": film_service.id, "employee_id": film_installer.id},
                ],
            },
        )
        assert response.status_code == 422
        assert "G05" in response.text

    @pytest.mark.asyncio
    async def test_finalize_consumes_half_meters_per_roll(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_service: Service,
        film_installer: Employee,
        film_type_with_rolls,
    ):
        """2 tonalidades → 2 bobinas, cada uma consome metros/2; espelho legado."""
        _, roll_g20, roll_g05 = film_type_with_rolls
        so, item = await _make_os(
            db_session, test_store, test_user, film_service, MULTI_APPLICATIONS, "G20/G05"
        )
        response = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela1.jpg"],
                "film_roll_assignments": [
                    {
                        "service_id": film_service.id,
                        "film_roll_id": roll_g20.id,
                        "tonality": "G20",
                    },
                    {
                        "service_id": film_service.id,
                        "film_roll_id": roll_g05.id,
                        "tonality": "G05",
                    },
                ],
                "employee_assignments": [
                    {"service_id": film_service.id, "employee_id": film_installer.id},
                ],
            },
        )
        assert response.status_code == 200
        assert response.json()["status"] == "completed"

        # Consumo dividido: metros/2 em cada bobina
        consumptions = list(
            (
                await db_session.execute(
                    select(FilmConsumption).where(FilmConsumption.service_order_item_id == item.id)
                )
            ).scalars()
        )
        assert len(consumptions) == 2
        by_roll = {c.film_roll_id: c.meters_consumed for c in consumptions}
        assert by_roll[roll_g20.id] == pytest.approx(METERS_PER_APPLICATION / 2)
        assert by_roll[roll_g05.id] == pytest.approx(METERS_PER_APPLICATION / 2)

        await db_session.refresh(roll_g20)
        await db_session.refresh(roll_g05)
        assert roll_g20.remaining_meters == pytest.approx(30.0 - METERS_PER_APPLICATION / 2)
        assert roll_g05.remaining_meters == pytest.approx(30.0 - METERS_PER_APPLICATION / 2)

        # JSON das aplicações ganhou bobina/código; espelho legado = 1ª aplicação
        await db_session.refresh(item)
        apps = item.film_applications
        assert apps[0]["film_roll_id"] == roll_g20.id
        assert apps[0]["roll_code"]
        assert apps[1]["film_roll_id"] == roll_g05.id
        assert item.film_roll_id == roll_g20.id
        assert item.roll_code == apps[0]["roll_code"]

    @pytest.mark.asyncio
    async def test_legacy_payload_against_multi_item_fails(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_service: Service,
        film_installer: Employee,
        film_type_with_rolls,
    ):
        """Cliente antigo (assignment sem tonality) contra item multi → 422 acionável."""
        _, roll_g20, _ = film_type_with_rolls
        so, _ = await _make_os(
            db_session, test_store, test_user, film_service, MULTI_APPLICATIONS, "G20/G05"
        )
        response = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela1.jpg"],
                "film_roll_assignments": [
                    {"service_id": film_service.id, "film_roll_id": roll_g20.id},
                ],
                "employee_assignments": [
                    {"service_id": film_service.id, "employee_id": film_installer.id},
                ],
            },
        )
        assert response.status_code == 422
        assert "atualize" in response.text.lower()

    @pytest.mark.asyncio
    async def test_wrong_tonality_roll_fails(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_service: Service,
        film_installer: Employee,
        film_type_with_rolls,
    ):
        """Bobina G05 atribuída à aplicação G20 → 422."""
        _, roll_g20, roll_g05 = film_type_with_rolls
        so, _ = await _make_os(
            db_session, test_store, test_user, film_service, MULTI_APPLICATIONS, "G20/G05"
        )
        response = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela1.jpg"],
                "film_roll_assignments": [
                    {
                        "service_id": film_service.id,
                        "film_roll_id": roll_g05.id,
                        "tonality": "G20",
                    },
                    {
                        "service_id": film_service.id,
                        "film_roll_id": roll_g20.id,
                        "tonality": "G05",
                    },
                ],
                "employee_assignments": [
                    {"service_id": film_service.id, "employee_id": film_installer.id},
                ],
            },
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_same_tonality_multi_region_consumes_once(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_service: Service,
        film_installer: Employee,
        film_type_with_rolls,
    ):
        """1 tonalidade em 4 regiões (k=1): consome metros 1x, não 1x por região.

        Regressão do bug de produção (O.S. 15264): o laço iterava por aplicação e
        chamava consume_roll por região, gastando N×metros. Com 4 regiões G20 a
        bobina zerava no meio do laço e a finalização quebrava com "bobina esgotada".
        """
        _, roll_g20, _ = film_type_with_rolls
        so, item = await _make_os(
            db_session, test_store, test_user, film_service, SAME_TONALITY_APPLICATIONS, "G20"
        )
        response = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela1.jpg"],
                "film_roll_assignments": [
                    {
                        "service_id": film_service.id,
                        "film_roll_id": roll_g20.id,
                        "tonality": "G20",
                    },
                ],
                "employee_assignments": [
                    {"service_id": film_service.id, "employee_id": film_installer.id},
                ],
            },
        )
        assert response.status_code == 200
        assert response.json()["status"] == "completed"

        # Consumo ocorre 1x (metros/k, k=1 = metros), não 1x por região.
        consumptions = list(
            (
                await db_session.execute(
                    select(FilmConsumption).where(FilmConsumption.service_order_item_id == item.id)
                )
            ).scalars()
        )
        assert len(consumptions) == 1
        assert consumptions[0].film_roll_id == roll_g20.id
        assert consumptions[0].meters_consumed == pytest.approx(METERS_PER_APPLICATION)

        await db_session.refresh(roll_g20)
        assert roll_g20.remaining_meters == pytest.approx(30.0 - METERS_PER_APPLICATION)

        # Todas as regiões recebem a bobina no JSON, mesmo consumindo só 1x.
        await db_session.refresh(item)
        assert all(app["film_roll_id"] == roll_g20.id for app in item.film_applications)
        assert item.film_roll_id == roll_g20.id

    @pytest.mark.asyncio
    async def test_same_tonality_multi_region_does_not_deplete_roll(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_service: Service,
        film_installer: Employee,
        film_type_with_rolls,
    ):
        """Bobina com metros suficientes p/ 1 aplicação (não N): finaliza sem esgotar.

        Reproduz o gatilho exato do erro em produção: saldo cobre metros/k uma vez,
        mas o consumo por-região tentava gastar N× e batia em "bobina esgotada".
        """
        _, roll_g20, _ = film_type_with_rolls
        # Bobina com saldo p/ exatamente 1 aplicação (metros/k = metros, k=1). O saldo
        # é derivado do extrato (total - Σ consumo), então encolhe-se o total_meters.
        roll_g20.total_meters = METERS_PER_APPLICATION
        roll_g20.remaining_meters = METERS_PER_APPLICATION
        await db_session.commit()

        so, _ = await _make_os(
            db_session, test_store, test_user, film_service, SAME_TONALITY_APPLICATIONS, "G20"
        )
        response = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela1.jpg"],
                "film_roll_assignments": [
                    {
                        "service_id": film_service.id,
                        "film_roll_id": roll_g20.id,
                        "tonality": "G20",
                    },
                ],
                "employee_assignments": [
                    {"service_id": film_service.id, "employee_id": film_installer.id},
                ],
            },
        )
        assert response.status_code == 200, response.text
        assert "esgotada" not in response.text.lower()

        await db_session.refresh(roll_g20)
        assert roll_g20.remaining_meters == pytest.approx(0.0)

    @pytest.mark.asyncio
    async def test_legacy_single_tonality_item_unchanged(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_service: Service,
        film_installer: Employee,
        film_type_with_rolls,
    ):
        """Item legado (sem film_applications): 1 bobina, consumo integral."""
        _, roll_g20, _ = film_type_with_rolls
        so, item = await _make_os(db_session, test_store, test_user, film_service, None, "G20")
        response = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela1.jpg"],
                "film_roll_assignments": [
                    {"service_id": film_service.id, "film_roll_id": roll_g20.id},
                ],
                "employee_assignments": [
                    {"service_id": film_service.id, "employee_id": film_installer.id},
                ],
            },
        )
        assert response.status_code == 200

        await db_session.refresh(roll_g20)
        assert roll_g20.remaining_meters == pytest.approx(30.0 - METERS_PER_APPLICATION)
        await db_session.refresh(item)
        assert item.film_roll_id == roll_g20.id
        assert item.film_applications is None
