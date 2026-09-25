"""
Integration tests for consultants endpoints.
Tests CRUD operations, permissions, and filtering.
"""

from unittest.mock import patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.modules.auth.models import User
from app.modules.consultants.models import Consultant
from app.modules.dealerships.models import Dealership
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
        response = await authenticated_client.get(f"/api/v1/consultants?store_id={test_store.id}")
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
        response = await authenticated_client.get("/api/v1/consultants?is_active=true")
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
        response = await authenticated_client.get("/api/v1/consultants?is_active=false")
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
        response = await authenticated_client.get("/api/v1/consultants?page=1&limit=5")
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
        response = await authenticated_client.get(f"/api/v1/consultants/{test_consultant.id}")
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
        response = await owner_client.get(f"/api/v1/consultants/{test_consultant.id}")
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

        response = await authenticated_client.get(f"/api/v1/consultants/{other_consultant.id}")
        assert response.status_code == 404


class TestCreateConsultant:
    """Tests for create consultant endpoint."""

    @pytest.mark.asyncio
    async def test_create_without_dealership_reuses_single_geral(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        db_session: AsyncSession,
    ):
        """Dois consultores sem concessionária na mesma loja reusam UMA "Geral" (sem fantasma)."""
        from sqlalchemy import func, select

        for name in ("Sem Conc 1", "Sem Conc 2"):
            resp = await owner_client.post(
                "/api/v1/consultants",
                json={"name": name, "store_id": test_store.id},
            )
            assert resp.status_code == 201, resp.text

        geral_count = await db_session.scalar(
            select(func.count())
            .select_from(Dealership)
            .where(Dealership.store_id == test_store.id, Dealership.brand == "Geral")
        )
        assert geral_count == 1

    @pytest.mark.asyncio
    async def test_create_reactivates_inactive_geral(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        db_session: AsyncSession,
    ):
        """Se a única "Geral" da loja está inativa, o reuso a reativa (coerência com o índice).

        Força o ramo `except IntegrityError`: o helper busca concessionária ATIVA
        (não acha), tenta criar uma "Geral" ativa e colide com o índice parcial
        (que conta a inativa) → re-seleciona e deve reativar, não vincular a uma
        concessionária inativa.
        """
        inactive = Dealership(name="Geral", brand="Geral", store_id=test_store.id, is_active=False)
        db_session.add(inactive)
        await db_session.commit()

        resp = await owner_client.post(
            "/api/v1/consultants",
            json={"name": "Consultor Reativa", "store_id": test_store.id},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["dealership_id"] == inactive.id
        await db_session.refresh(inactive)
        assert inactive.is_active is True

    @pytest.mark.asyncio
    async def test_create_consultant_success(
        self,
        owner_client: AsyncClient,
        test_dealership: Dealership,
        test_store: Store,
    ):
        """Should create a new consultant."""
        response = await owner_client.post(
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
        owner_client: AsyncClient,
        test_dealership: Dealership,
        test_store: Store,
    ):
        """Should create consultant without optional email."""
        response = await owner_client.post(
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
        owner_client: AsyncClient,
        test_store: Store,
    ):
        """Should return 404 when dealership_id does not exist."""
        response = await owner_client.post(
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
        owner_client: AsyncClient,
        test_dealership: Dealership,
    ):
        """Should return 404 when store_id does not exist."""
        response = await owner_client.post(
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
        owner_client: AsyncClient,
        test_dealership: Dealership,
        test_store: Store,
    ):
        """Should reject name with less than 2 characters."""
        response = await owner_client.post(
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
        response = await owner_client.delete(f"/api/v1/consultants/{test_consultant.id}")
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
        response = await authenticated_client.delete(f"/api/v1/consultants/{test_consultant.id}")
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

        response = await owner_client.delete(f"/api/v1/consultants/{consultant_id}")
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
        response = await authenticated_client.get(f"/api/v1/consultants/{test_consultant.id}")
        assert response.status_code == 200
        data = response.json()
        required_fields = [
            "id",
            "name",
            "phone",
            "email",
            "dealership_id",
            "store_id",
            "is_active",
            "created_at",
        ]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"

    @pytest.mark.asyncio
    async def test_created_consultant_returned_with_correct_defaults(
        self,
        owner_client: AsyncClient,
        test_dealership: Dealership,
        test_store: Store,
    ):
        """Newly created consultant should have is_active=True by default."""
        response = await owner_client.post(
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


class TestConsultantUpdateDeleteByProfile:
    """C1 (auditoria): update/delete de consultor por consultants:can_edit / can_delete.

    Antes eram require_roles(OWNER) enquanto o create já exigia consultants:can_edit
    ('pode criar, não pode editar'). Escopo de loja segue garantido via get_consultant
    (require_resource_access na dealership.store_id).
    """

    @pytest.mark.asyncio
    async def test_update_por_perfil_consultants_can_edit(
        self, client: AsyncClient, db_session, test_store, test_consultant
    ):
        from tests.integration.test_permission_enforcement import _login_as, _make_scoped_user

        await _make_scoped_user(db_session, test_store, "consultants", "cons_editor@test.com")
        await _login_as(client, "cons_editor@test.com")
        resp = await client.patch(
            f"/api/v1/consultants/{test_consultant.id}", json={"name": "Nome Editado"}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == "Nome Editado"

    @pytest.mark.asyncio
    async def test_update_sem_grant_consultants_403(
        self, authenticated_client: AsyncClient, test_consultant
    ):
        """authenticated_client só tem service_orders → 403."""
        resp = await authenticated_client.patch(
            f"/api/v1/consultants/{test_consultant.id}", json={"name": "X"}
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_update_consultor_de_outra_loja_404(
        self, client: AsyncClient, db_session, second_store, test_consultant
    ):
        """Escopo: consultants:can_edit de outra loja não acessa o consultor (404)."""
        from tests.integration.test_permission_enforcement import _login_as, _make_scoped_user

        await _make_scoped_user(db_session, second_store, "consultants", "cons_other@test.com")
        await _login_as(client, "cons_other@test.com")
        resp = await client.patch(
            f"/api/v1/consultants/{test_consultant.id}", json={"name": "Tentativa Invasao"}
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_requer_can_delete(
        self, client: AsyncClient, db_session, test_store, test_consultant
    ):
        """can_edit=True mas can_delete=False → 403 no delete."""
        from tests.integration.test_permission_enforcement import _login_as, _make_scoped_user

        await _make_scoped_user(
            db_session, test_store, "consultants", "cons_nodel@test.com", can_delete=False
        )
        await _login_as(client, "cons_nodel@test.com")
        resp = await client.delete(f"/api/v1/consultants/{test_consultant.id}")
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_delete_por_perfil_can_delete(
        self, client: AsyncClient, db_session, test_store, test_consultant
    ):
        from tests.integration.test_permission_enforcement import _login_as, _make_scoped_user

        await _make_scoped_user(db_session, test_store, "consultants", "cons_del@test.com")
        await _login_as(client, "cons_del@test.com")
        resp = await client.delete(f"/api/v1/consultants/{test_consultant.id}")
        assert resp.status_code == 200, resp.text

    @pytest.mark.asyncio
    async def test_update_mover_para_loja_fora_do_escopo_404(
        self, client: AsyncClient, db_session, test_store, second_store, test_consultant
    ):
        """C1: não escapar do escopo movendo o consultor para loja sem acesso (404)."""
        from tests.integration.test_permission_enforcement import _login_as, _make_scoped_user

        await _make_scoped_user(db_session, test_store, "consultants", "cons_move@test.com")
        await _login_as(client, "cons_move@test.com")
        resp = await client.patch(
            f"/api/v1/consultants/{test_consultant.id}", json={"store_id": second_store.id}
        )
        assert resp.status_code == 404


class TestConsultantsListCache:
    """
    Cache de leitura (cached_catalog) do GET /consultants, consumido pelo
    editor de O.S. A suíte roda com DEBUG=true (bypass total, ver conftest),
    então cada teste liga o cache (DEBUG=False) com um Redis fake e restaura
    no finally — mesmo padrão de tests/unit/test_catalog_cache.py.
    """

    @pytest.mark.asyncio
    async def test_list_is_cached_until_bump(
        self,
        authenticated_client: AsyncClient,
        test_consultant: Consultant,
        test_dealership: Dealership,
        test_store: Store,
        db_session: AsyncSession,
    ):
        """2ª leitura não reflete um consultor novo até bump_catalogs_cache()."""
        from app.core.redis import bump_catalogs_cache

        settings = get_settings()
        fake = _FakeRedis()
        object.__setattr__(settings, "DEBUG", False)
        try:
            with patch("app.core.redis.get_redis", return_value=fake):
                # Semeia a versão antes da 1ª leitura: um INCR do Redis numa chave
                # ausente cria-a em 1 — mesmo valor que a leitura já assume por
                # padrão sem essa chave — então o 1º bump da vida do Redis seria
                # um no-op. Todo bump seguinte (o caso real de produção, já que
                # toda mutação de catálogo bumpa) invalida normalmente.
                await bump_catalogs_cache()

                first = await authenticated_client.get("/api/v1/consultants")
                assert first.status_code == 200
                total_first = first.json()["pagination"]["total"]

                # Novo consultor inserido direto no banco (sem passar pelo hook
                # de invalidação do endpoint HTTP) — a leitura cacheada não
                # deve enxergá-lo ainda.
                new_consultant = Consultant(
                    name="Consultor Fora do Cache",
                    dealership_id=test_dealership.id,
                    store_id=test_store.id,
                    is_active=True,
                )
                db_session.add(new_consultant)
                await db_session.commit()

                second = await authenticated_client.get("/api/v1/consultants")
                assert second.json()["pagination"]["total"] == total_first  # ainda cache

                await bump_catalogs_cache()

                third = await authenticated_client.get("/api/v1/consultants")
                assert third.json()["pagination"]["total"] == total_first + 1  # recomputou
        finally:
            object.__setattr__(settings, "DEBUG", True)

    @pytest.mark.asyncio
    async def test_scope_isolation_between_users(
        self,
        authenticated_client: AsyncClient,
        test_owner: User,
        test_consultant: Consultant,
        second_store: Store,
        db_session: AsyncSession,
    ):
        """
        A chave de cache inclui o escopo do usuário (store_scope_cache_key):
        um usuário restrito à test_store e o Owner (todas as lojas) não podem
        compartilhar a mesma entrada de cache.

        `authenticated_client`/`owner_client` são o MESMO objeto AsyncClient por
        trás (o fixture `client` é reaproveitado e tem o header Authorization
        sobrescrito) — pedi-los juntos faria o 2º login vazar para o 1º. Por
        isso a identidade é trocada no mesmo client via novo login, como o
        helper `_login_as` de test_permission_enforcement.py já faz.
        """
        from tests.conftest import VALID_OWNER_PASSWORD

        settings = get_settings()
        fake = _FakeRedis()
        object.__setattr__(settings, "DEBUG", False)
        try:
            with patch("app.core.redis.get_redis", return_value=fake):
                # Consultor de outra loja, fora do escopo do usuário comum.
                other_dealership = Dealership(
                    name="Outra Concessionária",
                    store_id=second_store.id,
                    brand="Honda",
                    is_active=True,
                )
                db_session.add(other_dealership)
                await db_session.flush()
                other_consultant = Consultant(
                    name="Consultor Loja 2",
                    dealership_id=other_dealership.id,
                    store_id=second_store.id,
                    is_active=True,
                )
                db_session.add(other_consultant)
                await db_session.commit()

                scoped_resp = await authenticated_client.get("/api/v1/consultants")
                scoped_names = {i["name"] for i in scoped_resp.json()["items"]}

                login = await authenticated_client.post(
                    "/api/v1/auth/login",
                    data={"username": test_owner.email, "password": VALID_OWNER_PASSWORD},
                )
                assert login.status_code == 200, login.text
                authenticated_client.headers["Authorization"] = (
                    f"Bearer {login.json()['access_token']}"
                )

                owner_resp = await authenticated_client.get("/api/v1/consultants")
                owner_names = {i["name"] for i in owner_resp.json()["items"]}

                # Owner vê as duas lojas; o usuário escopado só vê a própria —
                # se a chave de cache não incluísse o escopo, um serviria a
                # resposta do outro (vazamento entre lojas).
                assert other_consultant.name not in scoped_names
                assert other_consultant.name in owner_names
                assert test_consultant.name in scoped_names
                assert test_consultant.name in owner_names
        finally:
            object.__setattr__(settings, "DEBUG", True)
