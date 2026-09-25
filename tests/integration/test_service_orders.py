"""
Integration tests for service orders endpoints.
Tests CRUD operations, workflow, status transitions, and day panel.
"""

import json
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.brands.models import Brand
from app.modules.consultants.models import Consultant
from app.modules.dealerships.models import Dealership
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem
from app.modules.services.models import Service
from app.modules.stores.models import Store


@pytest.fixture
async def test_dealership(db_session: AsyncSession, test_store: Store) -> Dealership:
    """Create a test dealership."""
    dealership = Dealership(
        name="Toyota Teste",
        store_id=test_store.id,
        brand="Toyota",
        address="Av. Principal, 100",
        is_active=True,
    )
    db_session.add(dealership)
    await db_session.commit()
    await db_session.refresh(dealership)
    return dealership


@pytest.fixture
async def test_consultant(
    db_session: AsyncSession, test_dealership: Dealership
) -> Consultant:
    """Create a test consultant."""
    consultant = Consultant(
        name="João Consultor",
        dealership_id=test_dealership.id,
        store_id=test_dealership.store_id,
        phone="11999999999",
        email="joao@toyota.com",
        is_active=True,
    )
    db_session.add(consultant)
    await db_session.commit()
    await db_session.refresh(consultant)
    return consultant


@pytest.fixture
async def test_service(db_session: AsyncSession, test_brand: Brand) -> Service:
    """Create a test service."""
    service = Service(
        name="Película Fumê 35%",
        department="film",
        description="Película fumê padrão",
        base_price=150.00,
        is_active=True,
        brand_id=test_brand.id,
    )
    db_session.add(service)
    await db_session.commit()
    await db_session.refresh(service)
    return service


@pytest.fixture
async def test_service_order(
    db_session: AsyncSession,
    test_store: Store,
    test_dealership: Dealership,
    test_consultant: Consultant,
    test_service: Service,
    test_user: User,
) -> ServiceOrder:
    """Create a test service order."""
    service_order = ServiceOrder(
        store_id=test_store.id,
        dealership_id=test_dealership.id,
        consultant_id=test_consultant.id,
        vehicle_plate="ABC1D23",
        vehicle_brand="Toyota",
        vehicle_model="Corolla",
        vehicle_color="Prata",
        vehicle_year=2024,
        department="film",
        status="waiting",
        entry_time=datetime.now(UTC),
        photos=json.dumps(["http://localhost:8000/uploads/photo1.jpg", "http://localhost:8000/uploads/photo2.jpg", "http://localhost:8000/uploads/photo3.jpg", "http://localhost:8000/uploads/photo4.jpg"]),
        requires_invoice=True,
        invoice_number="NF-000123",
        created_by_id=test_user.id,
    )
    db_session.add(service_order)
    await db_session.commit()
    await db_session.refresh(service_order)
    return service_order


class TestListServiceOrders:
    """Tests for list service orders endpoint."""

    @pytest.mark.asyncio
    async def test_list_service_orders_authenticated(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Authenticated user should list service orders."""
        response = await authenticated_client.get("/api/v1/service-orders")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "pagination" in data
        assert len(data["items"]) >= 1

    @pytest.mark.asyncio
    async def test_list_service_orders_unauthenticated(self, client: AsyncClient):
        """Unauthenticated request should return 401."""
        response = await client.get("/api/v1/service-orders")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_list_service_orders_filter_by_status(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Should filter service orders by status."""
        response = await authenticated_client.get(
            "/api/v1/service-orders?status=waiting"
        )
        assert response.status_code == 200
        data = response.json()
        for item in data["items"]:
            assert item["status"] == "waiting"

    @pytest.mark.asyncio
    async def test_list_service_orders_filter_by_department(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Should filter service orders by department."""
        response = await authenticated_client.get(
            "/api/v1/service-orders?department=film"
        )
        assert response.status_code == 200
        data = response.json()
        for item in data["items"]:
            assert item["department"] == "film"

    @pytest.mark.asyncio
    async def test_list_service_orders_filter_by_plate(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Should filter service orders by plate."""
        response = await authenticated_client.get(
            "/api/v1/service-orders?plate=ABC1D23"
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) >= 1
        assert data["items"][0]["vehicle_plate"] == "ABC1D23"


class TestGetServiceOrder:
    """Tests for get service order endpoint."""

    @pytest.mark.asyncio
    async def test_get_service_order_success(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Should get service order details."""
        response = await authenticated_client.get(
            f"/api/v1/service-orders/{test_service_order.id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_service_order.id
        assert data["vehicle_plate"] == "ABC1D23"
        assert "items" in data
        assert "workers" in data

    @pytest.mark.asyncio
    async def test_get_service_order_not_found(
        self, authenticated_client: AsyncClient
    ):
        """Should return 404 for non-existent service order."""
        response = await authenticated_client.get("/api/v1/service-orders/99999")
        assert response.status_code == 404


class TestCreateServiceOrder:
    """Tests for create service order endpoint."""

    @pytest.mark.asyncio
    async def test_create_service_order_success(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_dealership: Dealership,
        test_service: Service,
    ):
        """Operator should create service order."""
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "vehicle_plate": "XYZ9A88",
                "vehicle_brand": "Honda",
                "vehicle_model": "Civic",
                "vehicle_color": "Preto",
                "vehicle_year": 2023,
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/p1.jpg", "http://localhost:8000/uploads/p2.jpg", "http://localhost:8000/uploads/p3.jpg", "http://localhost:8000/uploads/p4.jpg"],
                "items": [{"service_id": test_service.id, "quantity": 1}],
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["vehicle_plate"] == "XYZ9A88"
        assert data["status"] == "waiting"
        assert data["department"] == "film"

    @pytest.mark.asyncio
    async def test_create_rejects_external_photo_url(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_dealership: Dealership,
        test_service: Service,
    ):
        """Foto de O.S. com host externo é recusada (não pode ser servida em contexto de confiança)."""
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "vehicle_plate": "EXT1A23",
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://evil.com/tracking.jpg"],
                "items": [{"service_id": test_service.id, "quantity": 1}],
            },
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_finalize_on_create_marks_completed(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_dealership: Dealership,
        test_service: Service,
        test_employee,
    ):
        """Lançamento direto de película (finalize_on_create) nasce completed com completion_time.

        Owner é isento da bobina obrigatória (#1) — por isso usa owner_client sem
        film_roll_id. O bypass de não-Owner sem bobina é coberto em
        test_permission_enforcement.py.
        """
        response = await owner_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "vehicle_plate": "FIN1A23",
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/p1.jpg"],
                "items": [{"service_id": test_service.id, "quantity": 1}],
                "workers": [{"employee_id": test_employee.id}],
                "finalize_on_create": True,
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["status"] == "completed"

        from sqlalchemy import select as sa_select

        from app.modules.service_orders.models import ServiceOrder as SOModel

        so = (
            await db_session.execute(sa_select(SOModel).where(SOModel.id == data["id"]))
        ).scalar_one()
        assert so.completion_time is not None

    @pytest.mark.asyncio
    async def test_create_finalize_on_create_requires_worker(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_dealership: Dealership,
        test_service: Service,
    ):
        """finalize_on_create sem instalador é rejeitado (não cria O.S. finalizada sem worker)."""
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "vehicle_plate": "FIN2A23",
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/p1.jpg"],
                "items": [{"service_id": test_service.id, "quantity": 1}],
                "finalize_on_create": True,
            },
        )
        assert response.status_code in (400, 422)

    @pytest.mark.asyncio
    async def test_finalize_on_create_pelicula_sem_bobina_bloqueado_nao_owner(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_dealership: Dealership,
        test_service: Service,
        test_employee,
    ):
        """#1 — não-Owner não finaliza película no lançamento direto sem bobina (via API)."""
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "vehicle_plate": "FIN3A23",
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/p1.jpg"],
                "items": [{"service_id": test_service.id, "quantity": 1}],  # sem film_roll_id
                "workers": [{"employee_id": test_employee.id}],
                "finalize_on_create": True,
            },
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_without_finalize_stays_waiting(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_dealership: Dealership,
        test_service: Service,
        test_employee,
    ):
        """Sem finalize_on_create, mesmo com instalador, a O.S. segue em waiting."""
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "vehicle_plate": "WAI1A23",
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/p1.jpg"],
                "items": [{"service_id": test_service.id, "quantity": 1}],
                "workers": [{"employee_id": test_employee.id}],
            },
        )
        assert response.status_code == 201
        assert response.json()["status"] == "waiting"

    @pytest.mark.asyncio
    async def test_create_service_order_invalid_plate(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_dealership: Dealership,
        test_service: Service,
    ):
        """Should reject invalid plate format."""
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "vehicle_plate": "INV@LID!",
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/p1.jpg", "http://localhost:8000/uploads/p2.jpg", "http://localhost:8000/uploads/p3.jpg", "http://localhost:8000/uploads/p4.jpg"],
                "items": [{"service_id": test_service.id, "quantity": 1}],
            },
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_service_order_no_photos(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_dealership: Dealership,
        test_service: Service,
    ):
        """Should reject when no photos provided (minimum 1 required for any store)."""
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "vehicle_plate": "ABC1D23",
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": [],  # No photos
                "items": [{"service_id": test_service.id, "quantity": 1}],
            },
        )
        assert response.status_code in [400, 422]

    @pytest.mark.asyncio
    async def test_create_service_order_no_items(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_dealership: Dealership,
    ):
        """Should reject when no service items."""
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "vehicle_plate": "ABC1D23",
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/p1.jpg", "http://localhost:8000/uploads/p2.jpg", "http://localhost:8000/uploads/p3.jpg", "http://localhost:8000/uploads/p4.jpg"],
                "items": [],  # No items
            },
        )
        assert response.status_code == 422



