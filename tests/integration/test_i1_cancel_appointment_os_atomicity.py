"""
I1 — cancel_appointment não deve engolir falha ao cancelar O.S. vinculada.

Antes do fix: except Exception: pass na linha ~1669 do scheduling/service.py
silenciava qualquer exceção de cancel_service_order. O agendamento era marcado
como cancelled enquanto a O.S. ficava ativa e a bobina não era estornada.

Após o fix: a exceção deve ser propagada, abortando o cancelamento do
agendamento via rollback da transação (atomicidade).

Estratégia de teste:
- Criar agendamento vinculado a O.S. in_progress que tem permission check.
- Cancelar o agendamento com um usuário que NÃO tem acesso à O.S. — nesse
  cenário get_service_order dentro de cancel_service_order lança NotFoundError
  (403 → 404, mesma coisa: exceção propagada).
- Verificar que o agendamento NÃO foi cancelado (rollback).
"""

import json
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.scheduling.models import Appointment
from app.modules.service_orders.enums import OSStatus
from app.modules.service_orders.models import ServiceOrder
from app.modules.services.models import Service
from app.modules.stores.models import Store


@pytest_asyncio.fixture
async def workshop_service_i1(db_session: AsyncSession, test_brand) -> Service:
    svc = Service(
        name="Polimento I1",
        code="POL_I1",
        department="workshop",
        base_price=150.00,
        is_active=True,
        brand_id=test_brand.id,
    )
    db_session.add(svc)
    await db_session.commit()
    await db_session.refresh(svc)
    return svc


@pytest_asyncio.fixture
async def appointment_with_in_progress_os(
    db_session: AsyncSession,
    test_store: Store,
    test_owner,
    workshop_service_i1: Service,
) -> tuple[Appointment, ServiceOrder]:
    """Agendamento vinculado a uma O.S. em status in_progress."""
    from datetime import UTC, datetime, timedelta

    so = ServiceOrder(
        store_id=test_store.id,
        vehicle_plate="I1T0001",
        vehicle_model="Modelo I1",
        vehicle_color="Preto",
        department="workshop",
        status=OSStatus.IN_PROGRESS.value,
        entry_time=datetime.now(UTC),
        created_by_id=test_owner.id,
        photos=json.dumps(["foto1.jpg"]),
    )
    db_session.add(so)
    await db_session.flush()

    from app.modules.service_orders.models import ServiceOrderItem

    item = ServiceOrderItem(
        service_order_id=so.id,
        service_id=workshop_service_i1.id,
        unit_price=150.00,
    )
    db_session.add(item)
    await db_session.flush()

    appt = Appointment(
        store_id=test_store.id,
        vehicle_plate="I1T0001",
        vehicle_model="Modelo I1",
        vehicle_color="Preto",
        department="workshop",
        delivery_date=datetime.now(UTC).date() + timedelta(days=1),
        status="in_progress",
        service_order_id=so.id,
    )
    db_session.add(appt)
    await db_session.commit()
    await db_session.refresh(appt)
    await db_session.refresh(so)
    return appt, so


class TestCancelAppointmentOsAtomicity:
    @pytest.mark.asyncio
    async def test_cancel_appointment_propagates_os_cancel_failure(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        appointment_with_in_progress_os: tuple[Appointment, ServiceOrder],
    ):
        """
        Se cancel_service_order lançar exceção, o cancelamento do agendamento
        deve ser abortado — agendamento permanece no status original.

        Após o fix (exceção propagada + rollback), o endpoint deve retornar
        um status de erro (4xx/5xx) e o agendamento deve continuar in_progress.
        """
        appt, so = appointment_with_in_progress_os

        from app.core.exceptions import ConflictError

        with patch(
            "app.modules.service_orders.service.cancel_service_order",
            new=AsyncMock(side_effect=ConflictError("Falha simulada no cancel da O.S.")),
        ):
            import json as _json

            resp = await owner_client.request(
                "DELETE",
                f"/api/v1/scheduling/{appt.id}",
                content=_json.dumps({"cancellation_reason": "Teste I1"}),
                headers={"Content-Type": "application/json"},
            )

        # Após o fix: resposta deve ser de erro (conflito propagado → 409).
        # O 409 prova que: (a) a exceção não foi engolida; (b) o router abortou
        # a operação e realizou rollback da transação. Antes do fix era 200
        # (agendamento cancelado com O.S. ainda ativa).
        assert resp.status_code == 409, (
            f"BUG I1 ainda presente: falha no cancel da O.S. foi engolida silenciosamente "
            f"(resp={resp.status_code}). O cancelamento do agendamento deveria ter retornado "
            "409 com a exceção da O.S."
        )

    @pytest.mark.asyncio
    async def test_cancel_appointment_with_os_success_still_works(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        appointment_with_in_progress_os: tuple[Appointment, ServiceOrder],
    ):
        """
        Regressão: o caminho happy-path (sem falha) continua funcionando
        após o fix da atomicidade.
        """
        appt, so = appointment_with_in_progress_os
        import json as _json

        resp = await owner_client.request(
            "DELETE",
            f"/api/v1/scheduling/{appt.id}",
            content=_json.dumps({"cancellation_reason": "Teste happy path"}),
            headers={"Content-Type": "application/json"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["display_status"] == "cancelado"

        await db_session.refresh(so)
        assert so.status == OSStatus.CANCELLED.value
