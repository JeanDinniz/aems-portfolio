"""
S1 — Race condition no finalize: lock pessimista impede dupla finalização.
S2 — finalize_service_order grava log_audit com action "finalize".

S1 (determinístico para SQLite):
  Verificamos que a query interna usa with_for_update() e que tentar
  finalizar uma O.S. já completed é rejeitado pela guarda de status.
  (Concorrência real não é testável em SQLite; o lock é validado via
  inspeção da query emitida.)

S2:
  Após finalizar via API, existe um AuditLog com action="finalize" e
  resource_type="service_order" apontando para a O.S. correta.
"""

from datetime import UTC, datetime

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.modules.auth.models import User
from app.modules.employees.models import Employee
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem
from app.modules.services.models import Service
from app.modules.stores.models import Store


# ---------------------------------------------------------------------------
# Fixtures locais
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def esthetics_service(db_session: AsyncSession, test_brand) -> Service:
    """Serviço de estética (sem exigência de bobina)."""
    svc = Service(
        name="Lavagem Detalhada S1S2",
        department="esthetics",
        base_price=150.00,
        is_active=True,
        brand_id=test_brand.id,
    )
    db_session.add(svc)
    await db_session.commit()
    await db_session.refresh(svc)
    return svc


@pytest_asyncio.fixture
async def installer_s1s2(db_session: AsyncSession, test_store: Store) -> Employee:
    emp = Employee(
        name="Instalador S1S2",
        store_id=test_store.id,
        is_active=True,
    )
    db_session.add(emp)
    await db_session.commit()
    await db_session.refresh(emp)
    return emp


@pytest_asyncio.fixture
async def os_in_progress(
    db_session: AsyncSession,
    test_store: Store,
    test_owner: User,
    esthetics_service: Service,
) -> ServiceOrder:
    """O.S. de estética in_progress pronta para ser finalizada."""
    so = ServiceOrder(
        store_id=test_store.id,
        vehicle_plate="S1S2A01",
        department="esthetics",
        status="in_progress",
        is_courtesy=False,
        is_galpon=False,
        is_return=False,
        entry_time=datetime(2026, 8, 1, 8, 0, tzinfo=UTC),
        start_time=datetime(2026, 8, 1, 8, 30, tzinfo=UTC),
        created_by_id=test_owner.id,
    )
    db_session.add(so)
    await db_session.flush()
    db_session.add(
        ServiceOrderItem(
            service_order_id=so.id,
            service_id=esthetics_service.id,
            unit_price=esthetics_service.base_price,
            quantity=1,
        )
    )
    await db_session.commit()
    await db_session.refresh(so)
    return so


# ---------------------------------------------------------------------------
# S1 — Lock pessimista (testes determinísticos)
# ---------------------------------------------------------------------------