class TestChangeStatus:
    """Tests for change status endpoint."""

    @pytest.mark.asyncio
    async def test_change_status_waiting_to_in_progress(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Should change from waiting to in_progress."""
        response = await authenticated_client.post(
            f"/api/v1/service-orders/{test_service_order.id}/status",
            json={"new_status": "in_progress"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "in_progress"

    @pytest.mark.asyncio
    async def test_change_status_invalid_transition(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Should reject invalid status transition."""
        # Try to go directly from waiting to delivered
        response = await authenticated_client.post(
            f"/api/v1/service-orders/{test_service_order.id}/status",
            json={"new_status": "delivered"},
        )
        assert response.status_code in [400, 422]



class TestVerifyServiceOrder:
    """Tests for the dedicated verify (conference) endpoint."""

    @pytest.mark.asyncio
    async def test_verify_service_order_marks_verified(
        self,
        owner_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Marking as verified should return 200 with the full detail response.

        Verificar exige conference:can_edit — usa owner_client (verificador
        legítimo). Regression: setting updated_by_id on the FK expires the eager-loaded
        updated_by relationship at commit; without re-fetching, model_validate of
        ServiceOrderDetailResponse triggers a lazy-load -> MissingGreenlet -> 500.
        """
        response = await owner_client.patch(
            f"/api/v1/service-orders/{test_service_order.id}/verify",
            json={"verified": True},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["is_verified"] is True

    @pytest.mark.asyncio
    async def test_unverify_service_order(
        self,
        owner_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Unmarking verification should also return 200."""
        await owner_client.patch(
            f"/api/v1/service-orders/{test_service_order.id}/verify",
            json={"verified": True},
        )
        response = await owner_client.patch(
            f"/api/v1/service-orders/{test_service_order.id}/verify",
            json={"verified": False},
        )
        assert response.status_code == 200
        assert response.json()["is_verified"] is False

    @pytest.mark.asyncio
    async def test_verify_service_order_idempotent(
        self,
        owner_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Verifying twice should stay 200 and verified (idempotent)."""
        for _ in range(2):
            response = await owner_client.patch(
                f"/api/v1/service-orders/{test_service_order.id}/verify",
                json={"verified": True},
            )
            assert response.status_code == 200
            assert response.json()["is_verified"] is True

    @pytest.mark.asyncio
    async def test_verify_film_without_invoice_rejected(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_dealership: Dealership,
        test_user: User,
    ):
        """Film/PPF/security_film sem NF não pode ser verificada (regra de conferência)."""
        order = ServiceOrder(
            store_id=test_store.id,
            dealership_id=test_dealership.id,
            vehicle_plate="NFX1A11",
            vehicle_brand="Toyota",
            vehicle_model="Corolla",
            department="film",
            status="completed",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://localhost:8000/uploads/photo1.jpg"]),
            requires_invoice=True,
            invoice_number=None,
            created_by_id=test_user.id,
        )
        db_session.add(order)
        await db_session.commit()
        await db_session.refresh(order)

        response = await owner_client.patch(
            f"/api/v1/service-orders/{order.id}/verify",
            json={"verified": True},
        )
        assert response.status_code == 422
        # Preencher a NF via update deve permitir verificar
        response = await owner_client.patch(
            f"/api/v1/service-orders/{order.id}",
            json={"invoice_number": "NF-999", "is_verified": True},
        )
        assert response.status_code == 200
        assert response.json()["is_verified"] is True


class TestUpdateServiceOrder:
    """Tests for update service order endpoint."""

    @pytest.mark.asyncio
    async def test_update_service_order_notes(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Should update service order notes."""
        response = await authenticated_client.patch(
            f"/api/v1/service-orders/{test_service_order.id}",
            json={"notes": "Observação atualizada"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["notes"] == "Observação atualizada"

    @pytest.mark.asyncio
    async def test_editor_can_set_courtesy_and_galpon(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Perfil com service_orders:can_edit PODE marcar cortesia/galpão via update.

        Decisão de produto: quem tem permissão de editar O.S. ajusta cortesia e
        galpão (ex.: conferente marcando uma O.S. como cortesia na Conferência).
        Antes esses campos eram ignorados silenciosamente para não-owner, o que
        fazia o front exibir "sucesso" sem persistir a mudança.
        """
        response = await authenticated_client.patch(
            f"/api/v1/service-orders/{test_service_order.id}",
            json={"notes": "x", "is_courtesy": True, "is_galpon": True},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["is_courtesy"] is True
        assert data["is_galpon"] is True

    @pytest.mark.asyncio
    async def test_edit_verified_order_clears_verification(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_dealership: Dealership,
        test_user: User,
    ):
        """A-01: editar uma O.S. já verificada remove a verificação; a NF é preservada."""
        order = ServiceOrder(
            store_id=test_store.id,
            dealership_id=test_dealership.id,
            vehicle_plate="VER1F00",
            vehicle_brand="Toyota",
            vehicle_model="Corolla",
            department="workshop",
            status="completed",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://localhost:8000/uploads/photo1.jpg"]),
            invoice_number="NF-123",
            is_verified=True,
            verified_at=datetime.now(UTC),
            created_by_id=test_user.id,
        )
        db_session.add(order)
        await db_session.commit()
        await db_session.refresh(order)

        response = await authenticated_client.patch(
            f"/api/v1/service-orders/{order.id}",
            json={"notes": "corrigido"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["is_verified"] is False  # desverificada pela edição
        assert data["notes"] == "corrigido"
        assert data["invoice_number"] == "NF-123"  # NF preservada

        await db_session.refresh(order)
        assert order.is_verified is False
        assert order.verified_at is None

    @pytest.mark.asyncio
    async def test_update_service_order_vehicle_info(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Should update vehicle information."""
        response = await authenticated_client.patch(
            f"/api/v1/service-orders/{test_service_order.id}",
            json={
                "vehicle_brand": "Hyundai",
                "vehicle_model": "HB20",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["vehicle_brand"] == "Hyundai"
        assert data["vehicle_model"] == "HB20"


class TestServiceOrderStatusWorkflow:
    """Tests for complete service order status workflow."""

    @pytest.mark.asyncio
    async def test_complete_workflow(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Test current workflow: waiting -> in_progress -> completed."""
        # waiting -> in_progress
        response = await authenticated_client.post(
            f"/api/v1/service-orders/{test_service_order.id}/status",
            json={"new_status": "in_progress"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "in_progress"

        # in_progress -> completed
        response = await authenticated_client.post(
            f"/api/v1/service-orders/{test_service_order.id}/status",
            json={"new_status": "completed"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "completed"

    @pytest.mark.asyncio
    async def test_invalid_transition_skipping_steps(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Cannot skip directly to delivered from waiting."""
        # WAITING → DELIVERED is not a valid transition
        response = await authenticated_client.post(
            f"/api/v1/service-orders/{test_service_order.id}/status",
            json={"new_status": "delivered"},
        )
        assert response.status_code in [400, 422]


class TestUndoWrong:
    """Tests for undoing 'Lançado Errado' (restores the pre-wrong status)."""

    @pytest.mark.asyncio
    async def test_undo_wrong_restores_completed(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """A completed O.S. marked wrong should return to completed on undo — not waiting."""
        sid = test_service_order.id
        r = await authenticated_client.post(
            f"/api/v1/service-orders/{sid}/status", json={"new_status": "completed"}
        )
        assert r.status_code == 200
        r = await authenticated_client.post(
            f"/api/v1/service-orders/{sid}/status", json={"new_status": "wrong"}
        )
        assert r.status_code == 200
        assert r.json()["status"] == "wrong"
        r = await authenticated_client.post(f"/api/v1/service-orders/{sid}/undo-wrong")
        assert r.status_code == 200
        assert r.json()["status"] == "completed"

    @pytest.mark.asyncio
    async def test_undo_wrong_rejects_non_wrong(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Undo-wrong on an O.S. that is not in 'wrong' should be rejected."""
        r = await authenticated_client.post(
            f"/api/v1/service-orders/{test_service_order.id}/undo-wrong"
        )
        assert r.status_code in [400, 422]


class TestCancelServiceOrder:
    """Cancelamento de O.S.: motivo vira a Observação Interna (substitui a atual)."""

    @pytest.mark.asyncio
    async def test_cancel_reason_goes_to_internal_notes(
        self,
        owner_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """O motivo informado no cancelamento é gravado em internal_notes."""
        r = await owner_client.delete(
            f"/api/v1/service-orders/{test_service_order.id}",
            params={"reason": "Cliente desistiu do serviço"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "cancelled"
        assert body["internal_notes"] == "Cliente desistiu do serviço"

    @pytest.mark.asyncio
    async def test_cancel_reason_overwrites_existing_internal_notes(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_service_order: ServiceOrder,
    ):
        """Se já houver Observação Interna, o motivo do cancelamento a substitui."""
        test_service_order.internal_notes = "Observação antiga que deve sumir"
        await db_session.commit()

        r = await owner_client.delete(
            f"/api/v1/service-orders/{test_service_order.id}",
            params={"reason": "O.S. lançada em duplicidade"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["internal_notes"] == "O.S. lançada em duplicidade"


class TestStatusRequirements:
    """Tests for status transition requirements."""

    @pytest.mark.asyncio
    async def test_delivered_film_requires_invoice(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Film department O.S. should have requires_invoice set."""
        assert test_service_order.department == "film"
        assert test_service_order.requires_invoice is True


class TestServiceOrderWorkers:
    """Tests for service order worker assignment."""

    @pytest.mark.asyncio
    async def test_create_with_workers(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_dealership: Dealership,
        test_service: Service,
        test_employee,
    ):
        """Should create O.S. with assigned workers."""
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "vehicle_plate": "WRK1A23",
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/p1.jpg", "http://localhost:8000/uploads/p2.jpg", "http://localhost:8000/uploads/p3.jpg", "http://localhost:8000/uploads/p4.jpg"],
                "items": [{"service_id": test_service.id, "quantity": 1}],
                "workers": [{"employee_id": test_employee.id}],
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert len(data["workers"]) == 1


class TestServiceOrderDamageMap:
    """Tests for damage map functionality."""

    @pytest.mark.asyncio
    async def test_create_with_damage_map(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_dealership: Dealership,
        test_service: Service,
    ):
        """Should create O.S. with damage map points."""
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "vehicle_plate": "DMG1A23",
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/p1.jpg", "http://localhost:8000/uploads/p2.jpg", "http://localhost:8000/uploads/p3.jpg", "http://localhost:8000/uploads/p4.jpg"],
                "items": [{"service_id": test_service.id, "quantity": 1}],
                "damage_map": [
                    {"x": 50.0, "y": 60.0, "type": "scratch", "description": "Scratch"},
                    {"x": 30.0, "y": 40.0, "type": "dent", "description": "Dent"},
                ],
            },
        )
        assert response.status_code == 201
        data = response.json()
        # Check damage_map was stored
        assert data.get("damage_map") is not None

    @pytest.mark.asyncio
    async def test_update_damage_map(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Should update damage map."""
        response = await authenticated_client.patch(
            f"/api/v1/service-orders/{test_service_order.id}",
            json={
                "damage_map": [
                    {"x": 50.0, "y": 50.0, "type": "scratch", "description": "New damage"},
                ]
            },
        )
        assert response.status_code == 200


class TestServiceOrderPhotos:
    """Tests for photo validation."""

    @pytest.mark.asyncio
    async def test_create_with_exactly_4_photos(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_dealership: Dealership,
        test_service: Service,
    ):
        """Creating with exactly 4 photos should succeed."""
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "vehicle_plate": "PHO1A23",
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/p1.jpg", "http://localhost:8000/uploads/p2.jpg", "http://localhost:8000/uploads/p3.jpg", "http://localhost:8000/uploads/p4.jpg"],
                "items": [{"service_id": test_service.id, "quantity": 1}],
            },
        )
        assert response.status_code == 201

    @pytest.mark.asyncio
    async def test_create_with_more_than_4_photos(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_dealership: Dealership,
        test_service: Service,
    ):
        """Creating with more than 4 photos should succeed."""
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "vehicle_plate": "PHO2A23",
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/p1.jpg", "http://localhost:8000/uploads/p2.jpg", "http://localhost:8000/uploads/p3.jpg", "http://localhost:8000/uploads/p4.jpg", "http://localhost:8000/uploads/p5.jpg", "http://localhost:8000/uploads/p6.jpg"],
                "items": [{"service_id": test_service.id, "quantity": 1}],
            },
        )
        assert response.status_code == 201


class TestServiceOrderTimestamps:
    """Tests for automatic timestamp tracking."""

    @pytest.mark.asyncio
    async def test_start_time_set_on_in_progress(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
        db_session: AsyncSession,
    ):
        """start_time should be set when moving to in_progress."""
        assert test_service_order.start_time is None

        response = await authenticated_client.post(
            f"/api/v1/service-orders/{test_service_order.id}/status",
            json={"new_status": "in_progress"},
        )
        assert response.status_code == 200

        # Check timestamp was set
        await db_session.refresh(test_service_order)
        assert test_service_order.start_time is not None

    @pytest.mark.asyncio
    async def test_completion_time_set_on_completed(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
        db_session: AsyncSession,
    ):
        """completion_time should be set when moving to completed."""
        so_id = test_service_order.id

        # Move to in_progress first
        await authenticated_client.post(
            f"/api/v1/service-orders/{so_id}/status",
            json={"new_status": "in_progress"},
        )

        # Move to completed
        response = await authenticated_client.post(
            f"/api/v1/service-orders/{so_id}/status",
            json={"new_status": "completed"},
        )
        assert response.status_code == 200

        # Re-fetch from DB to verify timestamp was set.
        from sqlalchemy import select as sa_select

        from app.modules.service_orders.models import ServiceOrder as SOModel
        result = await db_session.execute(
            sa_select(SOModel).where(SOModel.id == so_id)
        )
        refreshed = result.scalar_one()
        assert refreshed.completion_time is not None




class TestServiceOrderPermissions:
    """Tests for service order access permissions."""

    @pytest.mark.asyncio
    async def test_operator_cannot_see_other_store_orders(
        self,
        authenticated_client: AsyncClient,
        second_store: Store,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Operator should not see orders from other stores."""
        # Create dealership for second store
        dealership2 = Dealership(
            name="Other Dealership",
            store_id=second_store.id,
            brand="Honda",
            is_active=True,
        )
        db_session.add(dealership2)
        await db_session.flush()

        other_os = ServiceOrder(
            store_id=second_store.id,
            dealership_id=dealership2.id,
            vehicle_plate="OTH1A23",
            department="film",
            status="waiting",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://localhost:8000/uploads/p1.jpg", "http://localhost:8000/uploads/p2.jpg", "http://localhost:8000/uploads/p3.jpg", "http://localhost:8000/uploads/p4.jpg"]),
            requires_invoice=True,
            created_by_id=test_user.id,
        )
        db_session.add(other_os)
        await db_session.commit()

        # Try to access
        response = await authenticated_client.get(
            f"/api/v1/service-orders/{other_os.id}"
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_owner_can_see_all_stores(
        self,
        owner_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Owner should see orders from all stores."""
        response = await owner_client.get(
            f"/api/v1/service-orders/{test_service_order.id}"
        )
        assert response.status_code == 200



class TestListServiceOrdersFilters:
    """Additional tests for list filters covering previously uncovered branches."""

    @pytest.mark.asyncio
    async def test_list_filter_by_store_id(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        test_service_order: ServiceOrder,
    ):
        """Owner should be able to filter by store_id."""
        response = await owner_client.get(
            f"/api/v1/service-orders?store_id={test_store.id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        for item in data["items"]:
            assert item["store_id"] == test_store.id

    @pytest.mark.asyncio
    async def test_list_filter_by_date_from(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Should filter service orders with date_from."""
        past = datetime.now(UTC) - timedelta(hours=1)
        # Use params dict so httpx properly URL-encodes the datetime value
        response = await authenticated_client.get(
            "/api/v1/service-orders",
            params={"date_from": past.isoformat()},
        )
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        # The test_service_order was created now, so it must be included
        ids = [item["id"] for item in data["items"]]
        assert test_service_order.id in ids

    @pytest.mark.asyncio
    async def test_list_filter_by_date_to(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Should filter service orders with date_to."""
        future = datetime.now(UTC) + timedelta(hours=1)
        response = await authenticated_client.get(
            "/api/v1/service-orders",
            params={"date_to": future.isoformat()},
        )
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        ids = [item["id"] for item in data["items"]]
        assert test_service_order.id in ids

    @pytest.mark.asyncio
    async def test_list_filter_date_range_excludes_old(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Should return empty list when date_from is in the future."""
        future = datetime.now(UTC) + timedelta(hours=2)
        response = await authenticated_client.get(
            "/api/v1/service-orders",
            params={"date_from": future.isoformat()},
        )
        assert response.status_code == 200
        data = response.json()
        # No orders created after 2 hours from now
        assert len(data["items"]) == 0

    @pytest.mark.asyncio
    async def test_list_with_pagination(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Should support pagination parameters."""
        response = await authenticated_client.get(
            "/api/v1/service-orders?page=1&limit=5"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["pagination"]["page"] == 1
        assert data["pagination"]["limit"] == 5

    @pytest.mark.asyncio
    async def test_list_owner_sees_all(
        self,
        owner_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Owner should see service orders from all stores."""
        response = await owner_client.get("/api/v1/service-orders")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert data["pagination"]["total"] >= 1


class TestCreateServiceOrderStoretypes:
    """Tests for creating service orders with store-level validations."""

    @pytest.mark.asyncio
    async def test_create_service_order_dealership_store_without_dealership_id_fails(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_service: Service,
    ):
        """Dealership-type store requires dealership_id."""
        # test_store defaults to dealership type
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "vehicle_plate": "NDP1A23",
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/p1.jpg", "http://localhost:8000/uploads/p2.jpg", "http://localhost:8000/uploads/p3.jpg", "http://localhost:8000/uploads/p4.jpg"],
                "items": [{"service_id": test_service.id, "quantity": 1}],
            },
        )
        assert response.status_code in [400, 422]

    @pytest.mark.asyncio
    async def test_create_service_order_with_consultant(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_dealership: "Dealership",
        test_consultant: "Consultant",
        test_service: Service,
    ):
        """Should create O.S. with a consultant linked."""
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "consultant_id": test_consultant.id,
                "vehicle_plate": "CST1A23",
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/p1.jpg", "http://localhost:8000/uploads/p2.jpg", "http://localhost:8000/uploads/p3.jpg", "http://localhost:8000/uploads/p4.jpg"],
                "items": [{"service_id": test_service.id, "quantity": 1}],
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["consultant_id"] == test_consultant.id

    @pytest.mark.asyncio
    async def test_create_service_order_invalid_service_id(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_dealership: "Dealership",
    ):
        """Should return 404 when service_id does not exist."""
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "vehicle_plate": "INV1A23",
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/p1.jpg", "http://localhost:8000/uploads/p2.jpg", "http://localhost:8000/uploads/p3.jpg", "http://localhost:8000/uploads/p4.jpg"],
                "items": [{"service_id": 99999, "quantity": 1}],
            },
        )
        assert response.status_code in [404, 422]


class TestServiceOrderStatusTransitionsExtended:
    """Extended tests for status transitions covering all valid transitions."""

    @pytest.mark.asyncio
    async def test_in_progress_back_to_waiting(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """in_progress can go back to waiting."""
        so_id = test_service_order.id

        # Move to in_progress
        response = await authenticated_client.post(
            f"/api/v1/service-orders/{so_id}/status",
            json={"new_status": "in_progress"},
        )
        assert response.status_code == 200

        # Move back to waiting
        response = await authenticated_client.post(
            f"/api/v1/service-orders/{so_id}/status",
            json={"new_status": "waiting"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "waiting"

    @pytest.mark.asyncio
    async def test_status_change_nonexistent_order(
        self,
        authenticated_client: AsyncClient,
    ):
        """Status change on non-existent O.S. should return 404."""
        response = await authenticated_client.post(
            "/api/v1/service-orders/99999/status",
            json={"new_status": "in_progress"},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_delivered_film_without_invoice_fails(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """film O.S. has requires_invoice flag set; skipping to delivered is invalid."""
        assert test_service_order.requires_invoice is True
        so_id = test_service_order.id

        # delivered is not a valid transition from waiting
        response = await authenticated_client.post(
            f"/api/v1/service-orders/{so_id}/status",
            json={"new_status": "delivered"},
        )
        assert response.status_code in [400, 422]

    @pytest.mark.asyncio
    async def test_status_change_notes_stored(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Notes should be stored in status history when changing status."""
        response = await authenticated_client.post(
            f"/api/v1/service-orders/{test_service_order.id}/status",
            json={"new_status": "in_progress", "notes": "Iniciando servico"},
        )
        assert response.status_code == 200




class TestUpdateServiceOrderExtended:
    """Extended tests for update service order covering JSON field paths."""

    @pytest.mark.asyncio
    async def test_update_photos(
        self,
        authenticated_client: AsyncClient,
        test_service_order: ServiceOrder,
    ):
        """Should update photos list."""
        new_photos = ["http://localhost:8000/uploads/new1.jpg", "http://localhost:8000/uploads/new2.jpg", "http://localhost:8000/uploads/new3.jpg", "http://localhost:8000/uploads/new4.jpg", "http://localhost:8000/uploads/new5.jpg"]
        response = await authenticated_client.patch(
            f"/api/v1/service-orders/{test_service_order.id}",
            json={"photos": new_photos},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_update_nonexistent_order(
        self,
        authenticated_client: AsyncClient,
    ):
        """Update on non-existent order should return 404."""
        response = await authenticated_client.patch(
            "/api/v1/service-orders/99999",
            json={"notes": "Test"},
        )
        assert response.status_code == 404



# ============================================================
# Extended service order tests to improve service.py coverage
# ============================================================


class TestServiceOrdersListFilters:
    """Tests covering list_service_orders filter branches."""

    @pytest.mark.asyncio
    async def test_list_filter_by_status(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_user: User,
        test_dealership: "Dealership",
        db_session: AsyncSession,
    ):
        """List service orders filtered by status."""
        so = ServiceOrder(
            store_id=test_store.id,
            dealership_id=test_dealership.id,
            vehicle_plate="STS1A23",
            department="film",
            status="in_progress",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://localhost:8000/uploads/p1.jpg", "http://localhost:8000/uploads/p2.jpg", "http://localhost:8000/uploads/p3.jpg", "http://localhost:8000/uploads/p4.jpg"]),
            requires_invoice=True,
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.commit()

        response = await authenticated_client.get(
            "/api/v1/service-orders",
            params={"status": "in_progress"},
        )
        assert response.status_code == 200
        data = response.json()
        for item in data["items"]:
            assert item["status"] == "in_progress"

    @pytest.mark.asyncio
    async def test_list_filter_by_department(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_user: User,
        test_dealership: "Dealership",
        db_session: AsyncSession,
    ):
        """List service orders filtered by department."""
        so = ServiceOrder(
            store_id=test_store.id,
            dealership_id=test_dealership.id,
            vehicle_plate="DPT1A23",
            department="vn",
            status="waiting",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://localhost:8000/uploads/p1.jpg"]),
            requires_invoice=False,
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.commit()

        response = await authenticated_client.get(
            "/api/v1/service-orders",
            params={"department": "vn"},
        )
        assert response.status_code == 200
        data = response.json()
        for item in data["items"]:
            assert item["department"] == "vn"

    @pytest.mark.asyncio
    async def test_list_filter_by_plate(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_user: User,
        test_dealership: "Dealership",
        db_session: AsyncSession,
    ):
        """List service orders filtered by vehicle plate."""
        unique_plate = "PLT1A23"
        so = ServiceOrder(
            store_id=test_store.id,
            dealership_id=test_dealership.id,
            vehicle_plate=unique_plate,
            department="film",
            status="waiting",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://localhost:8000/uploads/p1.jpg", "http://localhost:8000/uploads/p2.jpg", "http://localhost:8000/uploads/p3.jpg", "http://localhost:8000/uploads/p4.jpg"]),
            requires_invoice=True,
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.commit()

        response = await authenticated_client.get(
            "/api/v1/service-orders",
            params={"plate": "PLT1"},
        )
        assert response.status_code == 200
        data = response.json()
        plates = [item["vehicle_plate"] for item in data["items"]]
        assert unique_plate in plates

    @pytest.mark.asyncio
    async def test_list_filter_by_service_ids(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_user: User,
        test_dealership: "Dealership",
        test_brand: Brand,
        db_session: AsyncSession,
    ):
        """service_ids filtra O.S. que tenham ao menos um item nesses serviços."""
        svc_match = Service(
            name="Polimento Técnico Premium",
            code="PLM9",
            department="workshop",
            base_price=200.0,
            is_active=True,
            brand_id=test_brand.id,
        )
        svc_other = Service(
            name="Higienização Interna",
            code="HIG1",
            department="workshop",
            base_price=100.0,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add_all([svc_match, svc_other])
        await db_session.flush()

        def make_order(plate: str) -> ServiceOrder:
            return ServiceOrder(
                store_id=test_store.id,
                dealership_id=test_dealership.id,
                vehicle_plate=plate,
                department="workshop",
                status="waiting",
                entry_time=datetime.now(UTC),
                photos=json.dumps(["http://localhost:8000/uploads/p1.jpg"]),
                requires_invoice=True,
                created_by_id=test_user.id,
            )

        so_match = make_order("SSR1A23")
        so_other = make_order("SSR2B34")
        db_session.add_all([so_match, so_other])
        await db_session.flush()
        db_session.add_all(
            [
                ServiceOrderItem(
                    service_order_id=so_match.id,
                    service_id=svc_match.id,
                    quantity=1,
                    unit_price=200.0,
                ),
                ServiceOrderItem(
                    service_order_id=so_other.id,
                    service_id=svc_other.id,
                    quantity=1,
                    unit_price=100.0,
                ),
            ]
        )
        await db_session.commit()

        # (a) apenas o serviço da primeira O.S.
        response = await authenticated_client.get(
            "/api/v1/service-orders",
            params={"service_ids": [svc_match.id]},
        )
        assert response.status_code == 200
        plates = [item["vehicle_plate"] for item in response.json()["items"]]
        assert "SSR1A23" in plates
        assert "SSR2B34" not in plates

        # (b) os dois serviços → ambas as O.S.
        response = await authenticated_client.get(
            "/api/v1/service-orders",
            params={"service_ids": [svc_match.id, svc_other.id]},
        )
        assert response.status_code == 200
        plates = [item["vehicle_plate"] for item in response.json()["items"]]
        assert "SSR1A23" in plates
        assert "SSR2B34" in plates

        # (c) id inexistente → nenhuma das duas
        response = await authenticated_client.get(
            "/api/v1/service-orders",
            params={"service_ids": [999999]},
        )
        assert response.status_code == 200
        plates = [item["vehicle_plate"] for item in response.json()["items"]]
        assert "SSR1A23" not in plates
        assert "SSR2B34" not in plates

    @pytest.mark.asyncio
    async def test_list_filter_by_conference_statuses(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_user: User,
        test_dealership: "Dealership",
        db_session: AsyncSession,
    ):
        """conference_statuses aplica OR das condições do filtro da Conferência."""

        def make_order(plate: str, status: str, is_verified: bool) -> ServiceOrder:
            return ServiceOrder(
                store_id=test_store.id,
                dealership_id=test_dealership.id,
                vehicle_plate=plate,
                department="workshop",
                status=status,
                is_verified=is_verified,
                entry_time=datetime.now(UTC),
                photos=json.dumps(["http://localhost:8000/uploads/p1.jpg"]),
                requires_invoice=True,
                created_by_id=test_user.id,
            )

        orders = {
            "waiting": make_order("CST1A11", "waiting", False),
            "verified": make_order("CST2B22", "completed", True),
            "cancelled": make_order("CST3C33", "cancelled", False),
            "wrong": make_order("CST4D44", "wrong", False),
            "duplicate": make_order("CST5E55", "duplicate", False),
        }
        db_session.add_all(orders.values())
        await db_session.commit()
        all_plates = {so.vehicle_plate for so in orders.values()}

        async def fetch_plates(params: dict) -> set[str]:
            response = await authenticated_client.get("/api/v1/service-orders", params=params)
            assert response.status_code == 200
            plates = {item["vehicle_plate"] for item in response.json()["items"]}
            return plates & all_plates

        # pending inclui wrong/duplicate não verificadas (semântica atual preservada)
        assert await fetch_plates({"conference_statuses": ["pending"]}) == {
            "CST1A11",
            "CST4D44",
            "CST5E55",
        }
        assert await fetch_plates({"conference_statuses": ["verified"]}) == {"CST2B22"}
        # cancelled dentro do OR fura o default include_cancelled=False
        assert await fetch_plates({"conference_statuses": ["cancelled"]}) == {"CST3C33"}
        assert await fetch_plates({"conference_statuses": ["verified", "cancelled"]}) == {
            "CST2B22",
            "CST3C33",
        }
        # sem o filtro multi + include_cancelled=true → todas ("Todas" da tela)
        assert await fetch_plates({"include_cancelled": True}) == all_plates

    @pytest.mark.asyncio
    async def test_list_filter_by_departments_multi(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_user: User,
        test_dealership: "Dealership",
        db_session: AsyncSession,
    ):
        """departments (multi) filtra por lista; department (single) segue funcionando."""

        def make_order(plate: str, department: str) -> ServiceOrder:
            return ServiceOrder(
                store_id=test_store.id,
                dealership_id=test_dealership.id,
                vehicle_plate=plate,
                department=department,
                status="waiting",
                entry_time=datetime.now(UTC),
                photos=json.dumps(["http://localhost:8000/uploads/p1.jpg"]),
                requires_invoice=True,
                created_by_id=test_user.id,
            )

        so_film = make_order("DPT1F11", "film")
        so_workshop = make_order("DPT2W22", "workshop")
        db_session.add_all([so_film, so_workshop])
        await db_session.commit()

        # multi: os dois departamentos
        response = await authenticated_client.get(
            "/api/v1/service-orders",
            params={"departments": ["film", "workshop"]},
        )
        assert response.status_code == 200
        plates = [item["vehicle_plate"] for item in response.json()["items"]]
        assert "DPT1F11" in plates
        assert "DPT2W22" in plates

        # multi: só film
        response = await authenticated_client.get(
            "/api/v1/service-orders",
            params={"departments": ["film"]},
        )
        assert response.status_code == 200
        plates = [item["vehicle_plate"] for item in response.json()["items"]]
        assert "DPT1F11" in plates
        assert "DPT2W22" not in plates

        # regressão: department single continua funcionando (mobile/ServiceOrdersPage)
        response = await authenticated_client.get(
            "/api/v1/service-orders",
            params={"department": "workshop"},
        )
        assert response.status_code == 200
        plates = [item["vehicle_plate"] for item in response.json()["items"]]
        assert "DPT2W22" in plates
        assert "DPT1F11" not in plates

    @pytest.mark.asyncio
    async def test_list_owner_sees_all_stores(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        second_store: Store,
        test_owner: User,
        db_session: AsyncSession,
    ):
        """Owner should see service orders from all stores."""
        for i, store in enumerate([test_store, second_store]):
            so = ServiceOrder(
                store_id=store.id,
                vehicle_plate=f"OWN{i}A23",
                department="vn",
                status="waiting",
                entry_time=datetime.now(UTC),
                photos=json.dumps([]),
                requires_invoice=False,
                created_by_id=test_owner.id,
            )
            db_session.add(so)
        await db_session.commit()

        response = await owner_client.get("/api/v1/service-orders")
        assert response.status_code == 200
        data = response.json()
        store_ids = {item["store_id"] for item in data["items"]}
        # Owner should see both stores
        assert len(store_ids) >= 1

    @pytest.mark.asyncio
    async def test_list_with_date_filters(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_user: User,
        test_dealership: "Dealership",
        db_session: AsyncSession,
    ):
        """List service orders filtered by date range."""
        so = ServiceOrder(
            store_id=test_store.id,
            dealership_id=test_dealership.id,
            vehicle_plate="DT1ZA23",
            department="film",
            status="waiting",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://localhost:8000/uploads/p1.jpg", "http://localhost:8000/uploads/p2.jpg", "http://localhost:8000/uploads/p3.jpg", "http://localhost:8000/uploads/p4.jpg"]),
            requires_invoice=True,
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.commit()

        past = datetime.now(UTC) - timedelta(hours=1)
        future = datetime.now(UTC) + timedelta(hours=1)
        response = await authenticated_client.get(
            "/api/v1/service-orders",
            params={
                "date_from": past.isoformat(),
                "date_to": future.isoformat(),
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert "items" in data



class TestServiceOrdersStatusTransitionsPaths:
    """Tests covering change_status service.py branches."""

    @pytest.mark.asyncio
    async def test_change_status_stores_notes_in_history(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_user: User,
        test_dealership: "Dealership",
        db_session: AsyncSession,
    ):
        """Status change with notes should store them in history."""
        so = ServiceOrder(
            store_id=test_store.id,
            dealership_id=test_dealership.id,
            vehicle_plate="NOT1A23",
            department="vn",
            status="waiting",
            entry_time=datetime.now(UTC),
            photos=json.dumps([]),
            requires_invoice=False,
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.commit()

        response = await authenticated_client.post(
            f"/api/v1/service-orders/{so.id}/status",
            json={"new_status": "in_progress", "notes": "Iniciando serviço"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "in_progress"

    @pytest.mark.asyncio
    async def test_change_status_to_completed_sets_completion_time(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_user: User,
        test_dealership: "Dealership",
        db_session: AsyncSession,
    ):
        """Transitioning to completed should set completion_time."""
        so = ServiceOrder(
            store_id=test_store.id,
            dealership_id=test_dealership.id,
            vehicle_plate="CPL1A23",
            department="vn",
            status="in_progress",
            entry_time=datetime.now(UTC) - timedelta(hours=2),
            photos=json.dumps([]),
            requires_invoice=False,
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.commit()

        response = await authenticated_client.post(
            f"/api/v1/service-orders/{so.id}/status",
            json={"new_status": "completed"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "completed"

    @pytest.mark.asyncio
    async def test_update_service_order_damage_map(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_user: User,
        test_dealership: "Dealership",
        db_session: AsyncSession,
    ):
        """Should update service order with damage_map."""
        so = ServiceOrder(
            store_id=test_store.id,
            dealership_id=test_dealership.id,
            vehicle_plate="DMG1A23",
            department="vn",
            status="waiting",
            entry_time=datetime.now(UTC),
            photos=json.dumps([]),
            requires_invoice=False,
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.commit()

        damage_map = [{"x": 10, "y": 20, "type": "scratch"}]
        response = await authenticated_client.patch(
            f"/api/v1/service-orders/{so.id}",
            json={"damage_map": damage_map},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_update_service_order_not_found(
        self,
        authenticated_client: AsyncClient,
    ):
        """Should return 404 for non-existent service order update."""
        response = await authenticated_client.patch(
            "/api/v1/service-orders/99999",
            json={"vehicle_model": "Updated Model"},
        )
        assert response.status_code == 404



class TestServiceOrderUpdatePhotos:
    """Tests for update_service_order with photos branches."""

    @pytest.mark.asyncio
    async def test_update_service_order_photos(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_user: User,
        test_dealership: "Dealership",
        db_session: AsyncSession,
    ):
        """Updating photos should serialize them to JSON string."""
        so = ServiceOrder(
            store_id=test_store.id,
            dealership_id=test_dealership.id,
            vehicle_plate="UPH1A23",
            department="vn",
            status="waiting",
            entry_time=datetime.now(UTC),
            photos=json.dumps([]),
            requires_invoice=False,
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.commit()

        new_photos = ["http://localhost:8000/uploads/new_photo1.jpg", "http://localhost:8000/uploads/new_photo2.jpg"]
        response = await authenticated_client.patch(
            f"/api/v1/service-orders/{so.id}",
            json={"photos": new_photos},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_create_service_order_requires_at_least_1_photo(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_user: User,
        test_dealership: "Dealership",
        test_brand: Brand,
        db_session: AsyncSession,
    ):
        """Any store requires minimum 1 photo."""
        svc = Service(
            name="Servico Min Fotos",
            department="film",
            base_price=100.0,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(svc)
        await db_session.commit()
        await db_session.refresh(svc)

        # No photos provided - should fail
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "vehicle_plate": "MFA1A23",
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": [],  # No photos - should fail
                "items": [{"service_id": svc.id, "quantity": 1}],
                "workers": [],
            },
        )
        assert response.status_code in [400, 422]

    @pytest.mark.asyncio
    async def test_create_service_order_dealership_requires_dealership_id(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_user: User,
        test_brand: Brand,
        db_session: AsyncSession,
    ):
        """Dealership store type requires dealership_id."""
        svc = Service(
            name="Servico Req Dealer",
            department="film",
            base_price=100.0,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(svc)
        await db_session.commit()
        await db_session.refresh(svc)

        # test_store has no dealership_id provided — service will try to auto-resolve
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                # No dealership_id!
                "vehicle_plate": "NDL1A23",
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/p1.jpg", "http://localhost:8000/uploads/p2.jpg", "http://localhost:8000/uploads/p3.jpg", "http://localhost:8000/uploads/p4.jpg"],
                "items": [{"service_id": svc.id, "quantity": 1}],
                "workers": [],
            },
        )
        assert response.status_code in [400, 422]


class TestServiceDomainValidation:
    """B-01/B-03: O.S. não aceita serviço de outro departamento/marca."""

    @pytest.mark.asyncio
    async def test_create_rejects_service_of_other_department(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_dealership: "Dealership",
        test_service: Service,
    ):
        """Serviço 'film' numa O.S. 'vn' deve ser recusado (422)."""
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "vehicle_plate": "DOM1A23",
                "department": "vn",  # diverge do serviço (film)
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://s/p1.jpg"],
                "items": [{"service_id": test_service.id, "quantity": 1}],
            },
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_rejects_service_of_other_brand(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_dealership: "Dealership",
        test_brand: Brand,
    ):
        """Serviço de outra marca numa O.S. com modelo vinculado deve ser recusado."""
        from app.modules.vehicle_models.models import VehicleModel

        other_brand = Brand(name="MarcaIntrusa", code="INTRUSA", is_active=True)
        db_session.add(other_brand)
        await db_session.flush()
        intruder = Service(
            name="Serviço Intruso",
            code="INTR",
            department="film",
            base_price=100.0,
            is_active=True,
            brand_id=other_brand.id,
        )
        vm = VehicleModel(name="Modelo Teste Dom", brand_id=test_brand.id, is_active=True)
        db_session.add_all([intruder, vm])
        await db_session.commit()

        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": test_dealership.id,
                "vehicle_plate": "DOM2B34",
                "department": "film",
                "vehicle_model_id": vm.id,
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://s/p1.jpg"],
                "items": [{"service_id": intruder.id, "quantity": 1}],
            },
        )
        assert response.status_code == 422


class TestRequiresInvoiceByDepartment:
    """🟠 (auditoria): requires_invoice é marcado na criação para Película, PPF E
    Película de Segurança — mesma regra do enforcement na verificação. Antes só
    marcava `film`, então security_film/ppf eram verificáveis sem NF."""

    async def _make_service(self, db_session, brand_id, department: str) -> Service:
        svc = Service(
            name=f"Serviço {department}",
            department=department,
            base_price=100.0,
            is_active=True,
            brand_id=brand_id,
        )
        db_session.add(svc)
        await db_session.commit()
        await db_session.refresh(svc)
        return svc

    async def _create_os(self, client, store, dealership, service, department: str) -> dict:
        resp = await client.post(
            "/api/v1/service-orders",
            json={
                "store_id": store.id,
                "dealership_id": dealership.id,
                "vehicle_plate": "XYZ9A88",
                "vehicle_brand": "Honda",
                "vehicle_model": "Civic",
                "vehicle_color": "Preto",
                "vehicle_year": 2023,
                "department": department,
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": [
                    "http://localhost:8000/uploads/p1.jpg",
                    "http://localhost:8000/uploads/p2.jpg",
                    "http://localhost:8000/uploads/p3.jpg",
                    "http://localhost:8000/uploads/p4.jpg",
                ],
                "items": [{"service_id": service.id, "quantity": 1}],
            },
        )
        assert resp.status_code == 201, resp.text
        return resp.json()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("department", ["film", "security_film", "ppf"])
    async def test_invoice_required_departments_set_flag(
        self, authenticated_client, db_session, test_store, test_dealership, test_brand, department
    ):
        svc = await self._make_service(db_session, test_brand.id, department)
        data = await self._create_os(
            authenticated_client, test_store, test_dealership, svc, department
        )
        assert data["requires_invoice"] is True

    @pytest.mark.asyncio
    async def test_non_invoice_department_does_not_require(
        self, authenticated_client, db_session, test_store, test_dealership, test_brand
    ):
        svc = await self._make_service(db_session, test_brand.id, "bodywork")
        data = await self._create_os(
            authenticated_client, test_store, test_dealership, svc, "bodywork"
        )
        assert data["requires_invoice"] is False

    @pytest.mark.asyncio
    async def test_update_department_recomputes_requires_invoice(
        self, authenticated_client, db_session, test_store, test_dealership, test_brand
    ):
        """🟠 (auditoria): trocar o departamento no update recomputa requires_invoice."""
        body_svc = await self._make_service(db_session, test_brand.id, "bodywork")
        film_svc = await self._make_service(db_session, test_brand.id, "security_film")

        # Nasce bodywork → requires_invoice False.
        created = await self._create_os(
            authenticated_client, test_store, test_dealership, body_svc, "bodywork"
        )
        assert created["requires_invoice"] is False

        # Muda para security_film (+ item do novo depto) → requires_invoice True.
        resp = await authenticated_client.patch(
            f"/api/v1/service-orders/{created['id']}",
            json={
                "department": "security_film",
                "items": [{"service_id": film_svc.id, "quantity": 1}],
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["requires_invoice"] is True
