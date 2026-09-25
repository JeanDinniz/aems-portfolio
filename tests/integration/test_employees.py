"""
Integration tests for the Employees module.
Tests CRUD operations for physical store employees (no system login).
"""

from unittest.mock import patch

import pytest
from httpx import AsyncClient

from app.config import get_settings
from app.modules.stores.models import Store


class _FakeRedis:
    """Fake mínimo de redis.asyncio.Redis (get/setex/incr) para ligar o cache
    de catálogos nestes testes sem depender de um Redis real."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def setex(self, key: str, ttl: int, value: str) -> None:
        self.store[key] = value

    async def incr(self, key: str) -> int:
        current = int(self.store.get(key, 0)) + 1
        self.store[key] = str(current)
        return current


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
        response = await authenticated_client.get(f"/api/v1/employees?store_id={test_store.id}")
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


class TestEmployeeUserLinkFilter:
    """Tests for GET /api/v1/employees?has_user=... (vínculo com usuário)."""

    @pytest.mark.asyncio
    async def test_filter_has_user_before_and_after_link(
        self,
        owner_client: AsyncClient,
        test_employee,
        test_user,
    ):
        """has_user should reflect the Employee.user_id link state."""
        # Sem vínculo: has_user=false encontra, has_user=true não
        response = await owner_client.get("/api/v1/employees?has_user=false")
        assert response.status_code == 200
        assert response.json()["pagination"]["total"] == 1

        response = await owner_client.get("/api/v1/employees?has_user=true")
        assert response.status_code == 200
        assert response.json()["pagination"]["total"] == 0

        # Vincular via PATCH
        response = await owner_client.patch(
            f"/api/v1/employees/{test_employee.id}",
            json={"user_id": test_user.id},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["user_id"] == test_user.id
        assert data["user_name"] == test_user.full_name

        # Com vínculo: filtros invertem
        response = await owner_client.get("/api/v1/employees?has_user=true")
        assert response.status_code == 200
        data = response.json()
        assert data["pagination"]["total"] == 1
        assert data["items"][0]["id"] == test_employee.id

        response = await owner_client.get("/api/v1/employees?has_user=false")
        assert response.status_code == 200
        assert response.json()["pagination"]["total"] == 0

    @pytest.mark.asyncio
    async def test_filter_has_user_omitted_returns_all(
        self,
        owner_client: AsyncClient,
        test_employee,
    ):
        """Without has_user, all employees are returned."""
        response = await owner_client.get("/api/v1/employees")
        assert response.status_code == 200
        assert response.json()["pagination"]["total"] == 1


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
        response = await authenticated_client.get(f"/api/v1/employees/{test_employee.id}")
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
        owner_client: AsyncClient,
        test_store: Store,
    ):
        """Should create a new employee (owner has employees permission)."""
        response = await owner_client.post(
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
        owner_client: AsyncClient,
    ):
        """Should return 404 when store does not exist."""
        response = await owner_client.post(
            "/api/v1/employees",
            json={"name": "Pedro Instalador", "store_id": 9999},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_create_employee_forbidden_without_permission(
        self,
        authenticated_client: AsyncClient,
        test_store: Store,
    ):
        """Regressão de segurança: usuário sem employees:can_edit recebe 403."""
        response = await authenticated_client.post(
            "/api/v1/employees",
            json={"name": "Sem Permissão", "store_id": test_store.id},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_create_employee_name_too_short(
        self,
        owner_client: AsyncClient,
        test_store: Store,
    ):
        """Should return 422 when name is too short."""
        response = await owner_client.post(
            "/api/v1/employees",
            json={"name": "A", "store_id": test_store.id},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_create_employee_missing_fields(
        self,
        owner_client: AsyncClient,
    ):
        """Should return 422 when required fields are missing."""
        response = await owner_client.post(
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
        response = await authenticated_client.delete(f"/api/v1/employees/{test_employee.id}")
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
        response = await owner_client.delete(f"/api/v1/employees/{employee_id}")
        assert response.status_code == 200

        from sqlalchemy import select

        from app.modules.employees.models import Employee as EmployeeModel

        result = await db_session.execute(
            select(EmployeeModel).where(EmployeeModel.id == employee_id)
        )
        assert result.scalar_one_or_none() is None


class TestEmployeeUpdateDeleteByProfile:
    """C3 (auditoria): update/delete de funcionário por employees:can_edit / can_delete.

    Antes eram require_roles(OWNER) enquanto create/movements já exigiam
    employees:can_edit ('trava do OWNER contornável por movement lateral'). Ao abrir
    a permissão, adicionou-se escopo de loja em update_employee/delete_employee
    (require_resource_access) — antes ausente, pois o gate OWNER o dispensava.
    """

    @pytest.mark.asyncio
    async def test_update_por_perfil_employees_can_edit(
        self, client: AsyncClient, db_session, test_store, test_employee
    ):
        from tests.integration.test_permission_enforcement import _login_as, _make_scoped_user

        await _make_scoped_user(db_session, test_store, "employees", "emp_editor@test.com")
        await _login_as(client, "emp_editor@test.com")
        resp = await client.patch(
            f"/api/v1/employees/{test_employee.id}", json={"name": "Nome Editado"}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == "Nome Editado"

    @pytest.mark.asyncio
    async def test_update_sem_grant_employees_403(
        self, authenticated_client: AsyncClient, test_employee
    ):
        """authenticated_client só tem service_orders → 403."""
        resp = await authenticated_client.patch(
            f"/api/v1/employees/{test_employee.id}", json={"name": "X"}
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_update_funcionario_de_outra_loja_404(
        self, client: AsyncClient, db_session, second_store, test_employee
    ):
        """Escopo: employees:can_edit de outra loja não acessa o funcionário (404)."""
        from tests.integration.test_permission_enforcement import _login_as, _make_scoped_user

        await _make_scoped_user(db_session, second_store, "employees", "emp_other@test.com")
        await _login_as(client, "emp_other@test.com")
        resp = await client.patch(
            f"/api/v1/employees/{test_employee.id}", json={"name": "Tentativa Invasao"}
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_requer_can_delete(
        self, client: AsyncClient, db_session, test_store, test_employee
    ):
        """can_edit=True mas can_delete=False → 403 no delete."""
        from tests.integration.test_permission_enforcement import _login_as, _make_scoped_user

        await _make_scoped_user(
            db_session, test_store, "employees", "emp_nodel@test.com", can_delete=False
        )
        await _login_as(client, "emp_nodel@test.com")
        resp = await client.delete(f"/api/v1/employees/{test_employee.id}")
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_delete_por_perfil_can_delete(
        self, client: AsyncClient, db_session, test_store, test_employee
    ):
        from tests.integration.test_permission_enforcement import _login_as, _make_scoped_user

        await _make_scoped_user(db_session, test_store, "employees", "emp_del@test.com")
        await _login_as(client, "emp_del@test.com")
        resp = await client.delete(f"/api/v1/employees/{test_employee.id}")
        assert resp.status_code == 200, resp.text

    @pytest.mark.asyncio
    async def test_update_mover_para_loja_fora_do_escopo_404(
        self, client: AsyncClient, db_session, test_store, second_store, test_employee
    ):
        """C3: não escapar do escopo movendo o funcionário para loja sem acesso (404)."""
        from tests.integration.test_permission_enforcement import _login_as, _make_scoped_user

        await _make_scoped_user(db_session, test_store, "employees", "emp_move@test.com")
        await _login_as(client, "emp_move@test.com")
        resp = await client.patch(
            f"/api/v1/employees/{test_employee.id}", json={"store_id": second_store.id}
        )
        assert resp.status_code == 404


class TestEmployeesListCache:
    """
    Cache de leitura (cached_catalog) do GET /employees, consumido pelo
    editor de O.S. (funcionários por loja+departamento). A suíte roda com
    DEBUG=true (bypass total, ver conftest); cada teste liga o cache
    (DEBUG=False) com um Redis fake e restaura no finally.
    """

    @pytest.mark.asyncio
    async def test_list_is_cached_until_bump(
        self,
        authenticated_client: AsyncClient,
        test_employee,
        db_session,
    ):
        """2ª leitura não reflete um funcionário novo até bump_catalogs_cache()."""
        from app.core.redis import bump_catalogs_cache
        from app.modules.employees.models import Employee

        settings = get_settings()
        fake = _FakeRedis()
        object.__setattr__(settings, "DEBUG", False)
        try:
            with patch("app.core.redis.get_redis", return_value=fake):
                # Semeia a versão antes da 1ª leitura: um INCR do Redis numa chave
                # ausente cria-a em 1 — mesmo valor que a leitura já assume por
                # padrão sem essa chave — então o 1º bump da vida do Redis seria
                # um no-op. Todo bump seguinte (o caso real de produção) invalida
                # normalmente.
                await bump_catalogs_cache()

                first = await authenticated_client.get("/api/v1/employees")
                assert first.status_code == 200
                assert first.json()["pagination"]["total"] == 1

                new_employee = Employee(
                    name="Funcionário Fora do Cache",
                    store_id=test_employee.store_id,
                    is_active=True,
                )
                db_session.add(new_employee)
                await db_session.commit()

                second = await authenticated_client.get("/api/v1/employees")
                assert second.json()["pagination"]["total"] == 1  # ainda cache

                await bump_catalogs_cache()

                third = await authenticated_client.get("/api/v1/employees")
                assert third.json()["pagination"]["total"] == 2  # recomputou
        finally:
            object.__setattr__(settings, "DEBUG", True)

    @pytest.mark.asyncio
    async def test_scope_isolation_between_users(
        self,
        authenticated_client: AsyncClient,
        test_owner,
        test_employee,
        second_store: Store,
        db_session,
    ):
        """
        A chave de cache inclui o escopo do usuário (store_scope_cache_key):
        um usuário restrito à test_store não pode herdar do cache o resultado
        do Owner (todas as lojas), nem vice-versa.

        `authenticated_client`/`owner_client` são o MESMO AsyncClient por trás
        (o fixture `client` é reaproveitado com o header Authorization
        sobrescrito) — pedi-los juntos faria o 2º login vazar para o 1º. A
        identidade é trocada no mesmo client via novo login, como o helper
        `_login_as` de test_permission_enforcement.py já faz.
        """
        from app.modules.employees.models import Employee
        from tests.conftest import VALID_OWNER_PASSWORD

        settings = get_settings()
        fake = _FakeRedis()
        object.__setattr__(settings, "DEBUG", False)
        try:
            with patch("app.core.redis.get_redis", return_value=fake):
                other_employee = Employee(
                    name="Funcionário Loja 2",
                    store_id=second_store.id,
                    is_active=True,
                )
                db_session.add(other_employee)
                await db_session.commit()

                scoped_resp = await authenticated_client.get("/api/v1/employees")
                scoped_names = {i["name"] for i in scoped_resp.json()["items"]}

                login = await authenticated_client.post(
                    "/api/v1/auth/login",
                    data={"username": test_owner.email, "password": VALID_OWNER_PASSWORD},
                )
                assert login.status_code == 200, login.text
                authenticated_client.headers["Authorization"] = (
                    f"Bearer {login.json()['access_token']}"
                )

                owner_resp = await authenticated_client.get("/api/v1/employees")
                owner_names = {i["name"] for i in owner_resp.json()["items"]}

                assert other_employee.name not in scoped_names
                assert other_employee.name in owner_names
                assert test_employee.name in scoped_names
                assert test_employee.name in owner_names
        finally:
            object.__setattr__(settings, "DEBUG", True)
