"""
Testes do módulo Desempenho de Instaladores — divisão igual de produção.

Serviço feito por K instaladores conta valor/K e 1/K serviço para cada um
(centavos de resto vão para os menores employee_id). Vínculo legado (item
None) equivale a ter trabalhado em todos os itens da O.S.
"""

from datetime import UTC, datetime
from decimal import Decimal

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.employees.models import Employee
from app.modules.installer_performance.service import (
    get_daily_report,
    get_individual_report,
)
from app.modules.service_orders.models import (
    ServiceOrder,
    ServiceOrderItem,
    ServiceOrderWorker,
)
from app.modules.services.models import Service
from app.modules.stores.models import Store

REPORT_DAY = datetime(2026, 7, 10, 15, 0, tzinfo=UTC)  # 12:00 no fuso local


@pytest_asyncio.fixture
async def perf_services(db_session: AsyncSession, test_brand) -> list[Service]:
    services = [
        Service(
            name="Película lateral",
            department="film",
            base_price=400.00,
            is_active=True,
            brand_id=test_brand.id,
        ),
        Service(
            name="Película parabrisa",
            department="film",
            base_price=600.00,
            is_active=True,
            brand_id=test_brand.id,
        ),
    ]
    db_session.add_all(services)
    await db_session.commit()
    for s in services:
        await db_session.refresh(s)
    return services


@pytest_asyncio.fixture
async def perf_installers(db_session: AsyncSession, test_store: Store) -> list[Employee]:
    employees = [
        Employee(
            name="Perf Instalador Um",
            store_id=test_store.id,
            department="film",
            position="Instalador de Película",
            is_active=True,
        ),
        Employee(
            name="Perf Instalador Dois",
            store_id=test_store.id,
            department="film",
            position="Instalador de Película",
            is_active=True,
        ),
        Employee(
            name="Perf Instalador Três",
            store_id=test_store.id,
            department="film",
            position="Instalador de Película",
            is_active=True,
        ),
    ]
    db_session.add_all(employees)
    await db_session.commit()
    for e in employees:
        await db_session.refresh(e)
    return employees


async def _completed_os(
    db_session: AsyncSession,
    store: Store,
    user: User,
    services: list[Service],
    prices: list[Decimal | float],
    plate: str = "PRF1A23",
    is_courtesy: bool = False,
    is_return: bool = False,
) -> tuple[ServiceOrder, list[ServiceOrderItem]]:
    """O.S. finalizada no dia do relatório com 1 item por preço informado."""
    so = ServiceOrder(
        store_id=store.id,
        vehicle_plate=plate,
        department="film",
        status="completed",
        is_courtesy=is_courtesy,
        is_galpon=False,
        is_return=is_return,
        entry_time=datetime(2026, 7, 10, 8, 0, tzinfo=UTC),
        start_time=datetime(2026, 7, 10, 8, 30, tzinfo=UTC),
        completion_time=REPORT_DAY,
        created_by_id=user.id,
    )
    db_session.add(so)
    await db_session.flush()
    items: list[ServiceOrderItem] = []
    for svc, price in zip(services, prices, strict=True):
        item = ServiceOrderItem(
            service_order_id=so.id,
            service_id=svc.id,
            unit_price=Decimal(str(price)),
            quantity=1,
        )
        db_session.add(item)
        items.append(item)
    await db_session.commit()
    await db_session.refresh(so)
    for item in items:
        await db_session.refresh(item)
    return so, items


