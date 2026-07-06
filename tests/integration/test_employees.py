"""
Integration tests for the Employees module.
Tests CRUD operations for physical store employees (no system login).
"""

import pytest
from httpx import AsyncClient

from app.modules.stores.models import Store


class TestListEmployees:
    """Tests for GET /api/v1/employees."""

    @pytest.mark.asyncio
    async def test_list_employees_empty(
        self,
        authenticated_client: AsyncClient,
    ):
        """Should return empty list when no employees exist."""
        response = await authenticated_client.get("/api/v1/employees")
        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["pagination"]["total"] == 0

    @pytest.mark.asyncio
    async def test_list_employees_returns_created(
        self,
        authenticated_client: AsyncClient,
        test_employee,
    ):
        """Should return employees after creation."""
        response = await authenticated_client.get("/api/v1/employees")
        assert response.status_code == 200
        data = response.json()
        assert data["pagination"]["total"] == 1
        assert data["items"][0]["name"] == test_employee.name

    @pytest.mark.asyncio
    async def test_list_employees_filter_by_store(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
        test_employee,
    ):
        """Should filter employees by store_id."""
        response = await authenticated_client.get(
            f"/api/v1/employees?store_id={test_store.id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["pagination"]["total"] == 1

        # Filter with nonexistent store
        response = await authenticated_client.get("/api/v1/employees?store_id=9999")
        assert response.status_code == 200
        assert response.json()["pagination"]["total"] == 0

    @pytest.mark.asyncio
    async def test_list_employees_filter_by_active(
        self,
        authenticated_client: AsyncClient,
        test_employee,
    ):
        """Should filter employees by is_active status."""
        response = await authenticated_client.get("/api/v1/employees?is_active=true")
        assert response.status_code == 200
        assert response.json()["pagination"]["total"] == 1

        response = await authenticated_client.get("/api/v1/employees?is_active=false")
        assert response.status_code == 200
        assert response.json()["pagination"]["total"] == 0

    @pytest.mark.asyncio
    async def test_list_employees_search_by_name(
        self,
        authenticated_client: AsyncClient,
        test_employee,
    ):
        """Should filter employees by name search."""
        # Partial match
        response = await authenticated_client.get("/api/v1/employees?search=João")
        assert response.status_code == 200
        assert response.json()["pagination"]["total"] == 1

        # No match
        response = await authenticated_client.get("/api/v1/employees?search=ZZZ")
        assert response.status_code == 200
        assert response.json()["pagination"]["total"] == 0

    @pytest.mark.asyncio
    async def test_list_requires_authentication(self, client: AsyncClient):
        """Should return 401 for unauthenticated requests."""
        response = await client.get("/api/v1/employees")
        assert response.status_code == 401


class TestGetEmployee:
    """Tests for GET /api/v1/employees/{id}."""

    @pytest.mark.asyncio
    async def test_get_employee_success(
        self,
        authenticated_client: AsyncClient,
        test_employee,
        test_store: Store,
    ):
        """Should return employee details."""
        response = await authenticated_client.get(
            f"/api/v1/employees/{test_employee.id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_employee.id
        assert data["name"] == test_employee.name
        assert data["store_id"] == test_store.id
        assert data["is_active"] is True
        assert data["store_name"] == test_store.name

    @pytest.mark.asyncio
    async def test_get_employee_not_found(
        self,
        authenticated_client: AsyncClient,
    ):
        """Should return 404 for nonexistent employee."""
        response = await authenticated_client.get("/api/v1/employees/9999")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_get_requires_authentication(self, client: AsyncClient):
        """Should return 401 for unauthenticated requests."""
        response = await client.get("/api/v1/employees/1")
        assert response.status_code == 401


class TestCreateEmployee:
    """Tests for POST /api/v1/employees."""

    @pytest.mark.asyncio
    async def test_create_employee_success(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
    ):
        """Should create a new employee."""
        response = await authenticated_client.post(
            "/api/v1/employees",
            json={"name": "Maria Estética", "store_id": test_store.id},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Maria Estética"
        assert data["store_id"] == test_store.id
        assert data["is_active"] is True
        assert data["store_name"] == test_store.name
        assert "id" in data

    @pytest.mark.asyncio
    async def test_create_employee_invalid_store(
        self,
        authenticated_client: AsyncClient,
    ):
        """Should return 404 when store does not exist."""
        response = await authenticated_client.post(
            "/api/v1/employees",
            json={"name": "Pedro Instalador", "store_id": 9999},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_create_employee_name_too_short(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
    ):
        """Should return 422 when name is too short."""
        response = await authenticated_client.post(
            "/api/v1/employees",
            json={"name": "A", "store_id": test_store.id},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_employee_missing_fields(
        self,
        authenticated_client: AsyncClient,
    ):
        """Should return 422 when required fields are missing."""
        response = await authenticated_client.post(
            "/api/v1/employees",
            json={"name": "Carlos"},  # missing store_id
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_requires_authentication(self, client: AsyncClient):
        """Should return 401 for unauthenticated requests."""
        response = await client.post(
            "/api/v1/employees",
            json={"name": "Teste", "store_id": 1},
        )
        assert response.status_code == 401


class TestUpdateEmployee:
    """Tests for PATCH /api/v1/employees/{id}."""

    @pytest.mark.asyncio
    async def test_update_employee_name_as_owner_senior(
        self,
        owner_client: AsyncClient,
        test_employee,
    ):
        """Owner should be able to update employee name to senior title."""
        response = await owner_client.patch(
            f"/api/v1/employees/{test_employee.id}",
            json={"name": "João Instalador Sênior"},
        )
        assert response.status_code == 200
        assert response.json()["name"] == "João Instalador Sênior"

    @pytest.mark.asyncio
    async def test_update_employee_name_as_owner(
        self,
        owner_client: AsyncClient,
        test_employee,
    ):
        """Owner should be able to update employee name."""
        response = await owner_client.patch(
            f"/api/v1/employees/{test_employee.id}",
            json={"name": "João Instalador Master"},
        )
        assert response.status_code == 200
        assert response.json()["name"] == "João Instalador Master"

    @pytest.mark.asyncio
    async def test_update_employee_denied_for_operator(
        self,
        authenticated_client: AsyncClient,
        test_employee,
    ):
        """Operator should NOT be able to update employees."""
        response = await authenticated_client.patch(
            f"/api/v1/employees/{test_employee.id}",
            json={"name": "Tentativa Não Autorizada"},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_update_employee_not_found(
        self,
        owner_client: AsyncClient,
    ):
        """Should return 404 for nonexistent employee."""
        response = await owner_client.patch(
            "/api/v1/employees/9999",
            json={"name": "Fantasma"},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_update_employee_partial(
        self,
        owner_client: AsyncClient,
        test_employee,
    ):
        """Should allow partial updates (only is_active)."""
        response = await owner_client.patch(
            f"/api/v1/employees/{test_employee.id}",
            json={"is_active": False},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["is_active"] is False
        # Name should remain unchanged
        assert data["name"] == test_employee.name


class TestDeactivateEmployee:
    """Tests for DELETE /api/v1/employees/{id} (permanent delete)."""

    @pytest.mark.asyncio
    async def test_deactivate_employee_as_owner(
        self,
        owner_client: AsyncClient,
        test_employee,
    ):
        """Owner should be able to permanently delete an employee."""
        response = await owner_client.delete(f"/api/v1/employees/{test_employee.id}")
        assert response.status_code == 200
        assert response.json()["id"] == test_employee.id

    @pytest.mark.asyncio
    async def test_deactivate_denied_for_operator(
        self,
        authenticated_client: AsyncClient,
        test_employee,
    ):
        """Operator should NOT be able to delete employees."""
        response = await authenticated_client.delete(
            f"/api/v1/employees/{test_employee.id}"
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_deactivate_not_found(
        self,
        owner_client: AsyncClient,
    ):
        """Should return 404 for nonexistent employee."""
        response = await owner_client.delete("/api/v1/employees/9999")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_removes_from_db(
        self,
        owner_client: AsyncClient,
        test_employee,
        db_session,
    ):
        """Employee should be removed from DB after permanent delete."""
        employee_id = test_employee.id
        response = await owner_client.delete(
            f"/api/v1/employees/{employee_id}"
        )
        assert response.status_code == 200

        from sqlalchemy import select

        from app.modules.employees.models import Employee as EmployeeModel
        result = await db_session.execute(
            select(EmployeeModel).where(EmployeeModel.id == employee_id)
        )
        assert result.scalar_one_or_none() is None
