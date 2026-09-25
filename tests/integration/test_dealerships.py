"""
Integration tests for dealership endpoints.
Tests CRUD operations, RBAC enforcement, and filtering.
"""

import pytest
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.dealerships.models import Dealership
from app.modules.stores.models import Store


class TestDefaultDealershipUniqueness:
    """A concessionária fantasma 'Geral' (auto-criada) não pode duplicar por loja."""

    @pytest.mark.asyncio
    async def test_duplicate_geral_same_store_rejected(
        self, db_session: AsyncSession, test_store: Store
    ):
        db_session.add(Dealership(name="A", brand="Geral", store_id=test_store.id))
        db_session.add(Dealership(name="B", brand="Geral", store_id=test_store.id))
        with pytest.raises(IntegrityError):
            await db_session.flush()

    @pytest.mark.asyncio
    async def test_real_brand_duplicate_same_store_allowed(
        self, db_session: AsyncSession, test_store: Store
    ):
        """O índice é PARCIAL (só 'Geral'): marcas reais duplicadas seguem livres."""
        db_session.add(Dealership(name="Toyota Centro", brand="Toyota", store_id=test_store.id))
        db_session.add(Dealership(name="Toyota Sul", brand="Toyota", store_id=test_store.id))
        await db_session.flush()  # não deve levantar


@pytest.fixture
async def test_dealership(
    db_session: AsyncSession, test_store: Store
) -> Dealership:
    """Create a test dealership."""
    dealership = Dealership(
        name="Toyota Teste",
        brand="Toyota",
        store_id=test_store.id,
        address="Av. Toyota, 100",
        is_active=True,
    )
    db_session.add(dealership)
    await db_session.commit()
    await db_session.refresh(dealership)
    return dealership


@pytest.fixture
async def test_dealership_inactive(
    db_session: AsyncSession, test_store: Store
) -> Dealership:
    """Create an inactive dealership."""
    dealership = Dealership(
        name="Fiat Inativa",
        brand="Fiat",
        store_id=test_store.id,
        is_active=False,
    )
    db_session.add(dealership)
    await db_session.commit()
    await db_session.refresh(dealership)
    return dealership


@pytest.fixture
async def second_dealership(
    db_session: AsyncSession, second_store: Store
) -> Dealership:
    """Create a dealership in the second store."""
    dealership = Dealership(
        name="BYD Loja 2",
        brand="BYD",
        store_id=second_store.id,
        is_active=True,
    )
    db_session.add(dealership)
    await db_session.commit()
    await db_session.refresh(dealership)
    return dealership


class TestListDealerships:
    """Tests for list dealerships endpoint."""

    @pytest.mark.asyncio
    async def test_list_dealerships_as_owner(
        self, owner_client: AsyncClient, test_dealership: Dealership
    ):
        """Owner should see all dealerships."""
        response = await owner_client.get("/api/v1/dealerships")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "pagination" in data
        assert len(data["items"]) >= 1

    @pytest.mark.asyncio
    async def test_list_dealerships_as_operator(
        self,
        authenticated_client: AsyncClient,
        test_dealership: Dealership,
        second_dealership: Dealership,
    ):
        """Operator should only see dealerships from their store."""
        response = await authenticated_client.get("/api/v1/dealerships")
        assert response.status_code == 200
        data = response.json()
        store_ids = {item["store_id"] for item in data["items"]}
        # Operator should not see second store's dealership
        assert second_dealership.store_id not in store_ids

    @pytest.mark.asyncio
    async def test_list_dealerships_unauthenticated(self, client: AsyncClient):
        """Unauthenticated request should return 401."""
        response = await client.get("/api/v1/dealerships")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_list_dealerships_filter_active(
        self,
        owner_client: AsyncClient,
        test_dealership: Dealership,
        test_dealership_inactive: Dealership,
    ):
        """Owner can filter dealerships by is_active=true."""
        response = await owner_client.get(
            "/api/v1/dealerships", params={"is_active": "true"}
        )
        assert response.status_code == 200
        data = response.json()
        for item in data["items"]:
            assert item["is_active"] is True

    @pytest.mark.asyncio
    async def test_list_dealerships_filter_inactive(
        self,
        owner_client: AsyncClient,
        test_dealership_inactive: Dealership,
    ):
        """Owner can filter dealerships by is_active=false."""
        response = await owner_client.get(
            "/api/v1/dealerships", params={"is_active": "false"}
        )
        assert response.status_code == 200
        data = response.json()
        for item in data["items"]:
            assert item["is_active"] is False

    @pytest.mark.asyncio
    async def test_list_dealerships_filter_by_store_id(
        self,
        owner_client: AsyncClient,
        test_dealership: Dealership,
        second_dealership: Dealership,
        test_store: Store,
    ):
        """Owner can filter dealerships by store_id."""
        response = await owner_client.get(
            "/api/v1/dealerships", params={"store_id": test_store.id}
        )
        assert response.status_code == 200
        data = response.json()
        for item in data["items"]:
            assert item["store_id"] == test_store.id

    @pytest.mark.asyncio
    async def test_list_dealerships_pagination(
        self,
        owner_client: AsyncClient,
        test_dealership: Dealership,
    ):
        """Owner can paginate dealerships."""
        response = await owner_client.get(
            "/api/v1/dealerships", params={"page": 1, "limit": 1}
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) <= 1
        assert "pagination" in data