class TestSharedItemSplit:
    @pytest.mark.asyncio
    async def test_daily_report_splits_shared_item(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_user: User,
        perf_services: list[Service],
        perf_installers: list[Employee],
    ):
        """Item de R$400 com 2 instaladores → R$200 cada; soma == total da O.S."""
        so, items = await _completed_os(
            db_session, test_store, test_user, perf_services, [400, 600]
        )
        db_session.add_all(
            [
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[0].id,
                    service_order_item_id=items[0].id,
                ),
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[1].id,
                    service_order_item_id=items[0].id,
                ),
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[0].id,
                    service_order_item_id=items[1].id,
                ),
            ]
        )
        await db_session.commit()

        report = await get_daily_report(db_session, test_owner, REPORT_DAY.date())
        by_id = {g.employee_id: g for g in report.groups}

        g1 = by_id[perf_installers[0].id]
        g2 = by_id[perf_installers[1].id]
        assert g1.total_revenue == pytest.approx(800.0)  # 400/2 + 600
        assert g2.total_revenue == pytest.approx(200.0)  # 400/2
        assert report.grand_total_revenue == pytest.approx(1000.0)

        # Badge e label do serviço compartilhado
        assert g2.vehicles[0].has_shared is True
        assert any("(÷2)" in s for s in g2.vehicles[0].services)

    @pytest.mark.asyncio
    async def test_rounding_rest_cents_to_lowest_employee_id(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_user: User,
        perf_services: list[Service],
        perf_installers: list[Employee],
    ):
        """R$100,01 ÷ 2 → R$50,01 (menor employee_id) + R$50,00; soma exata."""
        so, items = await _completed_os(
            db_session, test_store, test_user, perf_services[:1], ["100.01"]
        )
        db_session.add_all(
            [
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[0].id,
                    service_order_item_id=items[0].id,
                ),
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[1].id,
                    service_order_item_id=items[0].id,
                ),
            ]
        )
        await db_session.commit()

        report = await get_daily_report(db_session, test_owner, REPORT_DAY.date())
        by_id = {g.employee_id: g for g in report.groups}
        first = min(perf_installers[0].id, perf_installers[1].id)
        second = max(perf_installers[0].id, perf_installers[1].id)
        assert by_id[first].total_revenue == pytest.approx(50.01)
        assert by_id[second].total_revenue == pytest.approx(50.00)
        assert report.grand_total_revenue == pytest.approx(100.01)

    @pytest.mark.asyncio
    async def test_individual_report_fractional_services(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_user: User,
        perf_services: list[Service],
        perf_installers: list[Employee],
    ):
        """Serviço compartilhado conta 0,5 no total de serviços do individual."""
        so, items = await _completed_os(
            db_session, test_store, test_user, perf_services, [400, 600]
        )
        db_session.add_all(
            [
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[0].id,
                    service_order_item_id=items[0].id,
                ),
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[1].id,
                    service_order_item_id=items[0].id,
                ),
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[0].id,
                    service_order_item_id=items[1].id,
                ),
            ]
        )
        await db_session.commit()

        report = await get_individual_report(
            db_session,
            test_owner,
            REPORT_DAY.date(),
            REPORT_DAY.date(),
            perf_installers[0].id,
        )
        assert report.total_services == pytest.approx(1.5)  # 0,5 + 1
        assert report.total_revenue == pytest.approx(800.0)
        assert report.rows[0].has_shared is True

    @pytest.mark.asyncio
    async def test_mixed_legacy_and_per_item_workers(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_user: User,
        perf_services: list[Service],
        perf_installers: list[Employee],
    ):
        """Legado (O.S. inteira) + 2 por item no mesmo item → K=3, um terço cada."""
        so, items = await _completed_os(db_session, test_store, test_user, perf_services[:1], [300])
        db_session.add_all(
            [
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[0].id,
                    service_order_item_id=items[0].id,
                ),
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[1].id,
                    service_order_item_id=items[0].id,
                ),
                # Legado: trabalhou na O.S. inteira
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[2].id,
                ),
            ]
        )
        await db_session.commit()

        report = await get_daily_report(db_session, test_owner, REPORT_DAY.date())
        by_id = {g.employee_id: g for g in report.groups}
        assert by_id[perf_installers[0].id].total_revenue == pytest.approx(100.0)
        assert by_id[perf_installers[1].id].total_revenue == pytest.approx(100.0)
        assert by_id[perf_installers[2].id].total_revenue == pytest.approx(100.0)
        assert report.grand_total_revenue == pytest.approx(300.0)

    @pytest.mark.asyncio
    async def test_courtesy_shared_counts_but_worth_zero(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_user: User,
        perf_services: list[Service],
        perf_installers: list[Employee],
    ):
        """Cortesia compartilhada: 0,5 serviço para cada, valor R$0."""
        so, items = await _completed_os(
            db_session,
            test_store,
            test_user,
            perf_services[:1],
            [250],
            is_courtesy=True,
        )
        db_session.add_all(
            [
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[0].id,
                    service_order_item_id=items[0].id,
                ),
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[1].id,
                    service_order_item_id=items[0].id,
                ),
            ]
        )
        await db_session.commit()

        report = await get_individual_report(
            db_session,
            test_owner,
            REPORT_DAY.date(),
            REPORT_DAY.date(),
            perf_installers[0].id,
        )
        assert report.total_services == pytest.approx(0.5)
        assert report.total_revenue == pytest.approx(0.0)

    @pytest.mark.asyncio
    async def test_return_counts_but_worth_zero(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_user: User,
        perf_services: list[Service],
        perf_installers: list[Employee],
    ):
        """Retorno (is_return): serviço conta, mas não é cobrado (R$0) — diário e individual."""
        so, items = await _completed_os(
            db_session,
            test_store,
            test_user,
            perf_services[:1],
            [2100],
            is_return=True,
        )
        db_session.add(
            ServiceOrderWorker(
                service_order_id=so.id,
                employee_id=perf_installers[0].id,
                service_order_item_id=items[0].id,
            )
        )
        await db_session.commit()

        daily = await get_daily_report(db_session, test_owner, REPORT_DAY.date())
        g = {grp.employee_id: grp for grp in daily.groups}[perf_installers[0].id]
        assert g.total_cars == 1
        assert g.total_revenue == pytest.approx(0.0)
        assert g.vehicles[0].is_return is True
        assert g.vehicles[0].value == pytest.approx(0.0)
        assert daily.grand_total_revenue == pytest.approx(0.0)

        individual = await get_individual_report(
            db_session,
            test_owner,
            REPORT_DAY.date(),
            REPORT_DAY.date(),
            perf_installers[0].id,
        )
        assert individual.total_cars == 1
        assert individual.total_services == pytest.approx(1.0)
        assert individual.total_revenue == pytest.approx(0.0)
        assert individual.rows[0].is_return is True

    @pytest.mark.asyncio
    async def test_same_plate_counts_as_one_car(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_user: User,
        perf_services: list[Service],
        perf_installers: list[Employee],
    ):
        """Duas O.S. distintas da mesma placa (O.S. dividida por serviço nas migrações)
        contam como 1 carro; a receita continua sendo a soma das duas."""
        so1, items1 = await _completed_os(
            db_session, test_store, test_user, perf_services[:1], [225], plate="VKO03714"
        )
        so2, items2 = await _completed_os(
            db_session, test_store, test_user, perf_services[1:2], [150], plate="VKO03714"
        )
        db_session.add_all(
            [
                ServiceOrderWorker(
                    service_order_id=so1.id,
                    employee_id=perf_installers[0].id,
                    service_order_item_id=items1[0].id,
                ),
                ServiceOrderWorker(
                    service_order_id=so2.id,
                    employee_id=perf_installers[0].id,
                    service_order_item_id=items2[0].id,
                ),
            ]
        )
        await db_session.commit()

        daily = await get_daily_report(db_session, test_owner, REPORT_DAY.date())
        g = {grp.employee_id: grp for grp in daily.groups}[perf_installers[0].id]
        assert len(g.vehicles) == 2  # as duas linhas continuam na listagem
        assert g.total_cars == 1  # mas contam como 1 carro (mesma placa)
        assert g.total_revenue == pytest.approx(375.0)

        individual = await get_individual_report(
            db_session,
            test_owner,
            REPORT_DAY.date(),
            REPORT_DAY.date(),
            perf_installers[0].id,
        )
        assert len(individual.rows) == 2
        assert individual.total_cars == 1
        assert individual.total_revenue == pytest.approx(375.0)

    @pytest.mark.asyncio
    async def test_distinct_plates_count_separately(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_user: User,
        perf_services: list[Service],
        perf_installers: list[Employee],
    ):
        """Placas diferentes contam como carros distintos."""
        so1, items1 = await _completed_os(
            db_session, test_store, test_user, perf_services[:1], [200], plate="AAA1A11"
        )
        so2, items2 = await _completed_os(
            db_session, test_store, test_user, perf_services[:1], [200], plate="BBB2B22"
        )
        db_session.add_all(
            [
                ServiceOrderWorker(
                    service_order_id=so1.id,
                    employee_id=perf_installers[0].id,
                    service_order_item_id=items1[0].id,
                ),
                ServiceOrderWorker(
                    service_order_id=so2.id,
                    employee_id=perf_installers[0].id,
                    service_order_item_id=items2[0].id,
                ),
            ]
        )
        await db_session.commit()

        daily = await get_daily_report(db_session, test_owner, REPORT_DAY.date())
        g = {grp.employee_id: grp for grp in daily.groups}[perf_installers[0].id]
        assert g.total_cars == 2


