"""
Integration tests for service catalog endpoints.
Tests CRUD operations, filtering, and RBAC enforcement.
"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.brands.models import Brand
from app.modules.services.models import Service


@pytest.fixture
async def test_brand_svc(db_session: AsyncSession) -> Brand:
    """Create a test brand for service tests."""
    brand = Brand(name="Toyota Svc", code="toyotasvc", is_active=True)
    db_session.add(brand)
    await db_session.commit()
    await db_session.refresh(brand)
    return brand


@pytest.fixture
async def test_service(db_session: AsyncSession, test_brand_svc: Brand) -> Service:
    """Create a test service in the film department."""
    service = Service(
        name="Instalacao Fumê 35%",
        department="film",
        description="Instalação de película fumê com fator de transmissão 35%",
        base_price=350.00,
        is_active=True,
        brand_id=test_brand_svc.id,
    )
    db_session.add(service)
    await db_session.commit()
    await db_session.refresh(service)
    return service


@pytest.fixture
async def test_service_vn(db_session: AsyncSession, test_brand_svc: Brand) -> Service:
    """Create a test service in the VN department."""
    service = Service(
        name="Polimento Simples",
        department="vn",
        description="Polimento simples com cera",
        base_price=200.00,
        is_active=True,
        brand_id=test_brand_svc.id,
    )
    db_session.add(service)
    await db_session.commit()
    await db_session.refresh(service)
    return service


@pytest.fixture
async def test_service_inactive(db_session: AsyncSession, test_brand_svc: Brand) -> Service:
    """Create an inactive test service."""
    service = Service(
        name="Servico Inativo",
        department="film",
        base_price=100.00,
        is_active=False,
        brand_id=test_brand_svc.id,
    )
    db_session.add(service)
    await db_session.commit()
    await db_session.refresh(service)
    return service


class TestListServices:
    """Tests for list services endpoint."""

    @pytest.mark.asyncio
    async def test_list_services_as_owner(
        self, owner_client: AsyncClient, test_service: Service
    ):
        """Owner should see all active services."""
        response = await owner_client.get("/api/v1/services")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "pagination" in data

    @pytest.mark.asyncio
    async def test_list_services_as_operator(
        self, authenticated_client: AsyncClient, test_service: Service
    ):
        """Operator should see active services."""
        response = await authenticated_client.get("/api/v1/services")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data

    @pytest.mark.asyncio
    async def test_list_services_unauthenticated(self, client: AsyncClient):
        """Unauthenticated request should return 401."""
        response = await client.get("/api/v1/services")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_list_services_default_active_only(
        self,
        owner_client: AsyncClient,
        test_service: Service,
        test_service_inactive: Service,
    ):
        """By default, list returns only active services."""
        response = await owner_client.get("/api/v1/services")
        assert response.status_code == 200
        data = response.json()
        for item in data["items"]:
            assert item["is_active"] is True

    @pytest.mark.asyncio
    async def test_list_services_filter_inactive(
        self,
        owner_client: AsyncClient,
        test_service_inactive: Service,
    ):
        """Should filter services by is_active=false."""
        response = await owner_client.get(
            "/api/v1/services", params={"is_active": "false"}
        )
        assert response.status_code == 200
        data = response.json()
        for item in data["items"]:
            assert item["is_active"] is False

    @pytest.mark.asyncio
    async def test_list_services_filter_by_department_film(
        self,
        owner_client: AsyncClient,
        test_service: Service,
        test_service_vn: Service,
    ):
        """Should filter services by film department."""
        response = await owner_client.get(
            "/api/v1/services", params={"department": "film"}
        )
        assert response.status_code == 200
        data = response.json()
        for item in data["items"]:
            assert item["department"] == "film"

    @pytest.mark.asyncio
    async def test_list_services_filter_by_department_vn(
        self,
        owner_client: AsyncClient,
        test_service: Service,
        test_service_vn: Service,
    ):
        """Should filter services by VN department."""
        response = await owner_client.get(
            "/api/v1/services", params={"department": "vn"}
        )
        assert response.status_code == 200
        data = response.json()
        for item in data["items"]:
            assert item["department"] == "vn"

    @pytest.mark.asyncio
    async def test_list_services_pagination(
        self, owner_client: AsyncClient, test_service: Service
    ):
        """Should support pagination."""
        response = await owner_client.get(
            "/api/v1/services", params={"page": 1, "limit": 1}
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) <= 1
        assert "pagination" in data


class TestGetService:
    """Tests for get service endpoint."""

    @pytest.mark.asyncio
    async def test_get_service_success(
        self, owner_client: AsyncClient, test_service: Service
    ):
        """Should return service details."""
        response = await owner_client.get(f"/api/v1/services/{test_service.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_service.id
        assert data["name"] == "Instalacao Fumê 35%"
        assert data["department"] == "film"

    @pytest.mark.asyncio
    async def test_get_service_not_found(self, owner_client: AsyncClient):
        """Should return 404 for non-existent service."""
        response = await owner_client.get("/api/v1/services/99999")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_get_service_as_operator(
        self, authenticated_client: AsyncClient, test_service: Service
    ):
        """Operator should be able to get service details."""
        response = await authenticated_client.get(f"/api/v1/services/{test_service.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_service.id

    @pytest.mark.asyncio
    async def test_get_service_response_fields(
        self, owner_client: AsyncClient, test_service: Service
    ):
        """Service response should include all required fields."""
        response = await owner_client.get(f"/api/v1/services/{test_service.id}")
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "name" in data
        assert "department" in data
        assert "base_price" in data
        assert "is_active" in data
        assert "brand_id" in data
        assert "created_at" in data


class TestCreateService:
    """Tests for create service endpoint."""

    @pytest.mark.asyncio
    async def test_create_service_as_owner(
        self, owner_client: AsyncClient, test_brand_svc: Brand
    ):
        """Owner should be able to create services."""
        response = await owner_client.post(
            "/api/v1/services",
            json={
                "name": "Pelicula Security",
                "department": "film",
                "description": "Película de segurança",
                "base_price": "500.00",
                "brand_id": test_brand_svc.id,
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Pelicula Security"
        assert data["department"] == "film"
        assert data["is_active"] is True

    @pytest.mark.asyncio
    async def test_create_service_as_operator_denied(
        self, authenticated_client: AsyncClient, test_brand_svc: Brand
    ):
        """Operator should not be able to create services."""
        response = await authenticated_client.post(
            "/api/v1/services",
            json={
                "name": "Servico Operador",
                "department": "film",
                "base_price": "100.00",
                "brand_id": test_brand_svc.id,
            },
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_create_service_vn_department(
        self, owner_client: AsyncClient, test_brand_svc: Brand
    ):
        """Owner should be able to create services in VN department."""
        response = await owner_client.post(
            "/api/v1/services",
            json={
                "name": "Higienizacao Interna",
                "department": "vn",
                "base_price": "250.00",
                "brand_id": test_brand_svc.id,
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["department"] == "vn"

    @pytest.mark.asyncio
    async def test_create_service_with_all_fields(
        self, owner_client: AsyncClient, test_brand_svc: Brand
    ):
        """Owner can create service with all optional fields."""
        response = await owner_client.post(
            "/api/v1/services",
            json={
                "name": "Servico Completo",
                "department": "bodywork",
                "description": "Descricao detalhada do servico",
                "base_price": "1000.00",
                "brand_id": test_brand_svc.id,
                "code": "SVC001",
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["description"] == "Descricao detalhada do servico"
        assert data["brand_id"] == test_brand_svc.id

    @pytest.mark.asyncio
    async def test_create_service_name_too_short(
        self, owner_client: AsyncClient, test_brand_svc: Brand
    ):
        """Should validate service name minimum length."""
        response = await owner_client.post(
            "/api/v1/services",
            json={
                "name": "A",  # Too short (min_length=2)
                "department": "film",
                "base_price": "100.00",
                "brand_id": test_brand_svc.id,
            },
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_service_negative_price_rejected(
        self, owner_client: AsyncClient, test_brand_svc: Brand
    ):
        """Should reject negative base_price."""
        response = await owner_client.post(
            "/api/v1/services",
            json={
                "name": "Servico Invalido",
                "department": "film",
                "base_price": "-10.00",
                "brand_id": test_brand_svc.id,
            },
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_service_unauthenticated(
        self, client: AsyncClient, test_brand_svc: Brand
    ):
        """Unauthenticated request should return 401."""
        response = await client.post(
            "/api/v1/services",
            json={
                "name": "Servico Sem Auth",
                "department": "film",
                "base_price": "100.00",
                "brand_id": test_brand_svc.id,
            },
        )
        assert response.status_code == 401


class TestUpdateService:
    """Tests for update service endpoint."""

    @pytest.mark.asyncio
    async def test_update_service_as_owner(
        self, owner_client: AsyncClient, test_service: Service
    ):
        """Owner should be able to update services."""
        response = await owner_client.patch(
            f"/api/v1/services/{test_service.id}",
            json={"name": "Fumê 35% Atualizado"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Fumê 35% Atualizado"

    @pytest.mark.asyncio
    async def test_update_service_as_operator_denied(
        self, authenticated_client: AsyncClient, test_service: Service
    ):
        """Operator should not be able to update services."""
        response = await authenticated_client.patch(
            f"/api/v1/services/{test_service.id}",
            json={"name": "Tentativa Update"},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_update_service_not_found(self, owner_client: AsyncClient):
        """Should return 404 for non-existent service."""
        response = await owner_client.patch(
            "/api/v1/services/99999",
            json={"name": "Nao Existe"},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_service_price(
        self, owner_client: AsyncClient, test_service: Service
    ):
        """Owner can update service price."""
        response = await owner_client.patch(
            f"/api/v1/services/{test_service.id}",
            json={"base_price": "400.00"},
        )
        assert response.status_code == 200
        data = response.json()
        assert float(data["base_price"]) == 400.00

    @pytest.mark.asyncio
    async def test_update_service_deactivate(
        self, owner_client: AsyncClient, test_service: Service
    ):
        """Owner can deactivate service via PATCH."""
        response = await owner_client.patch(
            f"/api/v1/services/{test_service.id}",
            json={"is_active": False},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["is_active"] is False

    @pytest.mark.asyncio
    async def test_update_service_department(
        self, owner_client: AsyncClient, test_service: Service
    ):
        """Owner can update service department."""
        response = await owner_client.patch(
            f"/api/v1/services/{test_service.id}",
            json={"department": "vn"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["department"] == "vn"

    @pytest.mark.asyncio
    async def test_update_is_courtesy_only_propagates_to_sibling_brands(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_service: Service,
    ):
        """Marcar exclusivo de cortesia propaga para linhas irmãs (mesmo nome/departamento em outra marca)."""
        other_brand = Brand(name="BYD Svc", code="bydsvc", is_active=True)
        db_session.add(other_brand)
        await db_session.commit()
        await db_session.refresh(other_brand)

        sibling = Service(
            name=test_service.name,
            department=test_service.department,
            base_price=350.00,
            is_active=True,
            brand_id=other_brand.id,
        )
        unrelated = Service(
            name="Outro Servico",
            department=test_service.department,
            base_price=100.00,
            is_active=True,
            brand_id=other_brand.id,
        )
        db_session.add_all([sibling, unrelated])
        await db_session.commit()
        await db_session.refresh(sibling)
        await db_session.refresh(unrelated)

        response = await owner_client.patch(
            f"/api/v1/services/{test_service.id}",
            json={"is_courtesy_only": True},
        )
        assert response.status_code == 200
        assert response.json()["is_courtesy_only"] is True

        await db_session.refresh(sibling)
        await db_session.refresh(unrelated)
        assert sibling.is_courtesy_only is True
        assert unrelated.is_courtesy_only is False
        # A resposta informa quantas linhas irmãs foram afetadas (transparência).
        assert response.json()["courtesy_propagated_count"] == 1

    @pytest.mark.asyncio
    async def test_update_is_courtesy_only_audits_sibling_brands(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_service: Service,
    ):
        """A propagação cross-marca gera auditoria individual de cada serviço irmão."""
        from sqlalchemy import select

        from app.core.audit import AuditLog

        other_brand = Brand(name="Fiat Svc", code="fiatsvc", is_active=True)
        db_session.add(other_brand)
        await db_session.commit()
        await db_session.refresh(other_brand)

        sibling = Service(
            name=test_service.name,
            department=test_service.department,
            base_price=350.00,
            is_active=True,
            brand_id=other_brand.id,
        )
        db_session.add(sibling)
        await db_session.commit()
        await db_session.refresh(sibling)

        response = await owner_client.patch(
            f"/api/v1/services/{test_service.id}",
            json={"is_courtesy_only": True},
        )
        assert response.status_code == 200

        logs = (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.resource_type == "service",
                    AuditLog.resource_id == sibling.id,
                    AuditLog.action == "update",
                )
            )
        ).scalars().all()
        assert len(logs) >= 1


class TestServicePoints:
    """Tests for the points field on Service."""

    @pytest.mark.asyncio
    async def test_create_service_with_points(
        self, owner_client: AsyncClient, test_brand_svc: Brand
    ):
        """Creating a service with points should echo that value in the response."""
        resp = await owner_client.post(
            "/api/v1/services",
            json={
                "name": "Servico com pontos",
                "department": "film",
                "base_price": "250.00",
                "brand_id": test_brand_svc.id,
                "code": "POLI1",
                "points": "1.00",
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert float(body["points"]) == 1.00

    @pytest.mark.asyncio
    async def test_default_points_is_zero(
        self, owner_client: AsyncClient, test_brand_svc: Brand
    ):
        """Creating a service without points should default to 0."""
        resp = await owner_client.post(
            "/api/v1/services",
            json={
                "name": "Servico sem pontos",
                "department": "film",
                "base_price": "100.00",
                "brand_id": test_brand_svc.id,
            },
        )
        assert resp.status_code == 201, resp.text
        assert float(resp.json()["points"]) == 0.0


class TestDeactivateService:
    """Tests for deactivate service endpoint."""

    @pytest.mark.asyncio
    async def test_deactivate_service_as_owner(
        self, owner_client: AsyncClient, test_service: Service
    ):
        """Owner should be able to deactivate services."""
        response = await owner_client.delete(f"/api/v1/services/{test_service.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["is_active"] is False

    @pytest.mark.asyncio
    async def test_deactivate_service_as_operator_denied(
        self, authenticated_client: AsyncClient, test_service: Service
    ):
        """Operator should not be able to deactivate services."""
        response = await authenticated_client.delete(
            f"/api/v1/services/{test_service.id}"
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_deactivate_service_not_found(self, owner_client: AsyncClient):
        """Should return 404 for non-existent service."""
        response = await owner_client.delete("/api/v1/services/99999")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_deactivate_does_not_delete(
        self, owner_client: AsyncClient, test_service: Service
    ):
        """Deactivating a service should not delete it from the database."""
        response = await owner_client.delete(f"/api/v1/services/{test_service.id}")
        assert response.status_code == 200

        # Verify service still exists (fetch with is_active=false filter)
        get_response = await owner_client.get(
            "/api/v1/services",
            params={"is_active": "false"},
        )
        assert get_response.status_code == 200
        service_ids = [item["id"] for item in get_response.json()["items"]]
        assert test_service.id in service_ids
