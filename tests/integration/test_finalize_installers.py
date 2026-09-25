"""
Testes do instalador por serviço na finalização de O.S.

Departamentos de película (film/security_film/ppf) exigem um instalador por
serviço via employee_assignments; clientes legados podem continuar mandando
employee_ids (funcionários da O.S. inteira). O ranking de funcionários passa
a contar serviços feitos (services_count).
"""

from datetime import UTC, datetime

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.employees.models import Employee
from app.modules.service_orders.models import (
    ServiceOrder,
    ServiceOrderItem,
    ServiceOrderWorker,
)
from app.modules.services.models import Service
from app.modules.stores.models import Store

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def film_services(db_session: AsyncSession, test_brand) -> list[Service]:
    """Dois serviços de película."""
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
async def installers(db_session: AsyncSession, test_store: Store) -> list[Employee]:
    """Dois instaladores de película."""
    employees = [
        Employee(
            name="Instalador Um",
            store_id=test_store.id,
            department="film",
            position="Instalador de Película",
            is_active=True,
        ),
        Employee(
            name="Instalador Dois",
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


@pytest_asyncio.fixture
async def film_os(
    db_session: AsyncSession,
    test_store: Store,
    test_user: User,
    film_services: list[Service],
) -> ServiceOrder:
    """O.S. de película em andamento com 2 itens (2 serviços)."""
    so = ServiceOrder(
        store_id=test_store.id,
        vehicle_plate="FIN1A23",
        department="film",
        status="in_progress",
        is_courtesy=False,
        is_galpon=False,
        is_return=False,
        entry_time=datetime(2026, 7, 10, 8, 0, tzinfo=UTC),
        start_time=datetime(2026, 7, 10, 8, 30, tzinfo=UTC),
        created_by_id=test_user.id,
    )
    db_session.add(so)
    await db_session.flush()
    for svc in film_services:
        db_session.add(
            ServiceOrderItem(
                service_order_id=so.id,
                service_id=svc.id,
                unit_price=svc.base_price,
                quantity=1,
            )
        )
    await db_session.commit()
    await db_session.refresh(so)
    return so


@pytest_asyncio.fixture
async def wrong_film_os(
    db_session: AsyncSession,
    test_store: Store,
    test_user: User,
    film_services: list[Service],
) -> ServiceOrder:
    """O.S. de película marcada 'Lançado Errado' (wrong) e NUNCA finalizada.

    Espelha o cenário do Agendamento (ADR 0014): `compute_display_status` trata
    uma O.S. `wrong` não finalizada como `em_execucao` (a fazer) e oferece o
    botão de finalizar — logo a trava do Finalizar precisa aceitá-la.
    """
    so = ServiceOrder(
        store_id=test_store.id,
        vehicle_plate="WRG1A23",
        department="film",
        status="wrong",
        is_courtesy=False,
        is_galpon=False,
        is_return=False,
        entry_time=datetime(2026, 7, 10, 8, 0, tzinfo=UTC),
        start_time=datetime(2026, 7, 10, 8, 30, tzinfo=UTC),
        created_by_id=test_user.id,
    )
    db_session.add(so)
    await db_session.flush()
    for svc in film_services:
        db_session.add(
            ServiceOrderItem(
                service_order_id=so.id,
                service_id=svc.id,
                unit_price=svc.base_price,
                quantity=1,
            )
        )
    await db_session.commit()
    await db_session.refresh(so)
    return so


async def _workers_of(db_session: AsyncSession, service_order_id: int) -> list[ServiceOrderWorker]:
    result = await db_session.execute(
        select(ServiceOrderWorker).where(ServiceOrderWorker.service_order_id == service_order_id)
    )
    return list(result.scalars())


# ---------------------------------------------------------------------------
# Finalize — employee_assignments
# ---------------------------------------------------------------------------


class TestFinalizeValidationNonOwner:
    """#1 — não-Owner precisa de foto da chancela E bobina (película) ao finalizar.
    Owner é isento (limpeza de backlog). O backend passa a enforçar a regra que
    antes só existia no FinalizeOSModal.
    """

    def _assignments(self, film_services, installers):
        return [
            {"service_id": film_services[0].id, "employee_id": installers[0].id},
            {"service_id": film_services[1].id, "employee_id": installers[0].id},
        ]

    @pytest.mark.asyncio
    async def test_nao_owner_sem_foto_da_chancela_falha(
        self,
        authenticated_client: AsyncClient,
        film_os: ServiceOrder,
        film_services: list[Service],
        installers: list[Employee],
    ):
        resp = await authenticated_client.post(
            f"/api/v1/service-orders/{film_os.id}/finalize",
            json={
                "completion_photos": [],
                "film_roll_assignments": [],
                "employee_assignments": self._assignments(film_services, installers),
            },
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_nao_owner_sem_bobina_falha(
        self,
        authenticated_client: AsyncClient,
        film_os: ServiceOrder,
        film_services: list[Service],
        installers: list[Employee],
    ):
        resp = await authenticated_client.post(
            f"/api/v1/service-orders/{film_os.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela1.jpg"],
                "film_roll_assignments": [],
                "employee_assignments": self._assignments(film_services, installers),
            },
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_owner_isento_finaliza_sem_foto_e_sem_bobina(
        self,
        owner_client: AsyncClient,
        film_os: ServiceOrder,
        film_services: list[Service],
        installers: list[Employee],
    ):
        resp = await owner_client.post(
            f"/api/v1/service-orders/{film_os.id}/finalize",
            json={
                "completion_photos": [],
                "film_roll_assignments": [],
                "employee_assignments": self._assignments(film_services, installers),
            },
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "completed"


class TestFinalizeWrongStatus:
    """Uma O.S. `wrong` (Lançado Errado) nunca finalizada é imune ao rótulo no
    Agendamento (ADR 0014): aparece como `em_execucao` e DEVE poder ser
    finalizada. A trava do Finalizar aceita `wrong` junto de in_progress/waiting.
    """

    def _assignments(self, film_services, installers):
        return [
            {"service_id": film_services[0].id, "employee_id": installers[0].id},
            {"service_id": film_services[1].id, "employee_id": installers[0].id},
        ]

    @pytest.mark.asyncio
    async def test_owner_finaliza_os_wrong(
        self,
        owner_client: AsyncClient,
        wrong_film_os: ServiceOrder,
        film_services: list[Service],
        installers: list[Employee],
    ):
        resp = await owner_client.post(
            f"/api/v1/service-orders/{wrong_film_os.id}/finalize",
            json={
                "completion_photos": [],
                "film_roll_assignments": [],
                "employee_assignments": self._assignments(film_services, installers),
            },
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "completed"

    @pytest.mark.asyncio
    async def test_wrong_ja_finalizada_nao_refinaliza(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_services: list[Service],
        installers: list[Employee],
    ):
        """`wrong` COM `completion_time` = já finalizada uma vez → o Agendamento
        a exibe como 'finalizado' (compute_display_status) e é assunto do
        `undo_wrong`, NÃO do Finalizar. A trava tem de recusá-la (422), senão
        abre re-finalização (reescrita de instaladores, reconsumo de bobina)."""
        so = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="WRGFIN1",
            department="film",
            status="wrong",
            is_courtesy=False,
            is_galpon=False,
            is_return=False,
            entry_time=datetime(2026, 7, 10, 8, 0, tzinfo=UTC),
            start_time=datetime(2026, 7, 10, 8, 30, tzinfo=UTC),
            completion_time=datetime(2026, 7, 10, 12, 0, tzinfo=UTC),  # já finalizada antes
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.flush()
        for svc in film_services:
            db_session.add(
                ServiceOrderItem(
                    service_order_id=so.id,
                    service_id=svc.id,
                    unit_price=svc.base_price,
                    quantity=1,
                )
            )
        await db_session.commit()

        resp = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": [],
                "film_roll_assignments": [],
                "employee_assignments": self._assignments(film_services, installers),
            },
        )
        assert resp.status_code == 422


class TestFinalizeEmployeeAssignments:
    @pytest.mark.asyncio
    async def test_finalize_with_assignment_per_service(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        film_os: ServiceOrder,
        film_services: list[Service],
        installers: list[Employee],
    ):
        """Um instalador por serviço cria workers vinculados ao item."""
        response = await owner_client.post(
            f"/api/v1/service-orders/{film_os.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela1.jpg"],
                "film_roll_assignments": [],
                "employee_assignments": [
                    {"service_id": film_services[0].id, "employee_id": installers[0].id},
                    {"service_id": film_services[1].id, "employee_id": installers[1].id},
                ],
            },
        )
        assert response.status_code == 200
        assert response.json()["status"] == "completed"

        workers = await _workers_of(db_session, film_os.id)
        assert len(workers) == 2
        assert all(w.service_order_item_id is not None for w in workers)
        assert {w.employee_id for w in workers} == {installers[0].id, installers[1].id}

    @pytest.mark.asyncio
    async def test_same_installer_on_multiple_services(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        film_os: ServiceOrder,
        film_services: list[Service],
        installers: list[Employee],
    ):
        """O mesmo instalador pode ser escolhido em mais de um serviço."""
        response = await owner_client.post(
            f"/api/v1/service-orders/{film_os.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela1.jpg"],
                "employee_assignments": [
                    {"service_id": film_services[0].id, "employee_id": installers[0].id},
                    {"service_id": film_services[1].id, "employee_id": installers[0].id},
                ],
            },
        )
        assert response.status_code == 200
        workers = await _workers_of(db_session, film_os.id)
        assert len(workers) == 2
        assert all(w.employee_id == installers[0].id for w in workers)

    @pytest.mark.asyncio
    async def test_missing_assignment_for_one_service_fails(
        self,
        owner_client: AsyncClient,
        film_os: ServiceOrder,
        film_services: list[Service],
        installers: list[Employee],
    ):
        """Departamento de película exige instalador em TODOS os serviços."""
        response = await owner_client.post(
            f"/api/v1/service-orders/{film_os.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela1.jpg"],
                "employee_assignments": [
                    {"service_id": film_services[0].id, "employee_id": installers[0].id},
                ],
            },
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_no_installers_at_all_fails_for_film(
        self,
        owner_client: AsyncClient,
        film_os: ServiceOrder,
    ):
        """Película sem nenhum instalador (nem assignments nem legado) → 422."""
        response = await owner_client.post(
            f"/api/v1/service-orders/{film_os.id}/finalize",
            json={"completion_photos": ["/uploads/chancela1.jpg"]},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_legacy_employee_ids_still_accepted(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        film_os: ServiceOrder,
        installers: list[Employee],
    ):
        """Cliente legado (mobile antigo) mandando só employee_ids continua OK."""
        response = await owner_client.post(
            f"/api/v1/service-orders/{film_os.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela1.jpg"],
                "employee_ids": [installers[0].id, installers[1].id],
            },
        )
        assert response.status_code == 200
        workers = await _workers_of(db_session, film_os.id)
        assert len(workers) == 2
        assert all(w.service_order_item_id is None for w in workers)

    @pytest.mark.asyncio
    async def test_assignment_with_unknown_service_fails(
        self,
        owner_client: AsyncClient,
        film_os: ServiceOrder,
        installers: list[Employee],
    ):
        """service_id que não pertence à O.S. → 422."""
        response = await owner_client.post(
            f"/api/v1/service-orders/{film_os.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela1.jpg"],
                "employee_assignments": [
                    {"service_id": 999999, "employee_id": installers[0].id},
                ],
            },
        )
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# Finalize — múltiplos instaladores por serviço
# ---------------------------------------------------------------------------


