"""
Testes do RETALHO de película (serviço feito com sobra de corte anterior).

O pedaço reaproveitado já foi debitado da bobina quando o carro de origem
consumiu os metros de tabela — debitar de novo era o que zerava a bobina antes
da hora. Marcado o retalho, o finalize não consome metros; quando a bobina de
origem é informada, entra no extrato dela um movimento de 0m só para o
histórico mostrar o carro que aproveitou a sobra.
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
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem
from app.modules.services.models import Service
from app.modules.stores.models import Store

WP1_METERS = 2.0
WP2_METERS = 1.5


@pytest_asyncio.fixture
async def film_services(db_session: AsyncSession, test_brand) -> tuple[Service, Service]:
    """WP1 (lateral+traseira) e WP2 — o combo que sempre sobra pedaço na operação."""
    wp1 = Service(
        name="Película Lateral e Traseira",
        code="WP1",
        department="film",
        base_price=500.00,
        is_active=True,
        brand_id=test_brand.id,
    )
    wp2 = Service(
        name="Película Parabrisa",
        code="WP2",
        department="film",
        base_price=300.00,
        is_active=True,
        brand_id=test_brand.id,
    )
    db_session.add_all([wp1, wp2])
    await db_session.commit()
    await db_session.refresh(wp1)
    await db_session.refresh(wp2)
    return wp1, wp2


@pytest_asyncio.fixture
async def film_installer(db_session: AsyncSession, test_store: Store) -> Employee:
    employee = Employee(
        name="Instalador Retalho",
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
async def film_stock(
    db_session: AsyncSession, test_store: Store, film_services
) -> tuple[FilmType, FilmRoll, FilmRoll]:
    """Tipo com consumo por serviço + bobina em uso e bobina antiga já esgotada."""
    wp1, wp2 = film_services
    film_type = FilmType(
        name="WindowBlue",
        department="film",
        available_tonalities=["G20"],
    )
    db_session.add(film_type)
    await db_session.flush()
    db_session.add_all(
        [
            FilmTypeService(
                film_type_id=film_type.id, service_id=wp1.id, meters_consumed=WP1_METERS
            ),
            FilmTypeService(
                film_type_id=film_type.id, service_id=wp2.id, meters_consumed=WP2_METERS
            ),
        ]
    )
    in_use = FilmRoll(
        store_id=test_store.id,
        film_type_id=film_type.id,
        tonality="G20",
        total_meters=14.0,
        remaining_meters=14.0,
        receipt_date=date(2026, 8, 13),
        status="em_uso",
    )
    exhausted = FilmRoll(
        store_id=test_store.id,
        film_type_id=film_type.id,
        tonality="G20",
        total_meters=14.0,
        remaining_meters=0.0,
        receipt_date=date(2026, 6, 1),
        status="esgotada",
    )
    db_session.add_all([in_use, exhausted])
    await db_session.commit()
    await db_session.refresh(film_type)
    await db_session.refresh(in_use)
    await db_session.refresh(exhausted)
    return film_type, in_use, exhausted


async def _make_os(
    db_session: AsyncSession,
    store: Store,
    user: User,
    services: list[Service],
    plate: str = "RET1A23",
) -> ServiceOrder:
    so = ServiceOrder(
        store_id=store.id,
        vehicle_plate=plate,
        department="film",
        status="in_progress",
        entry_time=datetime(2026, 8, 24, 8, 0, tzinfo=UTC),
        start_time=datetime(2026, 8, 24, 8, 30, tzinfo=UTC),
        created_by_id=user.id,
    )
    db_session.add(so)
    await db_session.flush()
    for svc in services:
        db_session.add(
            ServiceOrderItem(
                service_order_id=so.id,
                service_id=svc.id,
                unit_price=svc.base_price,
                quantity=1,
                tonality="G20",
            )
        )
    await db_session.commit()
    await db_session.refresh(so)
    return so


async def _items(db_session: AsyncSession, so_id: int) -> list[ServiceOrderItem]:
    rows = await db_session.execute(
        select(ServiceOrderItem)
        .where(ServiceOrderItem.service_order_id == so_id)
        .order_by(ServiceOrderItem.id)
    )
    return list(rows.scalars().all())


async def _consumptions(db_session: AsyncSession, roll_id: int) -> list[FilmConsumption]:
    rows = await db_session.execute(
        select(FilmConsumption).where(FilmConsumption.film_roll_id == roll_id)
    )
    return list(rows.scalars().all())


class TestFinalizeWithScrap:
    @pytest.mark.asyncio
    async def test_scrap_does_not_consume_and_records_zero_movement(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_services,
        film_installer: Employee,
        film_stock,
    ):
        """Serviço no retalho: bobina intacta + movimento de 0m na bobina de origem."""
        wp1, _ = film_services
        _, in_use, exhausted = film_stock
        so = await _make_os(db_session, test_store, test_user, [wp1])

        response = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela.jpg"],
                "film_roll_assignments": [
                    {
                        "service_id": wp1.id,
                        "used_scrap": True,
                        "scrap_source_roll_id": exhausted.id,
                    }
                ],
                "employee_assignments": [{"service_id": wp1.id, "employee_id": film_installer.id}],
            },
        )
        assert response.status_code == 200, response.text

        await db_session.refresh(in_use)
        await db_session.refresh(exhausted)
        # Nenhuma bobina perde metros — a sobra já saiu no corte anterior
        assert in_use.remaining_meters == 14.0
        assert exhausted.remaining_meters == 0.0
        # Bobina de origem continua esgotada (o movimento de 0m não a revive)
        assert exhausted.status == "esgotada"

        items = await _items(db_session, so.id)
        assert items[0].used_scrap is True
        assert items[0].scrap_source_roll_id == exhausted.id
        assert items[0].film_roll_id is None

        assert await _consumptions(db_session, in_use.id) == []
        scrap_rows = await _consumptions(db_session, exhausted.id)
        assert len(scrap_rows) == 1
        assert scrap_rows[0].kind == "retalho"
        assert scrap_rows[0].meters_consumed == 0.0
        assert scrap_rows[0].service_order_item_id == items[0].id

    @pytest.mark.asyncio
    async def test_scrap_without_source_roll_is_accepted(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_services,
        film_installer: Employee,
        film_stock,
    ):
        """Origem é opcional: o pedaço costuma vir de rolo antigo que ninguém lembra."""
        wp1, _ = film_services
        _, in_use, exhausted = film_stock
        so = await _make_os(db_session, test_store, test_user, [wp1])

        response = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela.jpg"],
                "film_roll_assignments": [{"service_id": wp1.id, "used_scrap": True}],
                "employee_assignments": [{"service_id": wp1.id, "employee_id": film_installer.id}],
            },
        )
        assert response.status_code == 200, response.text

        items = await _items(db_session, so.id)
        assert items[0].used_scrap is True
        assert items[0].scrap_source_roll_id is None
        assert await _consumptions(db_session, in_use.id) == []
        assert await _consumptions(db_session, exhausted.id) == []

    @pytest.mark.asyncio
    async def test_mixed_services_consume_only_the_roll_one(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_services,
        film_installer: Employee,
        film_stock,
    ):
        """WP1 no retalho + WP2 na bobina → desconta só os metros do WP2."""
        wp1, wp2 = film_services
        _, in_use, exhausted = film_stock
        so = await _make_os(db_session, test_store, test_user, [wp1, wp2])

        response = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela.jpg"],
                "film_roll_assignments": [
                    {
                        "service_id": wp1.id,
                        "used_scrap": True,
                        "scrap_source_roll_id": exhausted.id,
                    },
                    {"service_id": wp2.id, "film_roll_id": in_use.id},
                ],
                "employee_assignments": [
                    {"service_id": wp1.id, "employee_id": film_installer.id},
                    {"service_id": wp2.id, "employee_id": film_installer.id},
                ],
            },
        )
        assert response.status_code == 200, response.text

        await db_session.refresh(in_use)
        assert in_use.remaining_meters == 14.0 - WP2_METERS

        items = {it.service_id: it for it in await _items(db_session, so.id)}
        assert items[wp1.id].used_scrap is True
        assert items[wp2.id].used_scrap is False
        assert items[wp2.id].film_roll_id == in_use.id

    @pytest.mark.asyncio
    async def test_assignment_without_roll_and_without_scrap_is_rejected(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_services,
        film_installer: Employee,
        film_stock,
    ):
        """Sem bobina e sem retalho continua barrado — retalho não vira brecha."""
        wp1, _ = film_services
        so = await _make_os(db_session, test_store, test_user, [wp1])

        response = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela.jpg"],
                "film_roll_assignments": [{"service_id": wp1.id}],
                "employee_assignments": [{"service_id": wp1.id, "employee_id": film_installer.id}],
            },
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_edit_preserves_scrap_mark_and_does_not_consume(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_services,
        film_installer: Employee,
        film_stock,
    ):
        """Editar a O.S. não pode apagar o retalho nem debitar a bobina depois."""
        wp1, _ = film_services
        _, in_use, exhausted = film_stock
        so = await _make_os(db_session, test_store, test_user, [wp1])

        finalize = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela.jpg"],
                "film_roll_assignments": [
                    {
                        "service_id": wp1.id,
                        "used_scrap": True,
                        "scrap_source_roll_id": exhausted.id,
                    }
                ],
                "employee_assignments": [{"service_id": wp1.id, "employee_id": film_installer.id}],
            },
        )
        assert finalize.status_code == 200, finalize.text

        # Edição sem tocar em bobina (nenhuma tela expõe retalho na edição)
        edit = await owner_client.patch(
            f"/api/v1/service-orders/{so.id}",
            json={"items": [{"service_id": wp1.id, "quantity": 1, "tonality": "G20"}]},
        )
        assert edit.status_code == 200, edit.text

        await db_session.refresh(in_use)
        assert in_use.remaining_meters == 14.0

        items = await _items(db_session, so.id)
        assert items[0].used_scrap is True
        assert items[0].scrap_source_roll_id == exhausted.id
        # Movimento de 0m segue no extrato, re-vinculado ao item novo
        scrap_rows = await _consumptions(db_session, exhausted.id)
        assert len(scrap_rows) == 1
        assert scrap_rows[0].service_order_item_id == items[0].id

    @pytest.mark.asyncio
    async def test_multi_tonality_scrap_only_consumes_the_other_tonality(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_services,
        film_installer: Employee,
        film_stock,
    ):
        """Item com tonalidades por região: retalho numa delas não consome nada."""
        wp1, _ = film_services
        film_type, in_use, exhausted = film_stock
        roll_g05 = FilmRoll(
            store_id=test_store.id,
            film_type_id=film_type.id,
            tonality="G05",
            total_meters=20.0,
            remaining_meters=20.0,
            receipt_date=date(2026, 8, 1),
            status="em_uso",
        )
        db_session.add(roll_g05)
        so = await _make_os(db_session, test_store, test_user, [])
        item = ServiceOrderItem(
            service_order_id=so.id,
            service_id=wp1.id,
            unit_price=wp1.base_price,
            quantity=1,
            tonality="G20/G05",
            film_applications=[
                {"tonality": "G20", "region": "Portas dianteiras"},
                {"tonality": "G05", "region": "Portas traseiras"},
            ],
        )
        db_session.add(item)
        await db_session.commit()
        await db_session.refresh(roll_g05)

        response = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela.jpg"],
                "film_roll_assignments": [
                    {
                        "service_id": wp1.id,
                        "tonality": "G20",
                        "used_scrap": True,
                        "scrap_source_roll_id": exhausted.id,
                    },
                    {
                        "service_id": wp1.id,
                        "tonality": "G05",
                        "film_roll_id": roll_g05.id,
                    },
                ],
                "employee_assignments": [{"service_id": wp1.id, "employee_id": film_installer.id}],
            },
        )
        assert response.status_code == 200, response.text

        await db_session.refresh(in_use)
        await db_session.refresh(roll_g05)
        assert in_use.remaining_meters == 14.0
        # G05 consome metros/K (K = 2 tonalidades distintas)
        assert roll_g05.remaining_meters == 20.0 - WP1_METERS / 2

        items = await _items(db_session, so.id)
        applications = {app["tonality"]: app for app in items[0].film_applications}
        assert applications["G20"]["used_scrap"] is True
        assert applications["G20"]["scrap_source_roll_id"] == exhausted.id
        assert applications["G05"]["film_roll_id"] == roll_g05.id
        assert items[0].used_scrap is True


class TestScrapRatioAlert:
    @pytest.mark.asyncio
    async def test_alert_fires_when_installer_crosses_threshold(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_owner: User,
        film_services,
        film_installer: Employee,
        film_stock,
    ):
        """Freio do retalho: avisa o Owner ao cruzar 40% no mês (mín. 10 serviços)."""
        from app.modules.inventory.service import notify_scrap_ratio_if_crossed
        from app.modules.notifications.models import Notification
        from app.modules.service_orders.models import ServiceOrderWorker

        wp1, _ = film_services
        now = datetime.now(UTC)

        async def _completed_os(scrap: bool) -> ServiceOrder:
            so = ServiceOrder(
                store_id=test_store.id,
                vehicle_plate="ALR1A23",
                department="film",
                status="completed",
                entry_time=now,
                completion_time=now,
                created_by_id=test_user.id,
            )
            db_session.add(so)
            await db_session.flush()
            item = ServiceOrderItem(
                service_order_id=so.id,
                service_id=wp1.id,
                unit_price=wp1.base_price,
                quantity=1,
                used_scrap=scrap,
            )
            db_session.add(item)
            await db_session.flush()
            db_session.add(
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=film_installer.id,
                    service_order_item_id=item.id,
                )
            )
            await db_session.flush()
            return so

        # 9 carros anteriores, 3 no retalho (33% — abaixo do limiar)
        for index in range(9):
            await _completed_os(scrap=index < 3)
        # O carro que fecha o mês em 4/10 = 40%
        last = await _completed_os(scrap=True)
        await db_session.commit()

        await notify_scrap_ratio_if_crossed(db_session, last.id)
        await db_session.commit()

        rows = await db_session.execute(
            select(Notification).where(Notification.user_id == test_owner.id)
        )
        alerts = [n for n in rows.scalars().all() if "retalho" in n.title.lower()]
        assert len(alerts) == 1
        assert film_installer.name in alerts[0].body

        # Não repete no carro seguinte: já estava acima do limiar antes dele
        following = await _completed_os(scrap=True)
        await db_session.commit()
        await notify_scrap_ratio_if_crossed(db_session, following.id)
        await db_session.commit()

        rows = await db_session.execute(
            select(Notification).where(Notification.user_id == test_owner.id)
        )
        alerts = [n for n in rows.scalars().all() if "retalho" in n.title.lower()]
        assert len(alerts) == 1


class TestScrapReviewFixes:
    """Regressão dos achados do code review (🔴2, 🟠3, 🟠4, 🟠5, 🟡13)."""

    @pytest.mark.asyncio
    async def test_finalize_scrap_reverts_pre_attached_roll(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_services,
        film_installer: Employee,
        film_stock,
    ):
        """🔴2: item que já trazia bobina debitada, marcado retalho no finalize,
        estorna o consumo — a bobina volta ao saldo cheio e nada fica debitado."""
        from app.modules.inventory.service import consume_roll

        wp1, _ = film_services
        _, in_use, _ = film_stock
        so = await _make_os(db_session, test_store, test_user, [wp1])
        item = (await _items(db_session, so.id))[0]

        # Simula bobina atribuída a uma O.S. ainda aberta (edição antes de finalizar)
        item.film_roll_id = in_use.id
        await db_session.flush()
        await consume_roll(db_session, in_use.id, item.id, WP1_METERS)
        await db_session.commit()
        await db_session.refresh(in_use)
        assert in_use.remaining_meters == 14.0 - WP1_METERS

        response = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela.jpg"],
                "film_roll_assignments": [{"service_id": wp1.id, "used_scrap": True}],
                "employee_assignments": [{"service_id": wp1.id, "employee_id": film_installer.id}],
            },
        )
        assert response.status_code == 200, response.text

        await db_session.refresh(in_use)
        # Metros estornados: a bobina volta ao saldo cheio
        assert in_use.remaining_meters == 14.0
        items = await _items(db_session, so.id)
        assert items[0].used_scrap is True
        assert items[0].film_roll_id is None
        # A bobina revertida virou origem do retalho (nenhuma foi informada)
        assert items[0].scrap_source_roll_id == in_use.id
        # Não sobra consumo; sobra 1 linha de retalho (0m) na origem
        cons = await _consumptions(db_session, in_use.id)
        assert [c.kind for c in cons] == ["retalho"]
        assert cons[0].meters_consumed == 0.0

    @pytest.mark.asyncio
    async def test_scrap_source_from_other_store_is_rejected(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        second_store: Store,
        test_user: User,
        film_services,
        film_installer: Employee,
        film_stock,
    ):
        """🟠3: bobina de origem de OUTRA loja (sem link) é barrada — C-04 vale
        também para o retalho, senão o extrato de uma loja lista carros de outra."""
        film_type, _, _ = film_stock
        wp1, _ = film_services
        other_roll = FilmRoll(
            store_id=second_store.id,
            film_type_id=film_type.id,
            tonality="G20",
            total_meters=14.0,
            remaining_meters=5.0,
            receipt_date=date(2026, 7, 1),
            status="em_uso",
        )
        db_session.add(other_roll)
        so = await _make_os(db_session, test_store, test_user, [wp1])
        await db_session.refresh(other_roll)

        response = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela.jpg"],
                "film_roll_assignments": [
                    {
                        "service_id": wp1.id,
                        "used_scrap": True,
                        "scrap_source_roll_id": other_roll.id,
                    }
                ],
                "employee_assignments": [{"service_id": wp1.id, "employee_id": film_installer.id}],
            },
        )
        assert response.status_code in (400, 422)
        assert "outra loja" in response.text
        assert await _consumptions(db_session, other_roll.id) == []

    @pytest.mark.asyncio
    async def test_edit_marking_scrap_creates_zero_movement(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_services,
        film_installer: Employee,
        film_stock,
    ):
        """🟠4: marcar retalho na EDIÇÃO (Conferência) estorna E cria a linha de 0m
        na bobina de origem — sem ela o scrap_source vira campo morto na auditoria."""
        wp1, _ = film_services
        _, in_use, exhausted = film_stock
        so = await _make_os(db_session, test_store, test_user, [wp1])

        finalize = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela.jpg"],
                "film_roll_assignments": [{"service_id": wp1.id, "film_roll_id": in_use.id}],
                "employee_assignments": [{"service_id": wp1.id, "employee_id": film_installer.id}],
            },
        )
        assert finalize.status_code == 200, finalize.text
        await db_session.refresh(in_use)
        assert in_use.remaining_meters == 14.0 - WP1_METERS

        # Conferência corrige: era retalho, com origem na bobina esgotada
        edit = await owner_client.patch(
            f"/api/v1/service-orders/{so.id}",
            json={
                "items": [
                    {
                        "service_id": wp1.id,
                        "quantity": 1,
                        "tonality": "G20",
                        "used_scrap": True,
                        "scrap_source_roll_id": exhausted.id,
                    }
                ]
            },
        )
        assert edit.status_code == 200, edit.text

        await db_session.refresh(in_use)
        # Consumo estornado na bobina em uso
        assert in_use.remaining_meters == 14.0
        assert await _consumptions(db_session, in_use.id) == []
        # Linha de 0m criada na bobina de origem
        scrap_rows = await _consumptions(db_session, exhausted.id)
        assert [c.kind for c in scrap_rows] == ["retalho"]
        items = await _items(db_session, so.id)
        assert items[0].used_scrap is True
        assert items[0].scrap_source_roll_id == exhausted.id

    @pytest.mark.asyncio
    async def test_edit_unmarking_scrap_removes_zero_movement(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_services,
        film_installer: Employee,
        film_stock,
    ):
        """🔴1/🟠4: desmarcar retalho na edição remove a linha de 0m (não é latch)."""
        wp1, _ = film_services
        _, _, exhausted = film_stock
        so = await _make_os(db_session, test_store, test_user, [wp1])
        await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela.jpg"],
                "film_roll_assignments": [
                    {"service_id": wp1.id, "used_scrap": True, "scrap_source_roll_id": exhausted.id}
                ],
                "employee_assignments": [{"service_id": wp1.id, "employee_id": film_installer.id}],
            },
        )
        assert len(await _consumptions(db_session, exhausted.id)) == 1

        edit = await owner_client.patch(
            f"/api/v1/service-orders/{so.id}",
            json={
                "items": [
                    {
                        "service_id": wp1.id,
                        "quantity": 1,
                        "tonality": "G20",
                        "used_scrap": False,
                    }
                ]
            },
        )
        assert edit.status_code == 200, edit.text
        items = await _items(db_session, so.id)
        assert items[0].used_scrap is False
        assert items[0].scrap_source_roll_id is None
        assert await _consumptions(db_session, exhausted.id) == []

    @pytest.mark.asyncio
    async def test_multi_tonality_same_tonality_records_single_line(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_services,
        film_installer: Employee,
        film_stock,
    ):
        """🟠5: item com 2 regiões na MESMA tonalidade grava 1 linha de 0m, não 2."""
        wp1, _ = film_services
        _, _, exhausted = film_stock
        so = await _make_os(db_session, test_store, test_user, [])
        item = ServiceOrderItem(
            service_order_id=so.id,
            service_id=wp1.id,
            unit_price=wp1.base_price,
            quantity=1,
            tonality="G20",
            film_applications=[
                {"tonality": "G20", "region": "Laterais"},
                {"tonality": "G20", "region": "Traseiro"},
            ],
        )
        db_session.add(item)
        await db_session.commit()

        response = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela.jpg"],
                "film_roll_assignments": [
                    {
                        "service_id": wp1.id,
                        "tonality": "G20",
                        "used_scrap": True,
                        "scrap_source_roll_id": exhausted.id,
                    }
                ],
                "employee_assignments": [{"service_id": wp1.id, "employee_id": film_installer.id}],
            },
        )
        assert response.status_code == 200, response.text
        scrap_rows = await _consumptions(db_session, exhausted.id)
        assert len(scrap_rows) == 1

    @pytest.mark.asyncio
    async def test_scrap_with_consumed_roll_is_rejected_by_schema(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_services,
        film_installer: Employee,
        film_stock,
    ):
        """🟡13: used_scrap + film_roll_id juntos é estado inválido → 422."""
        wp1, _ = film_services
        _, in_use, _ = film_stock
        so = await _make_os(db_session, test_store, test_user, [wp1])

        response = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela.jpg"],
                "film_roll_assignments": [
                    {"service_id": wp1.id, "used_scrap": True, "film_roll_id": in_use.id}
                ],
                "employee_assignments": [{"service_id": wp1.id, "employee_id": film_installer.id}],
            },
        )
        assert response.status_code == 422