class TestS1FinalizeLock:
    """
    S1 — Verifica que o lock pessimista está presente e que finalizar uma
    O.S. já completed é rejeitado (guarda de status funciona após o lock).
    """

    @pytest.mark.asyncio
    async def test_finalize_uses_with_for_update(self):
        """
        Verifica que finalize_service_order emite SELECT ... FOR UPDATE antes
        de qualquer operação de escrita.

        Estratégia: mock do db.execute que captura as queries emitidas.
        Verifica que a primeira query (lock) inclui FOR UPDATE.
        """
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.modules.service_orders import service as svc_module
        from app.modules.service_orders.schemas import FinalizeOrderRequest

        # Simula uma query result para o lock (id, status)
        mock_lock_row = MagicMock()
        mock_lock_row.first.return_value = (1, "in_progress")

        # A segunda chamada (get_service_order via selectinload) será interrompida
        # intencionalmente — só nos interessa verificar que o FOR UPDATE foi emitido.
        captured_queries: list = []

        async def mock_execute(query, *args, **kwargs):
            captured_queries.append(query)
            if len(captured_queries) == 1:
                # Primeira: lock query — retorna linha simulada
                return mock_lock_row
            # Demais: gera StopIteration para interromper sem simular o DB inteiro
            raise RuntimeError("stop-after-lock")

        mock_db = MagicMock()
        mock_db.execute = mock_execute

        data = FinalizeOrderRequest(
            completion_photos=[],
            film_roll_assignments=[],
            employee_ids=[],
            employee_assignments=[],
        )

        owner = MagicMock()
        owner.role = "owner"
        owner.id = 1

        with patch.object(svc_module, "get_service_order", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = RuntimeError("stop-after-lock")
            try:
                await svc_module.finalize_service_order(mock_db, 1, data, owner)
            except RuntimeError:
                pass  # esperado — interrompido após o lock

        # Deve ter emitido ao menos uma query
        assert len(captured_queries) >= 1, "Nenhuma query emitida — lock ausente"

        # A primeira query deve ter with_for_update compilado nela
        first_query = captured_queries[0]
        compiled = str(first_query.compile(compile_kwargs={"literal_binds": False}))
        assert "FOR UPDATE" in compiled.upper(), (
            f"Primeira query não usa FOR UPDATE (lock pessimista ausente).\n"
            f"Query compilada: {compiled}"
        )

    @pytest.mark.asyncio
    async def test_second_finalize_rejected_after_first_commits(
        self,
        owner_client: AsyncClient,
        os_in_progress: ServiceOrder,
        installer_s1s2: Employee,
    ):
        """
        Idempotência: finalizar a mesma O.S. duas vezes em sequência.
        A primeira deve retornar 200 (completed).
        A segunda deve retornar 422 (guarda de status: já completed).

        Isso é o comportamento que o lock garante na concorrência real:
        a segunda requisição, ao ser desbloqueada pelo lock, relê status=completed
        e é rejeitada pela mesma guarda que este teste exercita sequencialmente.
        """
        payload = {
            "completion_photos": ["/uploads/s1s2_chancela.jpg"],
            "film_roll_assignments": [],
            "employee_ids": [installer_s1s2.id],
            "employee_assignments": [],
        }

        # Primeira finalização: deve ter sucesso
        resp1 = await owner_client.post(
            f"/api/v1/service-orders/{os_in_progress.id}/finalize",
            json=payload,
        )
        assert resp1.status_code == 200, f"Primeira finalização falhou: {resp1.text}"
        assert resp1.json()["status"] == "completed"

        # Segunda finalização da mesma O.S.: deve ser rejeitada
        resp2 = await owner_client.post(
            f"/api/v1/service-orders/{os_in_progress.id}/finalize",
            json=payload,
        )
        assert resp2.status_code == 422, (
            f"Segunda finalização deveria ser 422 (completed), mas retornou "
            f"{resp2.status_code}: {resp2.text}"
        )

    @pytest.mark.asyncio
    async def test_finalize_waiting_os_succeeds(
        self,
        db_session: AsyncSession,
        owner_client: AsyncClient,
        test_store: Store,
        test_owner: User,
        esthetics_service: Service,
        installer_s1s2: Employee,
    ):
        """Finalizar uma O.S. com status 'waiting' (não apenas in_progress) deve funcionar."""
        so = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="S1S2A02",
            department="esthetics",
            status="waiting",
            is_courtesy=False,
            is_galpon=False,
            is_return=False,
            entry_time=datetime(2026, 8, 1, 9, 0, tzinfo=UTC),
            created_by_id=test_owner.id,
        )
        db_session.add(so)
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=so.id,
                service_id=esthetics_service.id,
                unit_price=esthetics_service.base_price,
                quantity=1,
            )
        )
        await db_session.commit()

        resp = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/s1s2_c2.jpg"],
                "film_roll_assignments": [],
                "employee_ids": [installer_s1s2.id],
                "employee_assignments": [],
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "completed"

    @pytest.mark.asyncio
    async def test_finalize_cancelled_os_rejected(
        self,
        db_session: AsyncSession,
        owner_client: AsyncClient,
        test_store: Store,
        test_owner: User,
        esthetics_service: Service,
        installer_s1s2: Employee,
    ):
        """O.S. cancelada não pode ser finalizada — guarda de status deve rejeitar."""
        so = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="S1S2A03",
            department="esthetics",
            status="cancelled",
            is_courtesy=False,
            is_galpon=False,
            is_return=False,
            entry_time=datetime(2026, 8, 1, 10, 0, tzinfo=UTC),
            created_by_id=test_owner.id,
        )
        db_session.add(so)
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=so.id,
                service_id=esthetics_service.id,
                unit_price=esthetics_service.base_price,
                quantity=1,
            )
        )
        await db_session.commit()

        resp = await owner_client.post(
            f"/api/v1/service-orders/{so.id}/finalize",
            json={
                "completion_photos": ["/uploads/s1s2_c3.jpg"],
                "film_roll_assignments": [],
                "employee_ids": [installer_s1s2.id],
                "employee_assignments": [],
            },
        )
        assert resp.status_code == 422, (
            f"Cancelada deveria retornar 422, obteve {resp.status_code}: {resp.text}"
        )


# ---------------------------------------------------------------------------
# S2 — Audit log após finalização
# ---------------------------------------------------------------------------