class TestUpdatePreservesItemLink:
    @pytest.mark.asyncio
    async def test_update_with_same_workers_keeps_item_link(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        perf_services: list[Service],
        perf_installers: list[Employee],
    ):
        """Salvar a O.S. sem mudar instaladores preserva o vínculo por serviço."""
        so, items = await _completed_os(db_session, test_store, test_user, perf_services[:1], [400])
        db_session.add(
            ServiceOrderWorker(
                service_order_id=so.id,
                employee_id=perf_installers[0].id,
                service_order_item_id=items[0].id,
            )
        )
        await db_session.commit()

        response = await owner_client.patch(
            f"/api/v1/service-orders/{so.id}",
            json={
                "notes": "Ajuste de observação sem mexer em instalador",
                "workers": [{"employee_id": perf_installers[0].id}],
            },
        )
        assert response.status_code == 200

        workers = list(
            (
                await db_session.execute(
                    select(ServiceOrderWorker).where(ServiceOrderWorker.service_order_id == so.id)
                )
            ).scalars()
        )
        assert len(workers) == 1
        assert workers[0].service_order_item_id == items[0].id

    @pytest.mark.asyncio
    async def test_update_with_changed_workers_replaces(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        perf_services: list[Service],
        perf_installers: list[Employee],
    ):
        """Trocar o instalador na edição substitui os workers (vira legado)."""
        so, items = await _completed_os(db_session, test_store, test_user, perf_services[:1], [400])
        db_session.add(
            ServiceOrderWorker(
                service_order_id=so.id,
                employee_id=perf_installers[0].id,
                service_order_item_id=items[0].id,
            )
        )
        await db_session.commit()

        response = await owner_client.patch(
            f"/api/v1/service-orders/{so.id}",
            json={"workers": [{"employee_id": perf_installers[1].id}]},
        )
        assert response.status_code == 200

        workers = list(
            (
                await db_session.execute(
                    select(ServiceOrderWorker).where(ServiceOrderWorker.service_order_id == so.id)
                )
            ).scalars()
        )
        assert len(workers) == 1
        assert workers[0].employee_id == perf_installers[1].id
        assert workers[0].service_order_item_id is None


