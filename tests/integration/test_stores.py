"""
Integration tests for store endpoints.
"""

import pytest
from httpx import AsyncClient

from app.modules.brands.models import Brand
from app.modules.stores.models import Store


class TestListStores:
    """Tests for list stores endpoint."""

    @pytest.mark.asyncio
    async def test_list_stores_as_owner(
        self, owner_client: AsyncClient, test_store: Store
    ):
        """Owner should see all stores."""
        response = await owner_client.get("/api/v1/stores")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "pagination" in data
        assert len(data["items"]) >= 1

    @pytest.mark.asyncio
    async def test_list_stores_as_operator(
        self, authenticated_client: AsyncClient, test_store: Store
    ):
        """Operator should only see their store."""
        response = await authenticated_client.get("/api/v1/stores")
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["id"] == test_store.id

    @pytest.mark.asyncio
    async def test_list_stores_unauthenticated(self, client: AsyncClient):
        """Unauthenticated request should return 401."""
        response = await client.get("/api/v1/stores")
        assert response.status_code == 401


class TestGetStore:
    """Tests for get store endpoint."""

    @pytest.mark.asyncio
    async def test_get_store_success(
        self, owner_client: AsyncClient, test_store: Store
    ):
        """Should return store details."""
        response = await owner_client.get(f"/api/v1/stores/{test_store.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_store.id
        assert data["code"] == "LJ01"
        assert data["name"] == "Loja Teste 01"

    @pytest.mark.asyncio
    async def test_get_store_not_found(self, owner_client: AsyncClient):
        """Should return 404 for non-existent store."""
        response = await owner_client.get("/api/v1/stores/99999")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_operator_cannot_see_other_store(
        self, authenticated_client: AsyncClient, second_store: Store
    ):
        """Operator should not see store they don't belong to."""
        response = await authenticated_client.get(f"/api/v1/stores/{second_store.id}")
        assert response.status_code == 404


class TestCreateStore:
    """Tests for create store endpoint."""

    @pytest.mark.asyncio
    async def test_create_store_as_owner(
        self, owner_client: AsyncClient, test_brand: Brand
    ):
        """Owner should be able to create stores."""
        response = await owner_client.post(
            "/api/v1/stores",
            json={
                "name": "Nova Loja",
                "code": "LJ99",
                "address": "Rua Nova, 999",
                "phone": "11999999999",
                "brand_id": test_brand.id,
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["code"] == "LJ99"
        assert data["name"] == "Nova Loja"
        assert data["is_active"] is True

    @pytest.mark.asyncio
    async def test_create_store_as_operator_denied(
        self, authenticated_client: AsyncClient, test_brand: Brand
    ):
        """Operator should not be able to create stores."""
        response = await authenticated_client.post(
            "/api/v1/stores",
            json={
                "name": "Nova Loja",
                "code": "LJ98",
                "brand_id": test_brand.id,
            },
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_create_store_duplicate_code(
        self, owner_client: AsyncClient, test_store: Store, test_brand: Brand
    ):
        """Should return conflict for duplicate store code."""
        response = await owner_client.post(
            "/api/v1/stores",
            json={
                "name": "Outra Loja",
                "code": "LJ01",  # Already exists
                "brand_id": test_brand.id,
            },
        )
        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_create_store_invalid_code(
        self, owner_client: AsyncClient, test_brand: Brand
    ):
        """Should validate store code format."""
        response = await owner_client.post(
            "/api/v1/stores",
            json={
                "name": "Loja Invalida",
                "code": "INVALID",  # Should match LJ\d{2}
                "brand_id": test_brand.id,
            },
        )
        assert response.status_code == 422


class TestUpdateStore:
    """Tests for update store endpoint."""

    @pytest.mark.asyncio
    async def test_update_store_as_owner(
        self, owner_client: AsyncClient, test_store: Store
    ):
        """Owner should be able to update stores."""
        response = await owner_client.patch(
            f"/api/v1/stores/{test_store.id}",
            json={"name": "Loja Atualizada"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Loja Atualizada"

    @pytest.mark.asyncio
    async def test_update_store_as_operator_denied(
        self, authenticated_client: AsyncClient, test_store: Store
    ):
        """Operator should not be able to update stores."""
        response = await authenticated_client.patch(
            f"/api/v1/stores/{test_store.id}",
            json={"name": "Tentativa de Update"},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_update_store_not_found(self, owner_client: AsyncClient):
        """Should return 404 for non-existent store."""
        response = await owner_client.patch(
            "/api/v1/stores/99999",
            json={"name": "Nome"},
        )
        assert response.status_code == 404


class TestDeactivateStore:
    """Tests for delete store endpoint."""

    @pytest.mark.asyncio
    async def test_deactivate_store_as_owner(
        self, owner_client: AsyncClient, test_store: Store
    ):
        """Owner should be able to permanently delete stores."""
        response = await owner_client.delete(f"/api/v1/stores/{test_store.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_store.id

    @pytest.mark.asyncio
    async def test_deactivate_store_as_operator_denied(
        self, authenticated_client: AsyncClient, test_store: Store
    ):
        """Operator should not be able to deactivate stores."""
        response = await authenticated_client.delete(f"/api/v1/stores/{test_store.id}")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_deactivate_store_not_found(self, owner_client: AsyncClient):
        """Should return 404 for non-existent store."""
        response = await owner_client.delete("/api/v1/stores/99999")
        assert response.status_code == 404



class TestListStoresExtended:
    """Extended tests for list stores covering service.py branches."""

    @pytest.mark.asyncio
    async def test_list_stores_filter_active(
        self, owner_client: AsyncClient, test_store: Store
    ):
        """Owner can filter stores by is_active=true."""
        response = await owner_client.get("/api/v1/stores", params={"is_active": "true"})
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        for item in data["items"]:
            assert item["is_active"] is True

    @pytest.mark.asyncio
    async def test_list_stores_filter_inactive(
        self, owner_client: AsyncClient, test_brand: Brand, db_session
    ):
        """Owner can filter stores by is_active=false."""
        from app.modules.stores.models import Store as StoreModel
        inactive = StoreModel(
            name="Inactive Store",
            code="LJ97",
            address="Rua Inativa, 1",
            phone="11000000000",
            is_active=False,
            brand_id=test_brand.id,
        )
        db_session.add(inactive)
        await db_session.commit()

        response = await owner_client.get("/api/v1/stores", params={"is_active": "false"})
        assert response.status_code == 200
        data = response.json()
        for item in data["items"]:
            assert item["is_active"] is False

    @pytest.mark.asyncio
    async def test_list_stores_pagination(
        self, owner_client: AsyncClient, test_store: Store, second_store
    ):
        """Owner can paginate stores."""
        response = await owner_client.get("/api/v1/stores", params={"page": 1, "limit": 1})
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) <= 1
        assert "pagination" in data


class TestGetStoreExtended:
    """Extended tests for get store covering service.py branches."""

    @pytest.mark.asyncio
    async def test_operator_can_see_own_store(
        self, authenticated_client: AsyncClient, test_store: Store
    ):
        """Operator should see their own store."""
        response = await authenticated_client.get(f"/api/v1/stores/{test_store.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_store.id


class TestCreateStoreExtended:
    """Extended tests for create store covering service.py branches."""

    @pytest.mark.asyncio
    async def test_create_store_with_all_fields(
        self, owner_client: AsyncClient, test_brand: Brand
    ):
        """Owner can create store with all optional fields."""
        response = await owner_client.post(
            "/api/v1/stores",
            json={
                "name": "Loja Completa",
                "code": "LJ96",
                "address": "Av. Completa, 1000",
                "phone": "11777777777",
                "brand_id": test_brand.id,
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["code"] == "LJ96"
        assert data["is_active"] is True



class TestUpdateStoreExtended:
    """Extended tests for update store covering service.py branches."""

    @pytest.mark.asyncio
    async def test_update_store_phone(
        self, owner_client: AsyncClient, test_store: Store
    ):
        """Owner can update store phone."""
        response = await owner_client.patch(
            f"/api/v1/stores/{test_store.id}",
            json={"phone": "11111111111"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["phone"] == "11111111111"

    @pytest.mark.asyncio
    async def test_update_store_address(
        self, owner_client: AsyncClient, test_store: Store
    ):
        """Owner can update store address."""
        response = await owner_client.patch(
            f"/api/v1/stores/{test_store.id}",
            json={"address": "Nova Rua, 999"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["address"] == "Nova Rua, 999"