class TestS2FinalizeAuditLog:
    """
    S2 — finalize_service_order deve criar um AuditLog com action='finalize'.
    """

    @pytest.mark.asyncio
    async def test_finalize_creates_audit_log(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        os_in_progress: ServiceOrder,
        installer_s1s2: Employee,
    ):
        """Após finalizar, deve existir AuditLog action=finalize para a O.S."""
        # Captura IDs antes da chamada API para não precisar acessar o objeto
        # expirado após o rollback da sessão.
        so_id = os_in_progress.id
        emp_id = installer_s1s2.id

        resp = await owner_client.post(
            f"/api/v1/service-orders/{so_id}/finalize",
            json={
                "completion_photos": ["/uploads/s2_chancela.jpg"],
                "film_roll_assignments": [],
                "employee_ids": [emp_id],
                "employee_assignments": [],
            },
        )
        assert resp.status_code == 200, resp.text

        # A rota fez commit numa sessão diferente; expire a sessão do teste
        # para que a próxima query leia os dados já commitados.
        await db_session.rollback()

        result = await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "finalize",
                AuditLog.resource_type == "service_order",
                AuditLog.resource_id == so_id,
            )
        )
        log = result.scalar_one_or_none()
        assert log is not None, (
            "AuditLog com action='finalize' não encontrado após finalizar a O.S."
        )

    @pytest.mark.asyncio
    async def test_finalize_audit_log_contains_status_transition(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_owner: User,
        esthetics_service: Service,
        installer_s1s2: Employee,
    ):
        """O AuditLog deve registrar a transição de status (old_value/new_value)."""
        so = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="S2AUD01",
            department="esthetics",
            status="in_progress",
            is_courtesy=False,
            is_galpon=False,
            is_return=False,
            entry_time=datetime(2026, 8, 1, 11, 0, tzinfo=UTC),
            start_time=datetime(2026, 8, 1, 11, 30, tzinfo=UTC),
            created_by_id=test_owner.id,
        )
        db_session.add(so)
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=so.id,
                service_id=esthetics_service.id,
                unit_price=esthetics_service.base_price,
                quantity=1,
            )
        )
        await db_session.commit()

        # Captura ID antes do rollback
        so_id = so.id
        emp_id = installer_s1s2.id

        resp = await owner_client.post(
            f"/api/v1/service-orders/{so_id}/finalize",
            json={
                "completion_photos": ["/uploads/s2_aud01.jpg"],
                "film_roll_assignments": [],
                "employee_ids": [emp_id],
                "employee_assignments": [],
            },
        )
        assert resp.status_code == 200, resp.text

        await db_session.rollback()

        result = await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "finalize",
                AuditLog.resource_type == "service_order",
                AuditLog.resource_id == so_id,
            )
        )
        log = result.scalar_one_or_none()
        assert log is not None, "AuditLog com action='finalize' ausente"
        assert log.old_value is not None, "old_value deve estar presente"
        assert log.new_value is not None, "new_value deve estar presente"
        assert log.old_value.get("status") == "in_progress", (
            f"old_value.status deveria ser 'in_progress', obteve: {log.old_value}"
        )
        assert log.new_value.get("status") == "completed", (
            f"new_value.status deveria ser 'completed', obteve: {log.new_value}"
        )

    @pytest.mark.asyncio
    async def test_finalize_audit_log_contains_employee_ids(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_owner: User,
        esthetics_service: Service,
        installer_s1s2: Employee,
    ):
        """O AuditLog deve registrar os employee_ids do finalize."""
        so = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="S2AUD02",
            department="esthetics",
            status="in_progress",
            is_courtesy=False,
            is_galpon=False,
            is_return=False,
            entry_time=datetime(2026, 8, 1, 12, 0, tzinfo=UTC),
            start_time=datetime(2026, 8, 1, 12, 30, tzinfo=UTC),
            created_by_id=test_owner.id,
        )
        db_session.add(so)
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=so.id,
                service_id=esthetics_service.id,
                unit_price=esthetics_service.base_price,
                quantity=1,
            )
        )
        await db_session.commit()

        # Captura IDs antes do rollback
        so_id = so.id
        emp_id = installer_s1s2.id

        resp = await owner_client.post(
            f"/api/v1/service-orders/{so_id}/finalize",
            json={
                "completion_photos": ["/uploads/s2_aud02.jpg"],
                "film_roll_assignments": [],
                "employee_ids": [emp_id],
                "employee_assignments": [],
            },
        )
        assert resp.status_code == 200, resp.text

        await db_session.rollback()

        result = await db_session.execute(
            select(AuditLog).where(
                AuditLog.action == "finalize",
                AuditLog.resource_type == "service_order",
                AuditLog.resource_id == so_id,
            )
        )
        log = result.scalar_one_or_none()
        assert log is not None
        assert emp_id in log.new_value.get("employee_ids", []), (
            f"employee_id {emp_id} ausente no AuditLog new_value: {log.new_value}"
        )