class TestFinalizeMultipleInstallersPerService:
    @pytest.mark.asyncio
    async def test_two_installers_on_same_service(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        film_os: ServiceOrder,
        film_services: list[Service],
        installers: list[Employee],
    ):
        """employee_ids com 2 instaladores cria 2 workers no MESMO item."""
        response = await owner_client.post(
            f"/api/v1/service-orders/{film_os.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela1.jpg"],
                "employee_assignments": [
                    {
                        "service_id": film_services[0].id,
                        "employee_ids": [installers[0].id, installers[1].id],
                    },
                    {"service_id": film_services[1].id, "employee_id": installers[0].id},
                ],
            },
        )
        assert response.status_code == 200

        workers = await _workers_of(db_session, film_os.id)
        assert len(workers) == 3
        items_by_worker: dict[int, set[int]] = {}
        for w in workers:
            assert w.service_order_item_id is not None
            items_by_worker.setdefault(w.service_order_item_id, set()).add(w.employee_id)
        shared_item = next(emps for emps in items_by_worker.values() if len(emps) == 2)
        assert shared_item == {installers[0].id, installers[1].id}

    @pytest.mark.asyncio
    async def test_repeated_service_id_entries_become_union(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        film_os: ServiceOrder,
        film_services: list[Service],
        installers: list[Employee],
    ):
        """Duas entradas do mesmo service_id viram união (não last-wins)."""
        response = await owner_client.post(
            f"/api/v1/service-orders/{film_os.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela1.jpg"],
                "employee_assignments": [
                    {"service_id": film_services[0].id, "employee_id": installers[0].id},
                    {"service_id": film_services[0].id, "employee_id": installers[1].id},
                    {"service_id": film_services[1].id, "employee_id": installers[1].id},
                ],
            },
        )
        assert response.status_code == 200
        workers = await _workers_of(db_session, film_os.id)
        assert len(workers) == 3

    @pytest.mark.asyncio
    async def test_duplicated_installer_in_same_service_deduped(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        film_os: ServiceOrder,
        film_services: list[Service],
        installers: list[Employee],
    ):
        """O mesmo instalador repetido no mesmo serviço grava só 1 worker."""
        response = await owner_client.post(
            f"/api/v1/service-orders/{film_os.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela1.jpg"],
                "employee_assignments": [
                    {
                        "service_id": film_services[0].id,
                        "employee_ids": [installers[0].id, installers[0].id],
                    },
                    {"service_id": film_services[1].id, "employee_id": installers[1].id},
                ],
            },
        )
        assert response.status_code == 200
        workers = await _workers_of(db_session, film_os.id)
        assert len(workers) == 2

    @pytest.mark.asyncio
    async def test_empty_assignment_fails(
        self,
        owner_client: AsyncClient,
        film_os: ServiceOrder,
        film_services: list[Service],
    ):
        """Assignment sem employee_id nem employee_ids → 422."""
        response = await owner_client.post(
            f"/api/v1/service-orders/{film_os.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela1.jpg"],
                "employee_assignments": [
                    {"service_id": film_services[0].id, "employee_ids": []},
                ],
            },
        )
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# Ranking — serviços feitos por instalador
# ---------------------------------------------------------------------------


