"""
Testes de integração para as mudanças do módulo scheduling:

1. display_status "duplicidade" quando O.S. vinculada está em status 'duplicate'.
2. Editar agendamento com O.S. em status não-terminal ressincroniza itens/dados da O.S.
3. Editar agendamento com O.S. já completed é bloqueado.
4. Editar agendamento com O.S. que tem film_roll_id atribuído é bloqueado (safety).
5. Cancelar agendamento com O.S. in_progress cancela a O.S.
6. Cancelar agendamento com O.S. completed NÃO cancela a O.S.
"""

from datetime import UTC, datetime

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.dealerships.models import Dealership
from app.modules.scheduling.models import Appointment
from app.modules.scheduling.service import compute_display_status
from app.modules.service_orders.enums import OSStatus
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem
from app.modules.services.models import Service
from app.modules.stores.models import Store

# ---------------------------------------------------------------------------
# Fixtures locais
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def film_service(db_session: AsyncSession, test_brand) -> Service:
    svc = Service(
        name="Película Lateral",
        code="PL01",
        department="film",
        base_price=300.00,
        is_active=True,
        brand_id=test_brand.id,
    )
    db_session.add(svc)
    await db_session.commit()
    await db_session.refresh(svc)
    return svc


@pytest_asyncio.fixture
async def workshop_service(db_session: AsyncSession, test_brand) -> Service:
    svc = Service(
        name="Polimento",
        code="POL1",
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
async def test_dealership(db_session: AsyncSession, test_store: Store) -> Dealership:
    dealer = Dealership(
        name="Concessionária Teste",
        store_id=test_store.id,
        brand="Toyota",
        is_active=True,
    )
    db_session.add(dealer)
    await db_session.commit()
    await db_session.refresh(dealer)
    return dealer


@pytest_asyncio.fixture
async def appointment_with_film(
    db_session: AsyncSession,
    test_store: Store,
    film_service: Service,
    test_owner,
) -> Appointment:
    """Agendamento de película sem O.S. ainda."""
    appt = Appointment(
        store_id=test_store.id,
        department="film",
        delivery_date=datetime(2030, 6, 15).date(),
        vehicle_plate="TST1D23",
        vehicle_model="Corolla",
        vehicle_color="Branco",
        film_entries=[{"service_id": film_service.id, "tonality": "G20"}],
        service_ids=None,
        status="scheduled",
        created_by_id=test_owner.id,
    )
    db_session.add(appt)
    await db_session.commit()
    await db_session.refresh(appt)
    return appt


@pytest_asyncio.fixture
async def appointment_with_workshop(
    db_session: AsyncSession,
    test_store: Store,
    workshop_service: Service,
    test_owner,
) -> Appointment:
    """Agendamento de oficina sem O.S. ainda."""
    appt = Appointment(
        store_id=test_store.id,
        department="workshop",
        delivery_date=datetime(2030, 6, 15).date(),
        vehicle_plate="WRK1D23",
        vehicle_model="HB20",
        vehicle_color="Prata",
        service_ids=[workshop_service.id],
        film_entries=None,
        status="scheduled",
        created_by_id=test_owner.id,
    )
    db_session.add(appt)
    await db_session.commit()
    await db_session.refresh(appt)
    return appt


async def _make_service_order(
    db_session: AsyncSession,
    store_id: int,
    status: str,
    service_id: int,
    created_by_id: int,
    film_roll_id: int | None = None,
    completion_time: datetime | None = None,
) -> ServiceOrder:
    """Cria uma O.S. diretamente no banco com o status desejado."""
    so = ServiceOrder(
        store_id=store_id,
        vehicle_plate="TST1D23",
        department="film",
        status=status,
        created_by_id=created_by_id,
        updated_by_id=created_by_id,
        photos="[]",
        entry_time=datetime.now(UTC),
        completion_time=completion_time,
    )
    db_session.add(so)
    await db_session.flush()

    item = ServiceOrderItem(
        service_order_id=so.id,
        service_id=service_id,
        quantity=1,
        unit_price=300.00,
        film_roll_id=film_roll_id,
    )
    db_session.add(item)
    await db_session.commit()
    await db_session.refresh(so)
    return so


# ---------------------------------------------------------------------------
# MUDANÇA 1 — display_status "duplicidade"
# ---------------------------------------------------------------------------


class TestDisplayStatusDuplicidade:
    def test_duplicate_os_returns_duplicidade(self):
        """Agendamento com O.S. em 'duplicate' deve retornar display_status 'duplicidade'."""
        from datetime import date

        appt = Appointment(
            store_id=1,
            department="film",
            delivery_date=date(2030, 6, 15),
            vehicle_plate="TST1D23",
            status="scheduled",
            service_order_id=99,
            created_by_id=1,
        )
        ds = compute_display_status(appt, OSStatus.DUPLICATE.value)
        assert ds == "duplicidade"

    def test_completed_os_returns_finalizado(self):
        """O.S. completed ainda retorna 'finalizado'."""
        from datetime import date

        appt = Appointment(
            store_id=1,
            department="film",
            delivery_date=date(2030, 6, 15),
            vehicle_plate="TST1D23",
            status="scheduled",
            service_order_id=99,
            created_by_id=1,
        )
        ds = compute_display_status(appt, OSStatus.COMPLETED.value)
        assert ds == "finalizado"

    def test_cancelled_os_returns_finalizado(self):
        """O.S. cancelled retorna 'finalizado'."""
        from datetime import date

        appt = Appointment(
            store_id=1,
            department="film",
            delivery_date=date(2030, 6, 15),
            vehicle_plate="TST1D23",
            status="scheduled",
            service_order_id=99,
            created_by_id=1,
        )
        ds = compute_display_status(appt, OSStatus.CANCELLED.value)
        assert ds == "finalizado"

    def test_wrong_os_sem_completion_em_execucao(self):
        """O.S. 'wrong' sem completion_time → 'em_execucao' (o rótulo 'wrong' é
        ignorado pelo Agendamento), INDEPENDENTE da data."""
        from datetime import date

        appt = Appointment(
            store_id=1,
            department="film",
            delivery_date=date(2030, 6, 15),
            vehicle_plate="TST1D23",
            status="scheduled",
            service_order_id=99,
            created_by_id=1,
        )
        assert compute_display_status(appt, OSStatus.WRONG.value, None) == "em_execucao"

    def test_wrong_os_finalizada_continua_finalizado(self):
        """ÂNCORA: O.S. finalizada e depois marcada 'wrong' continua 'finalizado' no
        Agendamento — marcar errada na Conferência não rebaixa o agendamento."""
        from datetime import date

        appt = Appointment(
            store_id=1,
            department="film",
            delivery_date=date(2020, 6, 15),  # entrega vencida
            vehicle_plate="TST1D23",
            status="scheduled",
            service_order_id=99,
            created_by_id=1,
        )
        ds = compute_display_status(appt, OSStatus.WRONG.value, datetime(2026, 1, 5, tzinfo=UTC))
        assert ds == "finalizado"

    def test_duplicate_not_finalizado(self):
        """'duplicate' NÃO deve retornar 'finalizado'."""
        from datetime import date

        appt = Appointment(
            store_id=1,
            department="film",
            delivery_date=date(2030, 6, 15),
            vehicle_plate="TST1D23",
            status="scheduled",
            service_order_id=99,
            created_by_id=1,
        )
        ds = compute_display_status(appt, OSStatus.DUPLICATE.value)
        assert ds != "finalizado"

    @pytest.mark.asyncio
    async def test_today_summary_counts_duplicidade(
        self,
        db_session: AsyncSession,
        test_owner,
        test_store: Store,
        film_service: Service,
        test_dealership: Dealership,
    ):
        """get_today_summary incrementa summary.duplicidade ao encontrar O.S. duplicate."""
        from datetime import date

        from app.modules.scheduling.service import get_today_summary

        # Criar O.S. com status duplicate
        so = await _make_service_order(
            db_session, test_store.id, OSStatus.DUPLICATE.value, film_service.id, test_owner.id
        )

        # Criar agendamento para hoje vinculado a essa O.S.
        appt = Appointment(
            store_id=test_store.id,
            department="film",
            delivery_date=date.today(),
            vehicle_plate="DUP1D23",
            service_order_id=so.id,
            status="scheduled",
            created_by_id=test_owner.id,
        )
        db_session.add(appt)
        await db_session.commit()

        summary = await get_today_summary(db_session, test_owner, store_id=test_store.id)
        assert summary.duplicidade >= 1
        # Não deve ter sido contado como finalizado
        assert summary.finalizado == 0

    @pytest.mark.asyncio
    async def test_today_summary_wrong_reflete_estado_real(
        self,
        db_session: AsyncSession,
        test_owner,
        test_store: Store,
        film_service: Service,
        test_dealership: Dealership,
    ):
        """O rótulo 'wrong' é ignorado pelo resumo: O.S. 'wrong' SEM completion_time
        conta como 'em_execucao'; COM completion_time conta como 'finalizado'."""
        from datetime import date

        from app.modules.scheduling.service import get_today_summary

        so_ativa = await _make_service_order(
            db_session,
            test_store.id,
            OSStatus.WRONG.value,
            film_service.id,
            test_owner.id,
            completion_time=None,
        )
        so_fin = await _make_service_order(
            db_session,
            test_store.id,
            OSStatus.WRONG.value,
            film_service.id,
            test_owner.id,
            completion_time=datetime.now(UTC),
        )
        db_session.add_all(
            [
                Appointment(
                    store_id=test_store.id,
                    department="film",
                    delivery_date=date.today(),
                    vehicle_plate="ERR1D23",
                    service_order_id=so_ativa.id,
                    status="scheduled",
                    created_by_id=test_owner.id,
                ),
                Appointment(
                    store_id=test_store.id,
                    department="film",
                    delivery_date=date.today(),
                    vehicle_plate="FINW123",
                    service_order_id=so_fin.id,
                    status="scheduled",
                    created_by_id=test_owner.id,
                ),
            ]
        )
        await db_session.commit()

        summary = await get_today_summary(db_session, test_owner, store_id=test_store.id)
        assert summary.em_execucao >= 1
        assert summary.finalizado >= 1

    @pytest.mark.asyncio
    async def test_lista_padrao_wrong_finalizada_oculta_ativa_mostra(
        self,
        db_session: AsyncSession,
        test_owner,
        test_store: Store,
        film_service: Service,
        test_dealership: Dealership,
    ):
        """Na lista padrão (sem terminais): O.S. 'wrong' FINALIZADA (completion_time)
        é terminal e fica OCULTA, independente da data; O.S. 'wrong' ATIVA (sem
        completion_time) aparece como 'em_execucao', independente da idade. 'wrong'
        não influencia mais o Agendamento."""
        from datetime import date, timedelta

        from app.modules.scheduling.service import list_appointments

        old_date = date.today() - timedelta(days=90)  # bem antiga
        fin_so = await _make_service_order(
            db_session,
            test_store.id,
            OSStatus.WRONG.value,
            film_service.id,
            test_owner.id,
            completion_time=datetime.now(UTC),
        )
        ativa_so = await _make_service_order(
            db_session,
            test_store.id,
            OSStatus.WRONG.value,
            film_service.id,
            test_owner.id,
            completion_time=None,
        )
        db_session.add_all(
            [
                Appointment(
                    store_id=test_store.id,
                    department="film",
                    delivery_date=old_date,
                    vehicle_plate="FINW123",  # wrong finalizada (terminal)
                    service_order_id=fin_so.id,
                    status="scheduled",
                    created_by_id=test_owner.id,
                ),
                Appointment(
                    store_id=test_store.id,
                    department="film",
                    delivery_date=old_date,
                    vehicle_plate="ATVW123",  # wrong ativa (não finalizada)
                    service_order_id=ativa_so.id,
                    status="scheduled",
                    created_by_id=test_owner.id,
                ),
            ]
        )
        await db_session.commit()

        responses, _ = await list_appointments(db_session, test_owner, store_id=test_store.id)
        plates = {r.vehicle_plate for r in responses}
        assert "FINW123" not in plates  # finalizada = terminal, excluída
        assert "ATVW123" in plates  # ativa aparece, mesmo antiga
        ativa = next(r for r in responses if r.vehicle_plate == "ATVW123")
        assert ativa.display_status == "em_execucao"

    @pytest.mark.asyncio
    async def test_export_por_loja_concessionaria_exclui_galpao(
        self,
        db_session: AsyncSession,
        test_owner,
        test_store: Store,
        film_service: Service,
    ):
        """Selecionar uma loja CONCESSIONÁRIA no export não traz os carros de galpão
        dela (o galpão vive sob a loja-galpão). Base compartilhada por tela/PDF/Excel."""
        from datetime import date, timedelta

        from app.modules.scheduling.service import list_appointments_for_export

        future = date.today() + timedelta(days=3)
        normal = Appointment(
            store_id=test_store.id,
            department="film",
            delivery_date=future,
            vehicle_plate="NRM1A23",
            is_galpon=False,
            film_entries=[{"service_id": film_service.id}],
            status="scheduled",
            created_by_id=test_owner.id,
        )
        galpao = Appointment(
            store_id=test_store.id,
            department="film",
            delivery_date=future,
            vehicle_plate="GLP1A23",
            is_galpon=True,
            film_entries=[{"service_id": film_service.id}],
            status="scheduled",
            created_by_id=test_owner.id,
        )
        db_session.add_all([normal, galpao])
        await db_session.commit()

        resp = await list_appointments_for_export(db_session, test_owner, store_id=test_store.id)
        plates = {r.vehicle_plate for r in resp}
        assert "NRM1A23" in plates
        assert "GLP1A23" not in plates


# ---------------------------------------------------------------------------
# MUDANÇA 2 — editar agendamento com O.S. vinculada (resync)
# ---------------------------------------------------------------------------


class TestUpdateAppointmentWithOS:
    @pytest.mark.asyncio
    async def test_edit_blocked_when_os_completed(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_owner,
        film_service: Service,
        test_dealership: Dealership,
        appointment_with_film: Appointment,
    ):
        """Editar agendamento com O.S. completed deve retornar 422."""
        so = await _make_service_order(
            db_session, test_store.id, OSStatus.COMPLETED.value, film_service.id, test_owner.id
        )
        appointment_with_film.service_order_id = so.id
        await db_session.commit()

        response = await owner_client.patch(
            f"/api/v1/scheduling/{appointment_with_film.id}",
            json={"notes": "Nova observação"},
        )
        assert response.status_code == 422
        assert "finalizada" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_edit_blocked_when_os_cancelled(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_owner,
        film_service: Service,
        test_dealership: Dealership,
        appointment_with_film: Appointment,
    ):
        """Editar agendamento com O.S. cancelled deve retornar 422."""
        so = await _make_service_order(
            db_session, test_store.id, OSStatus.CANCELLED.value, film_service.id, test_owner.id
        )
        appointment_with_film.service_order_id = so.id
        await db_session.commit()

        response = await owner_client.patch(
            f"/api/v1/scheduling/{appointment_with_film.id}",
            json={"notes": "Nova observação"},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_edit_allowed_when_os_in_progress(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_owner,
        film_service: Service,
        workshop_service: Service,
        test_dealership: Dealership,
        appointment_with_film: Appointment,
    ):
        """Editar agendamento com O.S. in_progress deve ser permitido e ressincronizar itens."""
        # Criar O.S. em in_progress com um serviço
        so = await _make_service_order(
            db_session, test_store.id, OSStatus.IN_PROGRESS.value, film_service.id, test_owner.id
        )
        appointment_with_film.service_order_id = so.id
        await db_session.commit()

        # Verificar itens antes da edição
        items_before = (
            (
                await db_session.execute(
                    select(ServiceOrderItem).where(ServiceOrderItem.service_order_id == so.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(items_before) >= 1

        # Editar notes do agendamento (simples, não muda serviços)
        response = await owner_client.patch(
            f"/api/v1/scheduling/{appointment_with_film.id}",
            json={"notes": "Observação atualizada"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["notes"] == "Observação atualizada"

    @pytest.mark.asyncio
    async def test_edit_sync_nao_altera_execution_notes(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_owner,
        film_service: Service,
        test_dealership: Dealership,
        appointment_with_film: Appointment,
    ):
        """A ressincronização de campos da O.S. a partir do agendamento (notes,
        vehicle_model, etc.) NÃO deve tocar execution_notes — é um campo
        preenchido só na finalização, pelo instalador, e não vem do agendamento."""
        so = await _make_service_order(
            db_session, test_store.id, OSStatus.IN_PROGRESS.value, film_service.id, test_owner.id
        )
        so.execution_notes = "Relato técnico já registrado"
        appointment_with_film.service_order_id = so.id
        await db_session.commit()

        response = await owner_client.patch(
            f"/api/v1/scheduling/{appointment_with_film.id}",
            json={"notes": "Observação atualizada"},
        )
        assert response.status_code == 200, response.text

        await db_session.refresh(so)
        assert so.notes == "Observação atualizada"
        assert so.execution_notes == "Relato técnico já registrado"

    @pytest.mark.asyncio
    async def test_edit_blocked_when_os_has_film_roll(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_owner,
        film_service: Service,
        test_dealership: Dealership,
        appointment_with_film: Appointment,
    ):
        """Editar agendamento com O.S. que tem film_roll_id deve ser bloqueado (safety)."""
        # Criar O.S. in_progress com film_roll_id atribuído (sem FK real — só ID não-nulo)
        so = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="TST1D23",
            department="film",
            status=OSStatus.IN_PROGRESS.value,
            created_by_id=test_owner.id,
            updated_by_id=test_owner.id,
            photos="[]",
            entry_time=datetime.now(UTC),
        )
        db_session.add(so)
        await db_session.flush()

        # Simular item com film_roll_id != None (usando ID fictício sem FK)
        item = ServiceOrderItem(
            service_order_id=so.id,
            service_id=film_service.id,
            quantity=1,
            unit_price=300.00,
            film_roll_id=None,  # será definido abaixo via update direto
        )
        db_session.add(item)
        await db_session.flush()

        # Atribuir roll_id diretamente para simular bobina atribuída
        # (bypass FK via raw update para o teste funcionar sem bobina real)
        from sqlalchemy import update as sa_update

        await db_session.execute(
            sa_update(ServiceOrderItem)
            .where(ServiceOrderItem.id == item.id)
            .values(film_roll_id=999)
        )

        appointment_with_film.service_order_id = so.id
        await db_session.commit()

        response = await owner_client.patch(
            f"/api/v1/scheduling/{appointment_with_film.id}",
            json={"notes": "Tentativa de edição"},
        )
        assert response.status_code == 422
        detail = response.json()["detail"].lower()
        assert "bobina" in detail or "atribuída" in detail or "consumida" in detail

    @pytest.mark.asyncio
    async def test_edit_allowed_when_os_duplicate(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_owner,
        film_service: Service,
        test_dealership: Dealership,
        appointment_with_film: Appointment,
    ):
        """Editar agendamento com O.S. duplicate deve ser permitido."""
        so = await _make_service_order(
            db_session, test_store.id, OSStatus.DUPLICATE.value, film_service.id, test_owner.id
        )
        appointment_with_film.service_order_id = so.id
        await db_session.commit()

        response = await owner_client.patch(
            f"/api/v1/scheduling/{appointment_with_film.id}",
            json={"notes": "Agendamento com OS duplicada — editável"},
        )
        assert response.status_code == 200, response.text


# ---------------------------------------------------------------------------
# MUDANÇA 3 — cancelar agendamento cancela a O.S. vinculada
# ---------------------------------------------------------------------------


class TestCancelAppointmentCancelsOS:
    @pytest.mark.asyncio
    async def test_cancel_appt_cancels_os_in_progress(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_owner,
        film_service: Service,
        test_dealership: Dealership,
        appointment_with_workshop: Appointment,
        workshop_service: Service,
    ):
        """Cancelar agendamento com O.S. in_progress deve cancelar a O.S. também."""
        so = await _make_service_order(
            db_session,
            test_store.id,
            OSStatus.IN_PROGRESS.value,
            workshop_service.id,
            test_owner.id,
        )
        appointment_with_workshop.service_order_id = so.id
        await db_session.commit()

        import json as _json

        response = await owner_client.request(
            "DELETE",
            f"/api/v1/scheduling/{appointment_with_workshop.id}",
            content=_json.dumps({"cancellation_reason": "Cancelado via teste"}),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["display_status"] == "cancelado"

        # A O.S. deve estar cancelada
        await db_session.refresh(so)
        assert so.status == OSStatus.CANCELLED.value

    @pytest.mark.asyncio
    async def test_cancel_appt_does_not_cancel_completed_os(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_owner,
        film_service: Service,
        test_dealership: Dealership,
        appointment_with_workshop: Appointment,
        workshop_service: Service,
    ):
        """Cancelar agendamento com O.S. completed NÃO deve cancelar a O.S."""
        so = await _make_service_order(
            db_session,
            test_store.id,
            OSStatus.COMPLETED.value,
            workshop_service.id,
            test_owner.id,
        )
        appointment_with_workshop.service_order_id = so.id
        await db_session.commit()

        import json as _json

        response = await owner_client.request(
            "DELETE",
            f"/api/v1/scheduling/{appointment_with_workshop.id}",
            content=_json.dumps({"cancellation_reason": "Cancelado via teste"}),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 200, response.text

        # A O.S. deve PERMANECER completed
        await db_session.refresh(so)
        assert so.status == OSStatus.COMPLETED.value

    @pytest.mark.asyncio
    async def test_cancel_appt_without_os_succeeds(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        appointment_with_workshop: Appointment,
    ):
        """Cancelar agendamento sem O.S. vinculada deve funcionar normalmente."""
        import json as _json

        response = await owner_client.request(
            "DELETE",
            f"/api/v1/scheduling/{appointment_with_workshop.id}",
            content=_json.dumps({"cancellation_reason": "Sem O.S."}),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["display_status"] == "cancelado"

    @pytest.mark.asyncio
    async def test_cancel_appt_cancels_duplicate_os(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_owner,
        workshop_service: Service,
        test_dealership: Dealership,
        appointment_with_workshop: Appointment,
    ):
        """Cancelar agendamento com O.S. duplicate (não-terminal) cancela a O.S."""
        so = await _make_service_order(
            db_session,
            test_store.id,
            OSStatus.DUPLICATE.value,
            workshop_service.id,
            test_owner.id,
        )
        appointment_with_workshop.service_order_id = so.id
        await db_session.commit()

        import json as _json

        response = await owner_client.request(
            "DELETE",
            f"/api/v1/scheduling/{appointment_with_workshop.id}",
            content=_json.dumps({"cancellation_reason": "Cancelar duplicado"}),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 200, response.text

        await db_session.refresh(so)
        assert so.status == OSStatus.CANCELLED.value


# ---------------------------------------------------------------------------
# duplicate-check: exclusão do próprio registro ao editar
# ---------------------------------------------------------------------------


class TestDuplicateCheckExclude:
    """Ao editar um agendamento/O.S., a checagem de duplicidade não pode acusar
    o próprio registro nem a própria O.S. gerada como duplicata."""

    @pytest.mark.asyncio
    async def test_exclude_own_appointment_and_os(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_owner,
        film_service: Service,
    ):
        from datetime import date

        from app.modules.service_orders.service import find_launch_duplicates

        on_date = date(2030, 6, 15)

        # O.S. existente (mesma placa/mês/serviço) + agendamento vinculado
        so = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="DUP1E23",
            department="film",
            status=OSStatus.IN_PROGRESS.value,
            created_by_id=test_owner.id,
            updated_by_id=test_owner.id,
            photos="[]",
            entry_time=datetime.now(UTC),
            service_date=on_date,
        )
        db_session.add(so)
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=so.id,
                service_id=film_service.id,
                quantity=1,
                unit_price=300.00,
            )
        )
        appt = Appointment(
            store_id=test_store.id,
            department="film",
            delivery_date=on_date,
            vehicle_plate="DUP1E23",
            service_ids=[film_service.id],
            status="scheduled",
            service_order_id=so.id,
            created_by_id=test_owner.id,
        )
        db_session.add(appt)
        await db_session.commit()

        common = dict(
            db=db_session,
            user=test_owner,
            plate="DUP1E23",
            on_date=on_date,
            department="film",
            service_ids=[film_service.id],
        )

        # Sem exclusão: acusa a própria O.S. e o próprio agendamento
        res = await find_launch_duplicates(**common)
        assert any(o["id"] == so.id for o in res["service_orders"])
        assert any(a["id"] == appt.id for a in res["appointments"])

        # Com exclusão (edição do próprio registro): não acusa a si mesmo
        res2 = await find_launch_duplicates(
            **common,
            exclude_appointment_id=appt.id,
            exclude_service_order_id=so.id,
        )
        assert all(o["id"] != so.id for o in res2["service_orders"])
        assert all(a["id"] != appt.id for a in res2["appointments"])


# ---------------------------------------------------------------------------
# ALTA-4 — Atomicidade do generate-os (O.S. + status + vínculo num só commit)
# ---------------------------------------------------------------------------


class TestGenerateOSAtomicity:
    """Gerar O.S. a partir do agendamento deve ser atômico e idempotente."""

    @pytest.mark.asyncio
    async def test_generate_os_links_appointment_atomically(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_dealership: Dealership,
        appointment_with_film: Appointment,
    ):
        """Após gerar, a O.S. existe, está in_progress e o agendamento fica vinculado."""
        response = await owner_client.post(
            f"/api/v1/scheduling/{appointment_with_film.id}/generate-os",
            json={"photos": ["http://localhost:8000/uploads/p1.jpg"]},
        )
        assert response.status_code == 201, response.text
        so_id = response.json()["service_order_id"]

        # Vínculo persistido na MESMA transação da criação da O.S.
        await db_session.refresh(appointment_with_film)
        assert appointment_with_film.service_order_id == so_id

        so = (
            await db_session.execute(select(ServiceOrder).where(ServiceOrder.id == so_id))
        ).scalar_one()
        assert so.status == OSStatus.IN_PROGRESS.value

    @pytest.mark.asyncio
    async def test_generate_os_twice_conflicts(
        self,
        owner_client: AsyncClient,
        test_dealership: Dealership,
        appointment_with_film: Appointment,
    ):
        """Segunda geração para o mesmo agendamento é rejeitada (double-submit)."""
        body = {"photos": ["http://localhost:8000/uploads/p1.jpg"]}
        first = await owner_client.post(
            f"/api/v1/scheduling/{appointment_with_film.id}/generate-os", json=body
        )
        assert first.status_code == 201, first.text

        second = await owner_client.post(
            f"/api/v1/scheduling/{appointment_with_film.id}/generate-os", json=body
        )
        assert second.status_code == 409, second.text


# ---------------------------------------------------------------------------
# Busca por placa/O.S. encontra agendamentos FINALIZADOS de meses anteriores
# ---------------------------------------------------------------------------


class TestSearchFindsTerminalAppointments:
    @pytest.mark.asyncio
    async def test_search_ignores_current_month_window_for_finalized(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_owner,
        film_service: Service,
    ):
        """
        Um agendamento FINALIZADO (O.S. completed) com data de entrega em mês
        anterior é ocultado pela janela do mês vigente quando os terminais são
        listados sem busca. Mas ao buscar por placa/O.S. (search), o usuário quer
        aquele carro específico — a janela do mês NÃO deve se aplicar.
        """
        from datetime import date, timedelta

        from app.modules.scheduling.service import list_appointments

        so = await _make_service_order(
            db_session, test_store.id, OSStatus.COMPLETED.value, film_service.id, test_owner.id
        )

        old_delivery = date.today().replace(day=1) - timedelta(days=5)  # mês anterior
        appt = Appointment(
            store_id=test_store.id,
            department="film",
            delivery_date=old_delivery,
            vehicle_plate="OLD9Z99",
            vehicle_model="Corolla",
            service_order_id=so.id,
            status="scheduled",
            created_by_id=test_owner.id,
        )
        db_session.add(appt)
        await db_session.commit()

        # Sem busca: a janela do mês vigente oculta o finalizado de mês anterior
        items, _ = await list_appointments(
            db_session, test_owner, store_id=test_store.id, include_terminal=True
        )
        assert not any(a.vehicle_plate == "OLD9Z99" for a in items)

        # Com busca pela placa: a janela do mês NÃO se aplica → o carro é encontrado
        items, _ = await list_appointments(
            db_session,
            test_owner,
            store_id=test_store.id,
            include_terminal=True,
            search="OLD9Z99",
        )
        found = [a for a in items if a.vehicle_plate == "OLD9Z99"]
        assert len(found) == 1
        assert found[0].display_status == "finalizado"


class TestDetailSurfacesOSApplications:
    """Regressão do 422 "Esta O.S. tem tonalidades por região": o detalhe do
    agendamento passa a entregar as `applications` do ITEM da O.S. vinculada
    (fonte de verdade) mesmo quando o JSON do agendamento não as guarda. Sem
    isso, o front finalizava sem `tonality` na bobina e o backend recusava."""

    @pytest.mark.asyncio
    async def test_detail_uses_os_item_film_applications(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        film_service: Service,
        test_owner,
    ):
        # O.S. em andamento com item multi-tonalidade (film_applications), bobina
        # ainda deferida ao Finalizar (film_roll_id NULL).
        so = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="TNT1A23",
            department="film",
            status="in_progress",
            created_by_id=test_owner.id,
            updated_by_id=test_owner.id,
            photos="[]",
            entry_time=datetime.now(UTC),
        )
        db_session.add(so)
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=so.id,
                service_id=film_service.id,
                quantity=1,
                unit_price=300.00,
                film_roll_id=None,
                film_applications=[
                    {"tonality": "G20", "region": "Portas dianteiras"},
                    {"tonality": "G05", "region": "Portas traseiras"},
                ],
            )
        )
        # Agendamento vinculado à O.S., porém SEM applications no JSON (a divergência).
        appt = Appointment(
            store_id=test_store.id,
            department="film",
            delivery_date=datetime(2030, 6, 15).date(),
            vehicle_plate="TNT1A23",
            film_entries=[{"service_id": film_service.id, "tonality": "G20/G05"}],
            status="scheduled",
            service_order_id=so.id,
            created_by_id=test_owner.id,
        )
        db_session.add(appt)
        await db_session.commit()
        await db_session.refresh(appt)

        resp = await owner_client.get(f"/api/v1/scheduling/{appt.id}")
        assert resp.status_code == 200, resp.text
        fe = resp.json()["film_entries"][0]
        tonalities = {a["tonality"] for a in (fe["applications"] or [])}
        assert tonalities == {"G20", "G05"}