class TestGetDealership:
    """Tests for get dealership endpoint."""

    @pytest.mark.asyncio
    async def test_get_dealership_success(
        self, owner_client: AsyncClient, test_dealership: Dealership
    ):
        """Should return dealership details."""
        response = await owner_client.get(f"/api/v1/dealerships/{test_dealership.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_dealership.id
        assert data["name"] == "Toyota Teste"
        assert data["brand"] == "Toyota"

    @pytest.mark.asyncio
    async def test_get_dealership_not_found(self, owner_client: AsyncClient):
        """Should return 404 for non-existent dealership."""
        response = await owner_client.get("/api/v1/dealerships/99999")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_operator_cannot_see_other_store_dealership(
        self,
        authenticated_client: AsyncClient,
        second_dealership: Dealership,
    ):
        """Operator should not see dealerships from another store."""
        response = await authenticated_client.get(
            f"/api/v1/dealerships/{second_dealership.id}"
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_operator_can_see_own_store_dealership(
        self,
        authenticated_client: AsyncClient,
        test_dealership: Dealership,
    ):
        """Operator should see dealerships from their own store."""
        response = await authenticated_client.get(
            f"/api/v1/dealerships/{test_dealership.id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_dealership.id


class TestCreateDealership:
    """Tests for create dealership endpoint."""

    @pytest.mark.asyncio
    async def test_create_dealership_as_owner(
        self, owner_client: AsyncClient, test_store: Store
    ):
        """Owner should be able to create dealerships."""
        response = await owner_client.post(
            "/api/v1/dealerships",
            json={
                "name": "Hyundai Teste",
                "brand": "Hyundai",
                "store_id": test_store.id,
                "address": "Av. Hyundai, 500",
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Hyundai Teste"
        assert data["brand"] == "Hyundai"
        assert data["is_active"] is True
        assert data["store_id"] == test_store.id

    @pytest.mark.asyncio
    async def test_create_dealership_nao_owner_forbidden(
        self, authenticated_client: AsyncClient, test_store: Store
    ):
        """Criar concessionária é Owner-only (coerente com editar/excluir)."""
        response = await authenticated_client.post(
            "/api/v1/dealerships",
            json={
                "name": "Fiat Operador",
                "brand": "Fiat",
                "store_id": test_store.id,
            },
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_create_dealership_invalid_store(
        self, owner_client: AsyncClient
    ):
        """Should return 404 for non-existent store."""
        response = await owner_client.post(
            "/api/v1/dealerships",
            json={
                "name": "Loja Inexistente",
                "brand": "Toyota",
                "store_id": 99999,
            },
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_create_dealership_name_too_short(
        self, owner_client: AsyncClient, test_store: Store
    ):
        """Should validate dealership name minimum length."""
        response = await owner_client.post(
            "/api/v1/dealerships",
            json={
                "name": "A",  # Too short (min_length=2)
                "brand": "Toyota",
                "store_id": test_store.id,
            },
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_dealership_unauthenticated(
        self, client: AsyncClient, test_store: Store
    ):
        """Unauthenticated request should return 401."""
        response = await client.post(
            "/api/v1/dealerships",
            json={
                "name": "Nova Concessionaria",
                "brand": "Toyota",
                "store_id": test_store.id,
            },
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_create_dealership_without_address(
        self, owner_client: AsyncClient, test_store: Store
    ):
        """Should create dealership without optional address field."""
        response = await owner_client.post(
            "/api/v1/dealerships",
            json={
                "name": "Sem Endereco",
                "brand": "Fiat",
                "store_id": test_store.id,
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["address"] is None


class TestUpdateDealership:
    """Tests for update dealership endpoint."""

    @pytest.mark.asyncio
    async def test_update_dealership_as_owner(
        self, owner_client: AsyncClient, test_dealership: Dealership
    ):
        """Owner should be able to update dealerships."""
        response = await owner_client.patch(
            f"/api/v1/dealerships/{test_dealership.id}",
            json={"name": "Toyota Atualizada"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Toyota Atualizada"

    @pytest.mark.asyncio
    async def test_update_dealership_as_operator_denied(
        self, authenticated_client: AsyncClient, test_dealership: Dealership
    ):
        """Operator should not be able to update dealerships."""
        response = await authenticated_client.patch(
            f"/api/v1/dealerships/{test_dealership.id}",
            json={"name": "Tentativa Update"},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_update_dealership_not_found(self, owner_client: AsyncClient):
        """Should return 404 for non-existent dealership."""
        response = await owner_client.patch(
            "/api/v1/dealerships/99999",
            json={"name": "Nao Existe"},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_dealership_brand(
        self, owner_client: AsyncClient, test_dealership: Dealership
    ):
        """Owner can update dealership brand."""
        response = await owner_client.patch(
            f"/api/v1/dealerships/{test_dealership.id}",
            json={"brand": "Hyundai"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["brand"] == "Hyundai"

    @pytest.mark.asyncio
    async def test_update_dealership_activate(
        self,
        owner_client: AsyncClient,
        test_dealership_inactive: Dealership,
    ):
        """Owner can reactivate an inactive dealership."""
        response = await owner_client.patch(
            f"/api/v1/dealerships/{test_dealership_inactive.id}",
            json={"is_active": True},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["is_active"] is True


class TestDeactivateDealership:
    """Tests for deactivate dealership endpoint."""

    @pytest.mark.asyncio
    async def test_deactivate_dealership_as_owner(
        self, owner_client: AsyncClient, test_dealership: Dealership
    ):
        """Owner should be able to deactivate dealerships."""
        response = await owner_client.delete(
            f"/api/v1/dealerships/{test_dealership.id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["is_active"] is False

    @pytest.mark.asyncio
    async def test_deactivate_dealership_as_operator_denied(
        self, authenticated_client: AsyncClient, test_dealership: Dealership
    ):
        """Operator should not be able to deactivate dealerships."""
        response = await authenticated_client.delete(
            f"/api/v1/dealerships/{test_dealership.id}"
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_deactivate_dealership_not_found(self, owner_client: AsyncClient):
        """Should return 404 for non-existent dealership."""
        response = await owner_client.delete("/api/v1/dealerships/99999")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_deactivate_does_not_delete(
        self,
        owner_client: AsyncClient,
        test_dealership: Dealership,
    ):
        """Deactivating a dealership should not delete it from the database."""
        response = await owner_client.delete(
            f"/api/v1/dealerships/{test_dealership.id}"
        )
        assert response.status_code == 200

        # Verify the dealership still exists
        get_response = await owner_client.get(
            f"/api/v1/dealerships/{test_dealership.id}"
        )
        assert get_response.status_code == 200
        assert get_response.json()["is_active"] is False


class TestDealershipResponseFields:
    """Tests for dealership response schema fields."""

    @pytest.mark.asyncio
    async def test_response_has_all_required_fields(
        self, owner_client: AsyncClient, test_dealership: Dealership
    ):
        """Dealership response should include all required fields."""
        response = await owner_client.get(f"/api/v1/dealerships/{test_dealership.id}")
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "name" in data
        assert "brand" in data
        assert "store_id" in data
        assert "is_active" in data
        assert "created_at" in data

    @pytest.mark.asyncio
    async def test_created_dealership_is_active_by_default(
        self, owner_client: AsyncClient, test_store: Store
    ):
        """Newly created dealership should be active by default."""
        response = await owner_client.post(
            "/api/v1/dealerships",
            json={
                "name": "Kia Padrao",
                "brand": "Kia",
                "store_id": test_store.id,
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["is_active"] is True

    @pytest.mark.asyncio
    async def test_list_dealerships_response_structure(
        self, owner_client: AsyncClient, test_dealership: Dealership
    ):
        """List response should have correct pagination structure."""
        response = await owner_client.get("/api/v1/dealerships")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "pagination" in data
        pagination = data["pagination"]
        assert "total" in pagination
        assert "page" in pagination
        assert "limit" in pagination