class TestIndividualPoints:
    @pytest.mark.asyncio
    async def test_points_fractioned_between_installers(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_user: User,
        perf_services: list[Service],
        perf_installers: list[Employee],
    ):
        """Serviço de 1,00 ponto com 2 instaladores → 0,5 ponto para cada."""
        perf_services[0].points = Decimal("1.00")
        perf_services[1].points = Decimal("2.00")
        await db_session.commit()
        so, items = await _completed_os(
            db_session, test_store, test_user, perf_services, [400, 600]
        )
        db_session.add_all(
            [
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[0].id,
                    service_order_item_id=items[0].id,
                ),
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[1].id,
                    service_order_item_id=items[0].id,
                ),
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[0].id,
                    service_order_item_id=items[1].id,
                ),
            ]
        )
        await db_session.commit()

        rep1 = await get_individual_report(
            db_session, test_owner, REPORT_DAY.date(), REPORT_DAY.date(), perf_installers[0].id
        )
        # instalador 0: 1,00/2 (item0) + 2,00 (item1) = 2,5
        assert rep1.total_points == pytest.approx(2.5)
        assert len(rep1.rows) == 1
        assert rep1.rows[0].points == pytest.approx(2.5)

    @pytest.mark.asyncio
    async def test_return_os_still_scores_points(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_user: User,
        perf_services: list[Service],
        perf_installers: list[Employee],
    ):
        """O.S. de retorno pontua mas fatura R$ 0."""
        perf_services[0].points = Decimal("3.00")
        await db_session.commit()
        so, items = await _completed_os(
            db_session, test_store, test_user, perf_services[:1], [400], is_return=True
        )
        db_session.add(
            ServiceOrderWorker(
                service_order_id=so.id,
                employee_id=perf_installers[0].id,
                service_order_item_id=items[0].id,
            )
        )
        await db_session.commit()

        rep = await get_individual_report(
            db_session, test_owner, REPORT_DAY.date(), REPORT_DAY.date(), perf_installers[0].id
        )
        assert rep.total_points == pytest.approx(3.0)
        assert rep.total_revenue == pytest.approx(0.0)