class TestEmployeesRankingServicesCount:
    @pytest.mark.asyncio
    async def test_services_count_per_item_and_legacy(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_user: User,
        film_services: list[Service],
        installers: list[Employee],
        film_os: ServiceOrder,
    ):
        """
        Instalador 1: 2 serviços no mesmo carro (vinculados a item) → services_count=2.
        Instalador 2: 1 registro legado (sem item) em outra O.S. → services_count=1.
        """
        from app.modules.analytics.service import get_employees_ranking

        items = list(
            (
                await db_session.execute(
                    select(ServiceOrderItem).where(ServiceOrderItem.service_order_id == film_os.id)
                )
            ).scalars()
        )
        assert len(items) == 2
        db_session.add_all(
            [
                ServiceOrderWorker(
                    service_order_id=film_os.id,
                    employee_id=installers[0].id,
                    service_order_item_id=items[0].id,
                ),
                ServiceOrderWorker(
                    service_order_id=film_os.id,
                    employee_id=installers[0].id,
                    service_order_item_id=items[1].id,
                ),
            ]
        )
        # Ranking só conta O.S. finalizada (régua do Desempenho): finaliza a O.S.
        film_os.status = "completed"
        film_os.completion_time = datetime(2026, 7, 10, 12, 0, tzinfo=UTC)
        db_session.add(film_os)

        # O.S. legada: worker sem item (= trabalhou na O.S. inteira). Precisa de
        # 1 item para o legado contar 1 serviço sob a régua do Desempenho.
        legacy_os = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="LEG1A01",
            department="film",
            status="completed",
            is_courtesy=False,
            is_galpon=False,
            is_return=False,
            entry_time=datetime(2026, 7, 11, 9, 0, tzinfo=UTC),
            completion_time=datetime(2026, 7, 11, 12, 0, tzinfo=UTC),
            created_by_id=test_user.id,
        )
        db_session.add(legacy_os)
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=legacy_os.id,
                service_id=film_services[0].id,
                unit_price=film_services[0].base_price,
                quantity=1,
            )
        )
        db_session.add(
            ServiceOrderWorker(
                service_order_id=legacy_os.id,
                employee_id=installers[1].id,
            )
        )
        await db_session.commit()

        ranking = await get_employees_ranking(
            db_session,
            test_owner,
            start_date=datetime(2026, 7, 1, tzinfo=UTC),
            end_date=datetime(2026, 7, 31, tzinfo=UTC),
        )
        by_id = {r.employee_id: r for r in ranking}

        inst1 = by_id[installers[0].id]
        assert inst1.services_count == 2
        assert inst1.orders_count == 1  # mesmo carro

        inst2 = by_id[installers[1].id]
        assert inst2.services_count == 1
        assert inst2.orders_count == 1

        # Ordenação por serviços: instalador 1 vem antes
        ids_in_order = [r.employee_id for r in ranking]
        assert ids_in_order.index(installers[0].id) < ids_in_order.index(installers[1].id)

    @pytest.mark.asyncio
    async def test_shared_item_splits_revenue_and_count(
        self,
        db_session: AsyncSession,
        test_owner: User,
        film_services: list[Service],
        installers: list[Employee],
        film_os: ServiceOrder,
    ):
        """
        Item de R$400 feito por 2 instaladores → R$200 e 0,5 serviço para cada
        (produção dividida, sem inflar o total).
        """
        from app.modules.analytics.service import get_employees_ranking

        items = list(
            (
                await db_session.execute(
                    select(ServiceOrderItem)
                    .where(ServiceOrderItem.service_order_id == film_os.id)
                    .order_by(ServiceOrderItem.id)
                )
            ).scalars()
        )
        # Ambos os instaladores no item de R$400 (compartilhado)
        db_session.add_all(
            [
                ServiceOrderWorker(
                    service_order_id=film_os.id,
                    employee_id=installers[0].id,
                    service_order_item_id=items[0].id,
                ),
                ServiceOrderWorker(
                    service_order_id=film_os.id,
                    employee_id=installers[1].id,
                    service_order_item_id=items[0].id,
                ),
                # Item de R$600 só do instalador 1
                ServiceOrderWorker(
                    service_order_id=film_os.id,
                    employee_id=installers[0].id,
                    service_order_item_id=items[1].id,
                ),
            ]
        )
        # Ranking só conta O.S. finalizada (régua do Desempenho): finaliza a O.S.
        film_os.status = "completed"
        film_os.completion_time = datetime(2026, 7, 10, 12, 0, tzinfo=UTC)
        db_session.add(film_os)
        await db_session.commit()

        ranking = await get_employees_ranking(
            db_session,
            test_owner,
            start_date=datetime(2026, 7, 1, tzinfo=UTC),
            end_date=datetime(2026, 7, 31, tzinfo=UTC),
        )
        by_id = {r.employee_id: r for r in ranking}

        inst1 = by_id[installers[0].id]
        inst2 = by_id[installers[1].id]
        # Instalador 1: 400/2 + 600 = 800; 0,5 + 1 = 1,5 serviços
        assert inst1.revenue == pytest.approx(800.0)
        assert inst1.services_count == pytest.approx(1.5)
        # Instalador 2: 400/2 = 200; 0,5 serviço
        assert inst2.revenue == pytest.approx(200.0)
        assert inst2.services_count == pytest.approx(0.5)
        # Soma dos dois == total da O.S. (nada infla)
        assert inst1.revenue + inst2.revenue == pytest.approx(1000.0)
