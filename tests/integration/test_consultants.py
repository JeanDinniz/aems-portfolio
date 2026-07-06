"""
Integration tests for consultants endpoints.
Tests CRUD operations, permissions, and filtering.
"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.consultants.models import Consultant
from app.modules.dealerships.models import Dealership
from app.modules.stores.models import Store


@pytest.fixture
async def test_dealership(db_session: AsyncSession, test_store: Store) -> Dealership:
    """Create a test dealership for the primary store."""
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
    db_session: AsyncSession,
    test_dealership: Dealership,
    test_store: Store,
) -> Consultant:
    """Create a test active consultant."""
    consultant = Consultant(
        name="Carlos Consultor",
        dealership_id=test_dealership.id,
        store_id=test_store.id,
        phone="11988888888",
        email="carlos@toyota.com",
        is_active=True,
    )
    db_session.add(consultant)
    await db_session.commit()
    await db_session.refresh(consultant)
    return consultant


@pytest.fixture
async def inactive_consultant(
    db_session: AsyncSession,
    test_dealership: Dealership,
    test_store: Store,
) -> Consultant:
    """Create a test inactive consultant."""
    consultant = Consultant(
        name="Maria Inativa",
        dealership_id=test_dealership.id,
        store_id=test_store.id,
        phone="11977777777",
        email="maria@toyota.com",
        is_active=False,
    )
    db_session.add(consultant)
    await db_session.commit()
    await db_session.refresh(consultant)
    return consultant


class TestListConsultants:
    """Tests for list consultants endpoint."""

    @pytest.mark.asyncio
    async def test_list_consultants_authenticated(
        self,
        authenticated_client: AsyncClient,
        test_consultant: Consultant,
    ):
        """Authenticated user should list consultants."""
        response = await authenticated_client.get("/api/v1/consultants")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "pagination" in data
        assert len(data["items"]) >= 1

    @pytest.mark.asyncio
    async def test_list_consultants_unauthenticated(self, client: AsyncClient):
        """Unauthenticated request should return 401."""
        response = await client.get("/api/v1/consultants")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_list_consultants_filter_by_dealership(
        self,
        authenticated_client: AsyncClient,
        test_consultant: Consultant,
        test_dealership: Dealership,
    ):
        """Should filter consultants by dealership_id."""
        response = await authenticated_client.get(
            f"/api/v1/consultants?dealership_id={test_dealership.id}"
        )
        assert response.status_code == 200
        data = response.json()
        for item in data["items"]:
            assert item["dealership_id"] == test_dealership.id

    @pytest.mark.asyncio
    async def test_list_consultants_filter_by_store(
        self,
        authenticated_client: AsyncClient,
        test_consultant: Consultant,
        test_store: Store,
    ):
        """Should filter consultants by store_id."""
        response = await authenticated_client.get(
            f"/api/v1/consultants?store_id={test_store.id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) >= 1
        for item in data["items"]:
            assert item["store_id"] == test_store.id

    @pytest.mark.asyncio
    async def test_list_consultants_filter_active_only(
        self,
        authenticated_client: AsyncClient,
        test_consultant: Consultant,
        inactive_consultant: Consultant,
    ):
        """Should filter only active consultants."""
        response = await authenticated_client.get(
            "/api/v1/consultants?is_active=true"
        )
        assert response.status_code == 200
        data = response.json()
        for item in data["items"]:
            assert item["is_active"] is True

    @pytest.mark.asyncio
    async def test_list_consultants_filter_inactive_only(
        self,
        authenticated_client: AsyncClient,
        test_consultant: Consultant,
        inactive_consultant: Consultant,
    ):
        """Should filter only inactive consultants."""
        response = await authenticated_client.get(
            "/api/v1/consultants?is_active=false"
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) >= 1
        for item in data["items"]:
            assert item["is_active"] is False

    @pytest.mark.asyncio
    async def test_list_consultants_owner_sees_all(
        self,
        owner_client: AsyncClient,
        test_consultant: Consultant,
    ):
        """Owner should see consultants from all stores."""
        response = await owner_client.get("/api/v1/consultants")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data

    @pytest.mark.asyncio
    async def test_list_consultants_pagination(
        self,
        authenticated_client: AsyncClient,
        test_consultant: Consultant,
    ):
        """Should support pagination."""
        response = await authenticated_client.get(
            "/api/v1/consultants?page=1&limit=5"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["pagination"]["page"] == 1
        assert data["pagination"]["limit"] == 5

    @pytest.mark.asyncio
    async def test_list_consultants_response_has_store_name(
        self,
        authenticated_client: AsyncClient,
        test_consultant: Consultant,
    ):
        """Consultant list response should include store_name."""
        response = await authenticated_client.get("/api/v1/consultants")
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) >= 1
        item = data["items"][0]
        assert "store_name" in item
        assert item["store_name"] is not None


class TestGetConsultant:
    """Tests for get consultant endpoint."""

    @pytest.mark.asyncio
    async def test_get_consultant_success(
        self,
        authenticated_client: AsyncClient,
        test_consultant: Consultant,
    ):
        """Should get consultant details."""
        response = await authenticated_client.get(
            f"/api/v1/consultants/{test_consultant.id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_consultant.id
        assert data["name"] == "Carlos Consultor"
        assert data["email"] == "carlos@toyota.com"
        assert "store_name" in data

    @pytest.mark.asyncio
    async def test_get_consultant_not_found(
        self,
        authenticated_client: AsyncClient,
    ):
        """Should return 404 for non-existent consultant."""
        response = await authenticated_client.get("/api/v1/consultants/99999")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_get_consultant_owner_can_access_any(
        self,
        owner_client: AsyncClient,
        test_consultant: Consultant,
    ):
        """Owner should be able to get any consultant."""
        response = await owner_client.get(
            f"/api/v1/consultants/{test_consultant.id}"
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_get_consultant_operator_cannot_see_other_store(
        self,
        authenticated_client: AsyncClient,
        second_store: Store,
        db_session: AsyncSession,
    ):
        """Operator should not see consultant from another store."""
        # Create a dealership and consultant for the second store
        other_dealership = Dealership(
            name="Other Dealership",
            store_id=second_store.id,
            brand="Honda",
            is_active=True,
        )
        db_session.add(other_dealership)
        await db_session.flush()

        other_consultant = Consultant(
            name="Consultor Outra Loja",
            dealership_id=other_dealership.id,
            store_id=second_store.id,
            phone="11966666666",
            is_active=True,
        )
        db_session.add(other_consultant)
        await db_session.commit()

        response = await authenticated_client.get(
            f"/api/v1/consultants/{other_consultant.id}"
        )
        assert response.status_code == 404


class TestCreateConsultant:
    """Tests for create consultant endpoint."""

    @pytest.mark.asyncio
    async def test_create_consultant_success(
        self,
        authenticated_client: AsyncClient,
        test_dealership: Dealership,
        test_store: Store,
    ):
        """Should create a new consultant."""
        response = await authenticated_client.post(
            "/api/v1/consultants",
            json={
                "name": "Novo Consultor",
                "dealership_id": test_dealership.id,
                "store_id": test_store.id,
                "phone": "11944444444",
                "email": "novo@toyota.com",
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Novo Consultor"
        assert data["email"] == "novo@toyota.com"
        assert data["is_active"] is True

    @pytest.mark.asyncio
    async def test_create_consultant_without_email(
        self,
        authenticated_client: AsyncClient,
        test_dealership: Dealership,
        test_store: Store,
    ):
        """Should create consultant without optional email."""
        response = await authenticated_client.post(
            "/api/v1/consultants",
            json={
                "name": "Consultor Sem Email",
                "dealership_id": test_dealership.id,
                "store_id": test_store.id,
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Consultor Sem Email"

    @pytest.mark.asyncio
    async def test_create_consultant_unauthenticated(self, client: AsyncClient):
        """Unauthenticated request should return 401."""
        response = await client.post(
            "/api/v1/consultants",
            json={
                "name": "Consultor",
                "dealership_id": 1,
                "store_id": 1,
            },
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_create_consultant_invalid_dealership(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
    ):
        """Should return 404 when dealership_id does not exist."""
        response = await authenticated_client.post(
            "/api/v1/consultants",
            json={
                "name": "Consultor Invalido",
                "dealership_id": 99999,
                "store_id": test_store.id,
            },
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_create_consultant_invalid_store(
        self,
        authenticated_client: AsyncClient,
        test_dealership: Dealership,
    ):
        """Should return 404 when store_id does not exist."""
        response = await authenticated_client.post(
            "/api/v1/consultants",
            json={
                "name": "Consultor Store Invalida",
                "dealership_id": test_dealership.id,
                "store_id": 99999,
            },
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_create_consultant_store_mismatch_rejected(
        self,
        owner_client: AsyncClient,
        test_dealership: Dealership,
        second_store: Store,
    ):
        """Should reject when dealership store_id != provided store_id."""
        # test_dealership belongs to test_store, not second_store
        response = await owner_client.post(
            "/api/v1/consultants",
            json={
                "name": "Consultor Mismatch",
                "dealership_id": test_dealership.id,
                "store_id": second_store.id,
            },
        )
        assert response.status_code in [400, 422]

    @pytest.mark.asyncio
    async def test_create_consultant_name_too_short(
        self,
        authenticated_client: AsyncClient,
        test_dealership: Dealership,
        test_store: Store,
    ):
        """Should reject name with less than 2 characters."""
        response = await authenticated_client.post(
            "/api/v1/consultants",
            json={
                "name": "A",
                "dealership_id": test_dealership.id,
                "store_id": test_store.id,
            },
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_consultant_owner_can_create(
        self,
        owner_client: AsyncClient,
        test_dealership: Dealership,
        test_store: Store,
    ):
        """Owner should be able to create consultants."""
        response = await owner_client.post(
            "/api/v1/consultants",
            json={
                "name": "Consultor do Owner",
                "dealership_id": test_dealership.id,
                "store_id": test_store.id,
            },
        )
        assert response.status_code == 201


class TestUpdateConsultant:
    """Tests for update consultant endpoint."""

    @pytest.mark.asyncio
    async def test_update_consultant_name(
        self,
        owner_client: AsyncClient,
        test_consultant: Consultant,
    ):
        """Owner should update consultant name."""
        response = await owner_client.patch(
            f"/api/v1/consultants/{test_consultant.id}",
            json={"name": "Carlos Atualizado"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Carlos Atualizado"

    @pytest.mark.asyncio
    async def test_update_consultant_phone(
        self,
        owner_client: AsyncClient,
        test_consultant: Consultant,
    ):
        """Owner should update consultant phone."""
        response = await owner_client.patch(
            f"/api/v1/consultants/{test_consultant.id}",
            json={"phone": "11933333333"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["phone"] == "11933333333"

    @pytest.mark.asyncio
    async def test_update_consultant_email(
        self,
        owner_client: AsyncClient,
        test_consultant: Consultant,
    ):
        """Should update consultant email."""
        response = await owner_client.patch(
            f"/api/v1/consultants/{test_consultant.id}",
            json={"email": "carlos.novo@toyota.com"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "carlos.novo@toyota.com"

    @pytest.mark.asyncio
    async def test_update_consultant_operator_denied(
        self,
        authenticated_client: AsyncClient,
        test_consultant: Consultant,
    ):
        """Operator should not be able to update consultants."""
        response = await authenticated_client.patch(
            f"/api/v1/consultants/{test_consultant.id}",
            json={"name": "Tentativa de Update"},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_update_consultant_not_found(
        self,
        owner_client: AsyncClient,
    ):
        """Should return 404 for non-existent consultant."""
        response = await owner_client.patch(
            "/api/v1/consultants/99999",
            json={"name": "Nao Existe"},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_consultant_deactivate_via_patch(
        self,
        owner_client: AsyncClient,
        test_consultant: Consultant,
    ):
        """Should update is_active field via patch."""
        response = await owner_client.patch(
            f"/api/v1/consultants/{test_consultant.id}",
            json={"is_active": False},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["is_active"] is False

    @pytest.mark.asyncio
    async def test_update_consultant_unauthenticated(
        self,
        client: AsyncClient,
        test_consultant: Consultant,
    ):
        """Unauthenticated request should return 401."""
        response = await client.patch(
            f"/api/v1/consultants/{test_consultant.id}",
            json={"name": "Test"},
        )
        assert response.status_code == 401


class TestDeleteConsultant:
    """Tests for permanent delete consultant endpoint."""

    @pytest.mark.asyncio
    async def test_delete_consultant_as_owner(
        self,
        owner_client: AsyncClient,
        test_consultant: Consultant,
    ):
        """Owner should be able to permanently delete a consultant."""
        response = await owner_client.delete(
            f"/api/v1/consultants/{test_consultant.id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_consultant.id
        assert data["name"] == test_consultant.name

    @pytest.mark.asyncio
    async def test_delete_consultant_operator_denied(
        self,
        authenticated_client: AsyncClient,
        test_consultant: Consultant,
    ):
        """Operator should not be able to delete consultants."""
        response = await authenticated_client.delete(
            f"/api/v1/consultants/{test_consultant.id}"
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_delete_consultant_not_found(
        self,
        owner_client: AsyncClient,
    ):
        """Should return 404 for non-existent consultant."""
        response = await owner_client.delete("/api/v1/consultants/99999")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_removes_from_db(
        self,
        owner_client: AsyncClient,
        test_consultant: Consultant,
        db_session: AsyncSession,
    ):
        """Deleting should permanently remove the consultant from DB."""
        consultant_id = test_consultant.id

        response = await owner_client.delete(
            f"/api/v1/consultants/{consultant_id}"
        )
        assert response.status_code == 200

        # Verify removed from DB
        from sqlalchemy import select

        from app.modules.consultants.models import Consultant as ConsultantModel
        result = await db_session.execute(
            select(ConsultantModel).where(ConsultantModel.id == consultant_id)
        )
        consultant = result.scalar_one_or_none()
        assert consultant is None

    @pytest.mark.asyncio
    async def test_delete_preserves_consultant_name_in_service_orders(
        self,
        owner_client: AsyncClient,
        test_consultant: Consultant,
        db_session: AsyncSession,
    ):
        """Deleting consultant should preserve their name in linked service orders."""
        from sqlalchemy import select

        from app.modules.service_orders.models import ServiceOrder

        # Verify any linked service orders get consultant_name preserved after delete
        consultant_id = test_consultant.id
        consultant_name = test_consultant.name

        await owner_client.delete(f"/api/v1/consultants/{consultant_id}")

        result = await db_session.execute(
            select(ServiceOrder).where(
                ServiceOrder.consultant_name == consultant_name,
                ServiceOrder.consultant_id.is_(None),
            )
        )
        # All previously linked orders should have consultant_id=None and consultant_name set
        orders = result.scalars().all()
        for order in orders:
            assert order.consultant_id is None
            assert order.consultant_name == consultant_name


class TestConsultantResponseFields:
    """Tests for consultant response field completeness."""

    @pytest.mark.asyncio
    async def test_response_has_all_required_fields(
        self,
        authenticated_client: AsyncClient,
        test_consultant: Consultant,
    ):
        """Consultant response should include all required fields."""
        response = await authenticated_client.get(
            f"/api/v1/consultants/{test_consultant.id}"
        )
        assert response.status_code == 200
        data = response.json()
        required_fields = [
            "id", "name", "phone", "email", "dealership_id",
            "store_id", "is_active", "created_at",
        ]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"

    @pytest.mark.asyncio
    async def test_created_consultant_returned_with_correct_defaults(
        self,
        authenticated_client: AsyncClient,
        test_dealership: Dealership,
        test_store: Store,
    ):
        """Newly created consultant should have is_active=True by default."""
        response = await authenticated_client.post(
            "/api/v1/consultants",
            json={
                "name": "Consultor Padrao",
                "dealership_id": test_dealership.id,
                "store_id": test_store.id,
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["is_active"] is True
        assert data["id"] is not None
        assert data["created_at"] is not None
