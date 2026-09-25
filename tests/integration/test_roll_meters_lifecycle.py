"""
Ciclo de vida dos metros da bobina em edição e cancelamento de O.S.

- Editar uma O.S. recria os itens (DELETE + INSERT) e a FK do consumo é
  ON DELETE SET NULL. O fix re-vincula o consumo ao item novo do mesmo serviço,
  evitando órfãos ("—" no histórico da bobina).
- Cancelar uma O.S. finalizada estorna os metros consumidos de volta à bobina.
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

METERS = 6.0


@pytest_asyncio.fixture
async def film_service(db_session: AsyncSession, test_brand) -> Service:
    service = Service(
        name="Película Lateral Ciclo",
        code="WPLC",
        department="film",
        base_price=500.0,
        is_active=True,
        brand_id=test_brand.id,
    )
    db_session.add(service)
    await db_session.commit()
    await db_session.refresh(service)
    return service


@pytest_asyncio.fixture
async def film_installer(db_session: AsyncSession, test_store: Store) -> Employee:
    emp = Employee(
        name="Instalador Ciclo",
        store_id=test_store.id,
        department="film",
        position="Instalador de Película",
        is_active=True,
    )
    db_session.add(emp)
    await db_session.commit()
    await db_session.refresh(emp)
    return emp


@pytest_asyncio.fixture
async def film_roll(db_session: AsyncSession, test_store: Store, film_service: Service) -> FilmRoll:
    ft = FilmType(name="Poliester Ciclo", department="film", available_tonalities=["G20"])
    db_session.add(ft)
    await db_session.flush()
    db_session.add(
        FilmTypeService(film_type_id=ft.id, service_id=film_service.id, meters_consumed=METERS)
    )
    roll = FilmRoll(
        store_id=test_store.id,
        film_type_id=ft.id,
        tonality="G20",
        total_meters=30.0,
        remaining_meters=30.0,
        receipt_date=date(2026, 7, 1),
        status="em_uso",
    )
    db_session.add(roll)
    await db_session.commit()
    await db_session.refresh(roll)
    return roll


async def _make_and_finalize(
    db_session: AsyncSession,
    owner_client: AsyncClient,
    store: Store,
    user: User,
    service: Service,
    installer: Employee,
    roll: FilmRoll,
) -> ServiceOrder:
    so = ServiceOrder(
        store_id=store.id,
        vehicle_plate="CIC1A23",
        department="film",
        status="in_progress",
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
    )
    db_session.add(item)
    await db_session.commit()
    await db_session.refresh(so)

    resp = await owner_client.post(
        f"/api/v1/service-orders/{so.id}/finalize",
        json={
            "completion_photos": ["/uploads/chancela.jpg"],
            "film_roll_assignments": [{"service_id": service.id, "film_roll_id": roll.id}],
            "employee_assignments": [{"service_id": service.id, "employee_id": installer.id}],
        },
    )
    assert resp.status_code == 200, resp.text
    return so


@pytest_asyncio.fixture
async def film_roll_b(db_session: AsyncSession, test_store: Store, film_roll: FilmRoll) -> FilmRoll:
    """Segunda bobina do MESMO tipo de película (destino da troca)."""
    roll = FilmRoll(
        store_id=test_store.id,
        film_type_id=film_roll.film_type_id,
        tonality="G20",
        total_meters=30.0,
        remaining_meters=30.0,
        receipt_date=date(2026, 7, 2),
        status="em_uso",
    )
    db_session.add(roll)
    await db_session.commit()
    await db_session.refresh(roll)
    return roll


class TestSwapRollCleansOldHistory:
    @pytest.mark.asyncio
    async def test_swap_removes_old_roll_trace(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_service: Service,
        film_installer: Employee,
        film_roll: FilmRoll,
        film_roll_b: FilmRoll,
    ):
        """Trocar a bobina do carro deixa a bobina ANTIGA sem rastro (nem +Xm, nem -Xm)
        e com os metros restaurados; a NOVA recebe o consumo linkado ao item."""
        so = await _make_and_finalize(
            db_session, owner_client, test_store, test_user, film_service, film_installer, film_roll
        )
        await db_session.refresh(film_roll)
        assert film_roll.remaining_meters == pytest.approx(30.0 - METERS)

        # Edita trocando a bobina A -> B
        resp = await owner_client.patch(
            f"/api/v1/service-orders/{so.id}",
            json={
                "items": [
                    {"service_id": film_service.id, "film_roll_id": film_roll_b.id, "quantity": 1}
                ]
            },
        )
        assert resp.status_code == 200, resp.text

        # Bobina ANTIGA: sem NENHUMA linha de consumo e metros restaurados
        rows_a = (
            await db_session.execute(
                select(FilmConsumption.id, FilmConsumption.meters_consumed).where(
                    FilmConsumption.film_roll_id == film_roll.id
                )
            )
        ).all()
        assert rows_a == [], f"bobina antiga ainda tem rastro: {rows_a}"
        await db_session.refresh(film_roll)
        assert film_roll.remaining_meters == pytest.approx(30.0)

        # Bobina NOVA: exatamente uma linha +METERS linkada a um item
        rows_b = (
            await db_session.execute(
                select(
                    FilmConsumption.meters_consumed, FilmConsumption.service_order_item_id
                ).where(FilmConsumption.film_roll_id == film_roll_b.id)
            )
        ).all()
        assert len(rows_b) == 1, rows_b
        assert rows_b[0][0] == pytest.approx(METERS)
        assert rows_b[0][1] is not None
        await db_session.refresh(film_roll_b)
        assert film_roll_b.remaining_meters == pytest.approx(30.0 - METERS)

        # Histórico (endpoint) da bobina antiga não retorna o carro
        hist = await owner_client.get(f"/api/v1/inventory/rolls/{film_roll.id}/consumptions")
        assert hist.status_code == 200, hist.text
        assert hist.json() == []

    @pytest.mark.asyncio
    async def test_remove_film_cleans_old_roll(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_service: Service,
        film_installer: Employee,
        film_roll: FilmRoll,
    ):
        """Remover a bobina do serviço (item sem film_roll_id) limpa a bobina e restaura metros."""
        so = await _make_and_finalize(
            db_session, owner_client, test_store, test_user, film_service, film_installer, film_roll
        )

        resp = await owner_client.patch(
            f"/api/v1/service-orders/{so.id}",
            json={"items": [{"service_id": film_service.id, "quantity": 1}]},
        )
        assert resp.status_code == 200, resp.text

        rows_a = (
            await db_session.execute(
                select(FilmConsumption.id).where(FilmConsumption.film_roll_id == film_roll.id)
            )
        ).all()
        assert rows_a == [], f"bobina ainda tem rastro após remoção: {rows_a}"
        await db_session.refresh(film_roll)
        assert film_roll.remaining_meters == pytest.approx(30.0)


class TestConsumptionHistoryDateFollowsOS:
    """Corrigir a bobina de uma O.S. finalizada não deve datar o histórico no dia
    da correção: a 'Data' do extrato segue a finalização da O.S. (completion_time)."""

    @pytest.mark.asyncio
    async def test_history_date_is_os_completion_not_correction(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_service: Service,
        film_installer: Employee,
        film_roll: FilmRoll,
        film_roll_b: FilmRoll,
    ):
        so = await _make_and_finalize(
            db_session, owner_client, test_store, test_user, film_service, film_installer, film_roll
        )

        # Simula O.S. finalizada num dia passado (bobina errada lançada lá atrás).
        past = datetime(2026, 7, 10, 14, 0, tzinfo=UTC)
        so_db = (
            await db_session.execute(select(ServiceOrder).where(ServiceOrder.id == so.id))
        ).scalar_one()
        so_db.completion_time = past
        await db_session.commit()

        # Corrige HOJE: troca a bobina A -> B (cria consumo novo na B com created_at=agora).
        resp = await owner_client.patch(
            f"/api/v1/service-orders/{so.id}",
            json={
                "items": [
                    {"service_id": film_service.id, "film_roll_id": film_roll_b.id, "quantity": 1}
                ]
            },
        )
        assert resp.status_code == 200, resp.text

        hist = await owner_client.get(f"/api/v1/inventory/rolls/{film_roll_b.id}/consumptions")
        assert hist.status_code == 200, hist.text
        rows = hist.json()
        assert len(rows) == 1, rows
        # A data exibida segue a finalização da O.S. (2026-07-10), não a data da correção.
        assert rows[0]["created_at"].startswith("2026-07-10"), rows[0]["created_at"]

    @pytest.mark.asyncio
    async def test_history_multiline_ordered_by_effective_date(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_service: Service,
        film_installer: Employee,
        film_roll: FilmRoll,
        film_roll_b: FilmRoll,
    ):
        """Numa bobina com várias linhas, a ordem 'mais recente primeiro' segue a data
        EXIBIDA (completion_time), não a de inserção — senão a correção retroativa (linha
        nova hoje, datada no passado) apareceria no topo com data antiga."""
        # O.S. #1: finalizada na bobina ERRADA (A) em 2026-07-10.
        so1 = await _make_and_finalize(
            db_session, owner_client, test_store, test_user, film_service, film_installer, film_roll
        )
        so1_db = (
            await db_session.execute(select(ServiceOrder).where(ServiceOrder.id == so1.id))
        ).scalar_one()
        so1_db.completion_time = datetime(2026, 7, 10, 14, 0, tzinfo=UTC)
        await db_session.commit()

        # O.S. #2: já finalizada corretamente na bobina B em 2026-08-15 (mais recente).
        so2 = await _make_and_finalize(
            db_session,
            owner_client,
            test_store,
            test_user,
            film_service,
            film_installer,
            film_roll_b,
        )
        so2_db = (
            await db_session.execute(select(ServiceOrder).where(ServiceOrder.id == so2.id))
        ).scalar_one()
        so2_db.completion_time = datetime(2026, 8, 15, 14, 0, tzinfo=UTC)
        await db_session.commit()

        # Corrige HOJE a O.S. #1: troca A -> B (linha nova na B, created_at=agora).
        resp = await owner_client.patch(
            f"/api/v1/service-orders/{so1.id}",
            json={
                "items": [
                    {"service_id": film_service.id, "film_roll_id": film_roll_b.id, "quantity": 1}
                ]
            },
        )
        assert resp.status_code == 200, resp.text

        hist = await owner_client.get(f"/api/v1/inventory/rolls/{film_roll_b.id}/consumptions")
        assert hist.status_code == 200, hist.text
        rows = hist.json()
        assert len(rows) == 2, rows
        # Ordenado pela data efetiva: 2026-08-15 (O.S. #2) antes de 2026-07-10 (correção).
        assert rows[0]["created_at"].startswith("2026-08-15"), rows
        assert rows[1]["created_at"].startswith("2026-07-10"), rows


class TestCancelReleasesMeters:
    @pytest.mark.asyncio
    async def test_cancel_finalized_os_returns_meters(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_service: Service,
        film_installer: Employee,
        film_roll: FilmRoll,
    ):
        """Cancelar O.S. finalizada devolve os metros consumidos à bobina."""
        so = await _make_and_finalize(
            db_session, owner_client, test_store, test_user, film_service, film_installer, film_roll
        )
        await db_session.refresh(film_roll)
        assert film_roll.remaining_meters == pytest.approx(30.0 - METERS)

        resp = await owner_client.delete(f"/api/v1/service-orders/{so.id}")
        assert resp.status_code == 200, resp.text

        await db_session.refresh(film_roll)
        assert film_roll.remaining_meters == pytest.approx(30.0)


class TestEditPreservesConsumptionLink:
    @pytest.mark.asyncio
    async def test_edit_does_not_orphan_consumption(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_service: Service,
        film_installer: Employee,
        film_roll: FilmRoll,
    ):
        """Editar a O.S. (recria itens) mantém o consumo vinculado a um item (não orfana)."""
        so = await _make_and_finalize(
            db_session, owner_client, test_store, test_user, film_service, film_installer, film_roll
        )

        # Seleção por colunas (Row tuples) evita lazy-load do ORM em contexto sync
        before = (
            await db_session.execute(
                select(FilmConsumption.id, FilmConsumption.service_order_item_id).where(
                    FilmConsumption.film_roll_id == film_roll.id
                )
            )
        ).all()
        assert before, "finalize deveria ter gerado consumo"
        assert all(soi is not None for _cid, soi in before)

        # Edita reenviando o mesmo serviço/bobina — o backend apaga e recria os itens
        resp = await owner_client.patch(
            f"/api/v1/service-orders/{so.id}",
            json={
                "items": [
                    {"service_id": film_service.id, "film_roll_id": film_roll.id, "quantity": 1}
                ]
            },
        )
        assert resp.status_code == 200, resp.text

        after = (
            await db_session.execute(
                select(FilmConsumption.id, FilmConsumption.service_order_item_id).where(
                    FilmConsumption.film_roll_id == film_roll.id
                )
            )
        ).all()
        assert after, "consumo sumiu após a edição"
        assert all(soi is not None for _cid, soi in after), (
            "edição orfanou o consumo (service_order_item_id ficou NULL)"
        )

        # Bobina sem mudança de metros (mesma bobina/serviço → delta zero)
        await db_session.refresh(film_roll)
        assert film_roll.remaining_meters == pytest.approx(30.0 - METERS)


class TestRemoveMultiTonalityServiceCleansConsumption:
    """Editar a O.S. removendo um serviço multi-tonalidade (film_applications) não pode
    deixar o consumo daquele serviço órfão (service_order_item_id NULL): o rastro é
    apagado e os metros voltam para CADA bobina envolvida na divisão por tonalidade."""

    @pytest_asyncio.fixture
    async def multi_film_type_with_rolls(
        self, db_session: AsyncSession, test_store: Store, film_service: Service
    ) -> tuple[FilmType, FilmRoll, FilmRoll]:
        """Reaproveita o film_service (METERS por aplicação) com 2 bobinas p/ 2 tonalidades."""
        film_type = FilmType(
            name="Poliester Multi Ciclo",
            department="film",
            available_tonalities=["G05", "G20"],
        )
        db_session.add(film_type)
        await db_session.flush()
        db_session.add(
            FilmTypeService(
                film_type_id=film_type.id, service_id=film_service.id, meters_consumed=METERS
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
        await db_session.refresh(roll_g20)
        await db_session.refresh(roll_g05)
        return film_type, roll_g20, roll_g05

    @pytest_asyncio.fixture
    async def plain_service(self, db_session: AsyncSession, test_brand) -> Service:
        """Serviço sem vínculo de película — só para satisfazer items min_length=1
        no PATCH que remove o serviço multi-tonalidade."""
        service = Service(
            name="Higienização Simples",
            code="HIGS",
            department="film",
            base_price=100.0,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(service)
        await db_session.commit()
        await db_session.refresh(service)
        return service

    @pytest.mark.asyncio
    async def test_remove_multi_tonality_service_releases_all_rolls(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        film_service: Service,
        film_installer: Employee,
        multi_film_type_with_rolls: tuple[FilmType, FilmRoll, FilmRoll],
        plain_service: Service,
    ):
        _, roll_g20, roll_g05 = multi_film_type_with_rolls
        so = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="MTC1A23",
            department="film",
            status="in_progress",
            entry_time=datetime(2026, 7, 10, 8, 0, tzinfo=UTC),
            start_time=datetime(2026, 7, 10, 8, 30, tzinfo=UTC),
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.flush()
        item = ServiceOrderItem(
            service_order_id=so.id,
            service_id=film_service.id,
            unit_price=film_service.base_price,
            quantity=1,
            tonality="G20/G05",
            film_applications=[
                {"tonality": "G20", "region": "Portas dianteiras"},
                {"tonality": "G05", "region": "Portas traseiras"},
            ],
        )
        db_session.add(item)
        await db_session.commit()
        await db_session.refresh(so)

        resp = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/chancela-multi.jpg"],
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
        assert resp.status_code == 200, resp.text

        await db_session.refresh(roll_g20)
        await db_session.refresh(roll_g05)
        assert roll_g20.remaining_meters == pytest.approx(30.0 - METERS / 2)
        assert roll_g05.remaining_meters == pytest.approx(30.0 - METERS / 2)

        # Edita removendo o serviço multi-tonalidade (troca por um serviço sem película).
        resp = await owner_client.patch(
            f"/api/v1/service-orders/{so.id}",
            json={"items": [{"service_id": plain_service.id, "quantity": 1}]},
        )
        assert resp.status_code == 200, resp.text

        # Nenhuma linha de consumo órfã (item_id NULL) para nenhuma das duas bobinas.
        orphan_rows = (
            await db_session.execute(
                select(FilmConsumption.id).where(
                    FilmConsumption.film_roll_id.in_([roll_g20.id, roll_g05.id]),
                    FilmConsumption.service_order_item_id.is_(None),
                )
            )
        ).all()
        assert orphan_rows == [], f"consumo órfão após remover o serviço: {orphan_rows}"

        # Nenhum rastro (nem +Xm, nem -Xm) e metros restaurados em CADA bobina.
        rows_g20 = (
            await db_session.execute(
                select(FilmConsumption.id).where(FilmConsumption.film_roll_id == roll_g20.id)
            )
        ).all()
        rows_g05 = (
            await db_session.execute(
                select(FilmConsumption.id).where(FilmConsumption.film_roll_id == roll_g05.id)
            )
        ).all()
        assert rows_g20 == [], f"bobina G20 ainda tem rastro: {rows_g20}"
        assert rows_g05 == [], f"bobina G05 ainda tem rastro: {rows_g05}"

        await db_session.refresh(roll_g20)
        await db_session.refresh(roll_g05)
        assert roll_g20.remaining_meters == pytest.approx(30.0)
        assert roll_g05.remaining_meters == pytest.approx(30.0)


class TestAdjustRollOpcaoA:
    """Estoque Opção A: 'Ajustar' lança movimento no extrato + saldo derivado."""

    @pytest.mark.asyncio
    async def test_adjust_requires_reason(
        self, db_session: AsyncSession, test_owner: User, film_roll: FilmRoll
    ):
        """Motivo do ajuste é obrigatório."""
        from app.core.exceptions import ValidationError
        from app.modules.inventory import service as inv_service

        with pytest.raises(ValidationError):
            await inv_service.adjust_roll_meters(
                db_session, film_roll.id, 25.0, test_owner, note="   "
            )

    @pytest.mark.asyncio
    async def test_adjust_lancis_ledger_line_and_derives_saldo(
        self, db_session: AsyncSession, test_owner: User, film_roll: FilmRoll
    ):
        """Ajuste 30 -> 25 grava linha kind='ajuste' (+5m) com motivo; saldo = extrato."""
        from app.modules.inventory import service as inv_service

        roll = await inv_service.adjust_roll_meters(
            db_session, film_roll.id, 25.0, test_owner, note="conferência física 30/07"
        )
        assert roll.remaining_meters == pytest.approx(25.0)

        rows = (
            await db_session.execute(
                select(
                    FilmConsumption.meters_consumed,
                    FilmConsumption.kind,
                    FilmConsumption.adjustment_reason,
                ).where(
                    FilmConsumption.film_roll_id == film_roll.id,
                    FilmConsumption.kind == "ajuste",
                )
            )
        ).all()
        assert len(rows) == 1
        meters, kind, reason = rows[0]
        assert meters == pytest.approx(5.0)  # baixou 5m
        assert kind == "ajuste"
        assert reason == "conferência física 30/07"

        # Saldo = total - soma(extrato)
        total = (
            (
                await db_session.execute(
                    select(FilmConsumption.meters_consumed).where(
                        FilmConsumption.film_roll_id == film_roll.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert roll.remaining_meters == pytest.approx(roll.total_meters - sum(total))

    @pytest.mark.asyncio
    async def test_consume_beyond_available_goes_negative(
        self, db_session: AsyncSession, film_roll: FilmRoll
    ):
        """Opção A: consumir mais que o disponível NÃO trava; saldo fica negativo."""
        from app.modules.inventory import service as inv_service

        roll = await inv_service.consume_roll(db_session, film_roll.id, None, 42.0)
        assert roll.remaining_meters == pytest.approx(30.0 - 42.0)  # -12m, sem clamp


class TestConsumeRollStoreGuard:
    """C-04: consume_roll barra bobina de outra loja, exceto estoque compartilhado."""

    async def _make_other_store_order(self, db_session, test_brand, film_service, test_user):
        from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem
        from app.modules.stores.models import Store

        other = Store(
            name="Loja Outra",
            code="LJ99",
            address="Rua X",
            phone="11",
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(other)
        await db_session.flush()
        so = ServiceOrder(
            store_id=other.id,
            vehicle_plate="OUT1A23",
            department="film",
            status="in_progress",
            entry_time=datetime.now(UTC),
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.flush()
        item = ServiceOrderItem(
            service_order_id=so.id, service_id=film_service.id, unit_price=0, quantity=1
        )
        db_session.add(item)
        await db_session.commit()
        return other, so, item

    @pytest.mark.asyncio
    async def test_consume_rejects_roll_of_other_store(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_brand,
        film_roll: FilmRoll,
        film_service: Service,
        test_user: User,
    ):
        """Bobina da loja A numa O.S. da loja B (sem vínculo) é recusada."""
        from app.core.exceptions import ValidationError
        from app.modules.inventory import service as inv_service

        _other, _so, item = await self._make_other_store_order(
            db_session, test_brand, film_service, test_user
        )
        # film_roll é da test_store; a O.S. é da "other" → deve barrar
        with pytest.raises(ValidationError):
            await inv_service.consume_roll(db_session, film_roll.id, item.id, 2.0)

    @pytest.mark.asyncio
    async def test_consume_allows_shared_inventory_partner(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_brand,
        film_roll: FilmRoll,
        film_service: Service,
        test_user: User,
    ):
        """Com vínculo de estoque compartilhado, o consumo cruzado é permitido."""
        from app.modules.inventory import service as inv_service
        from app.modules.stores.models import StoreInventoryLink

        other, _so, item = await self._make_other_store_order(
            db_session, test_brand, film_service, test_user
        )
        # vincula estoque: O.S. da 'other' pode usar bobina da test_store
        db_session.add(StoreInventoryLink(store_id=other.id, linked_store_id=test_store.id))
        await db_session.commit()

        roll = await inv_service.consume_roll(db_session, film_roll.id, item.id, 2.0)
        assert roll.remaining_meters == pytest.approx(30.0 - 2.0)


class TestConsumeRollThresholdNotification:
    """Consumo que cruza limiar de cor notifica Owners com descrição legível e deep-link.

    ``film_roll`` (fixture do módulo) usa FilmType "Poliester Ciclo" sem limiares
    customizados: yellow_threshold_meters=10.0 / red_threshold_meters=3.0 (default),
    total_meters=30.0.
    """

    @pytest.mark.asyncio
    async def test_crossing_yellow_threshold_notifies_owner(
        self,
        db_session: AsyncSession,
        test_owner: User,
        film_roll: FilmRoll,
    ):
        """30m -> consumir 21m deixa 9m (< 10 amarelo): cruzou verde->amarelo."""
        from app.modules.inventory import service as inv_service
        from app.modules.notifications.models import Notification

        roll = await inv_service.consume_roll(db_session, film_roll.id, None, 21.0)
        assert roll.remaining_meters == pytest.approx(9.0)

        notif = (
            await db_session.execute(
                select(Notification).where(Notification.user_id == test_owner.id)
            )
        ).scalar_one()

        assert notif.related_url == f"/estoque?roll={film_roll.id}"
        assert notif.title == "Estoque de Película Baixo"
        assert "Bobina Poliester Ciclo G20" in notif.body
        assert "Bobina #" not in notif.body
        assert f"Bobina #{film_roll.id}" not in notif.title

    @pytest.mark.asyncio
    async def test_crossing_red_threshold_notifies_owner(
        self,
        db_session: AsyncSession,
        test_owner: User,
        film_roll: FilmRoll,
    ):
        """30m -> consumir os 30m esgota a bobina (status vira 'esgotada'), que é o
        único jeito de ``get_color`` retornar 'red' (o campo red_threshold_meters não
        é usado por ``get_color`` hoje): mensagem de nível crítico."""
        from app.modules.inventory import service as inv_service
        from app.modules.notifications.models import Notification

        roll = await inv_service.consume_roll(db_session, film_roll.id, None, 30.0)
        assert roll.remaining_meters == pytest.approx(0.0)
        assert roll.status == "esgotada"

        notif = (
            await db_session.execute(
                select(Notification).where(Notification.user_id == test_owner.id)
            )
        ).scalar_one()

        assert notif.related_url == f"/estoque?roll={film_roll.id}"
        assert notif.title == "Estoque de Película Crítico"
        assert "Bobina Poliester Ciclo G20" in notif.body

    @pytest.mark.asyncio
    async def test_no_notification_when_threshold_not_crossed(
        self,
        db_session: AsyncSession,
        test_owner: User,
        film_roll: FilmRoll,
    ):
        """Consumo que mantém a bobina verde não deve gerar notificação."""
        from app.modules.inventory import service as inv_service
        from app.modules.notifications.models import Notification

        roll = await inv_service.consume_roll(db_session, film_roll.id, None, 5.0)
        assert roll.remaining_meters == pytest.approx(25.0)

        rows = (
            await db_session.execute(
                select(Notification).where(Notification.user_id == test_owner.id)
            )
        ).all()
        assert rows == []
