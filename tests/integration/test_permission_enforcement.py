"""Regressão da auditoria 2026-08-21 — travas que estavam só no frontend.

Cada teste reproduz, via API, o bypass que a UI escondia: um usuário SEM a
permissão do módulo tenta a ação e deve receber 403. Prova que a regra agora é
garantida no backend (fonte da verdade), não só na tela.

Nota: o perfil de `test_user` (fixture `test_user_profile`) concede apenas
`service_orders` (view/edit/delete). Não concede `conference`, `models`,
`consultants` etc. — por isso ele é o "atacante" ideal para estes testes.
"""

import json
from datetime import UTC, date, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash
from app.modules.access_profiles.models import (
    AccessProfile,
    AccessProfileModulePermission,
    access_profile_stores,
    access_profile_users,
)
from app.modules.auth.models import User
from app.modules.brands.models import Brand
from app.modules.inventory.models import FilmRoll, FilmType
from app.modules.service_orders.models import ServiceOrder
from app.modules.stores.models import Store
from tests.conftest import VALID_TEST_PASSWORD


async def _make_scoped_user(
    db_session,
    store,
    sub_module: str,
    email: str,
    *,
    can_view: bool = True,
    can_edit: bool = True,
    can_delete: bool = True,
    direct_store=None,
    scheduling_departments: list[str] | None = None,
) -> None:
    """Cria um usuário com o perfil concedendo `sub_module`, vinculado a `store`.

    - `direct_store`: loja direta do usuário (padrão: `store`). Use uma loja
      DIFERENTE de `store` para testar restrição de departamento (a loja direta
      concede todos os departamentos).
    - `scheduling_departments`: restringe os departamentos do perfil no Agendamento.
    """
    user = User(
        email=email,
        hashed_password=get_password_hash(VALID_TEST_PASSWORD),
        full_name="Scoped User",
        role="user",
        store_id=(direct_store or store).id,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.flush()
    profile = AccessProfile(
        name=f"Perfil {email}",
        is_active=True,
        scheduling_departments=scheduling_departments,
    )
    db_session.add(profile)
    await db_session.flush()
    db_session.add(
        AccessProfileModulePermission(
            profile_id=profile.id,
            module_group="OPERACIONAL",
            sub_module=sub_module,
            can_view=can_view,
            can_edit=can_edit,
            can_delete=can_delete,
        )
    )
    await db_session.execute(
        access_profile_users.insert().values(profile_id=profile.id, user_id=user.id)
    )
    await db_session.execute(
        access_profile_stores.insert().values(profile_id=profile.id, store_id=store.id)
    )
    await db_session.commit()


async def _login_as(client: AsyncClient, email: str) -> None:
    resp = await client.post(
        "/api/v1/auth/login",
        data={"username": email, "password": VALID_TEST_PASSWORD},
    )
    assert resp.status_code == 200, resp.text
    client.headers["Authorization"] = f"Bearer {resp.json()['access_token']}"


async def _make_roll(db_session, store, name: str) -> FilmRoll:
    ft = FilmType(name=name, department="film")
    db_session.add(ft)
    await db_session.flush()
    roll = FilmRoll(
        store_id=store.id,
        film_type_id=ft.id,
        tonality="G20",
        total_meters=30,
        remaining_meters=30,
        receipt_date=date(2026, 7, 1),
        status="em_estoque",
    )
    db_session.add(roll)
    await db_session.commit()
    await db_session.refresh(roll)
    return roll


@pytest.fixture
async def os_completed(db_session: AsyncSession, test_store: Store) -> ServiceOrder:
    """O.S. finalizada e com NF, pronta para ser verificada."""
    so = ServiceOrder(
        store_id=test_store.id,
        vehicle_plate="ABC1D23",
        department="film",
        status="completed",
        entry_time=datetime.now(UTC),
        completion_time=datetime.now(UTC),
        photos=json.dumps(["http://localhost:8000/uploads/1.jpg"]),
        requires_invoice=True,
        invoice_number="NF-000123",
    )
    db_session.add(so)
    await db_session.commit()
    await db_session.refresh(so)
    return so


class TestVerifyRequiresConferencePermission:
    """#2 — PATCH /service-orders/{id}/verify exige conference:can_edit."""

    @pytest.mark.asyncio
    async def test_verify_sem_permissao_conference_retorna_403(
        self, authenticated_client: AsyncClient, os_completed: ServiceOrder
    ):
        # authenticated_client = perfil só com service_orders (SEM conference)
        resp = await authenticated_client.patch(
            f"/api/v1/service-orders/{os_completed.id}/verify",
            json={"verified": True},
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_verify_como_owner_continua_ok(
        self, owner_client: AsyncClient, os_completed: ServiceOrder
    ):
        resp = await owner_client.patch(
            f"/api/v1/service-orders/{os_completed.id}/verify",
            json={"verified": True},
        )
        assert resp.status_code == 200
        assert resp.json()["is_verified"] is True


class TestVerifyViaGenericUpdateRequiresConference:
    """#2b — porta lateral do #2: setar is_verified=True pelo PATCH genérico
    (/service-orders/{id}) também exige conference:can_edit (não só o /verify).
    """

    @pytest.mark.asyncio
    async def test_update_is_verified_sem_conference_retorna_403(
        self, authenticated_client: AsyncClient, os_completed: ServiceOrder
    ):
        # authenticated_client tem service_orders:can_edit, mas NÃO conference
        resp = await authenticated_client.patch(
            f"/api/v1/service-orders/{os_completed.id}",
            json={"is_verified": True},
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_update_is_verified_como_owner_ok(
        self, owner_client: AsyncClient, os_completed: ServiceOrder
    ):
        resp = await owner_client.patch(
            f"/api/v1/service-orders/{os_completed.id}",
            json={"is_verified": True},
        )
        assert resp.status_code == 200
        assert resp.json()["is_verified"] is True


class TestVehicleModelsRequirePermission:
    """#3 — CRUD de /vehicle-models exige a permissão de módulo `models`."""

    @pytest.mark.asyncio
    async def test_create_sem_permissao_models_retorna_403(
        self, authenticated_client: AsyncClient, test_brand: Brand
    ):
        # authenticated_client não tem o submódulo `models`
        resp = await authenticated_client.post(
            "/api/v1/vehicle-models",
            json={"name": "Corolla", "brand_id": test_brand.id},
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_create_como_owner_continua_ok(
        self, owner_client: AsyncClient, test_brand: Brand
    ):
        resp = await owner_client.post(
            "/api/v1/vehicle-models",
            json={"name": "Corolla XEi", "brand_id": test_brand.id},
        )
        assert resp.status_code == 201


class TestCreateDealershipOwnerOnly:
    """#5 — criar concessionária é Owner-only (coerente com update/delete)."""

    @pytest.mark.asyncio
    async def test_create_nao_owner_retorna_403(
        self, authenticated_client: AsyncClient, test_store: Store
    ):
        resp = await authenticated_client.post(
            "/api/v1/dealerships",
            json={"name": "Nova Concessionária", "brand": "Toyota", "store_id": test_store.id},
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_create_como_owner_continua_ok(
        self, owner_client: AsyncClient, test_store: Store
    ):
        resp = await owner_client.post(
            "/api/v1/dealerships",
            json={"name": "Concessionária Owner", "brand": "Toyota", "store_id": test_store.id},
        )
        assert resp.status_code == 201


class TestConsultantCreateRequiresPermission:
    """#4 — POST /consultants exige consultants:can_edit (antes: aberto a qualquer
    autenticado, inclusive criando em loja fora do escopo)."""

    @pytest.mark.asyncio
    async def test_create_sem_permissao_consultants_retorna_403(
        self, authenticated_client: AsyncClient, test_store: Store
    ):
        resp = await authenticated_client.post(
            "/api/v1/consultants",
            json={"name": "Consultor Novo", "store_id": test_store.id},
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_create_como_owner_continua_ok(
        self, owner_client: AsyncClient, test_store: Store
    ):
        resp = await owner_client.post(
            "/api/v1/consultants",
            json={"name": "Consultor Owner", "store_id": test_store.id},
        )
        assert resp.status_code == 201


class TestDeleteFilmRollScope:
    """#8 — excluir bobina respeita escopo de loja (can_delete de inventory é global)."""

    @pytest.mark.asyncio
    async def test_delete_roll_de_outra_loja_retorna_404(
        self, owner_client: AsyncClient, db_session, test_store: Store, second_store: Store
    ):
        roll = await _make_roll(db_session, test_store, "Poliester Scope A")

        # Atacante: inventory:can_delete, mas vinculado à second_store
        await _make_scoped_user(db_session, second_store, "inventory", "inv_atacante@x.com")
        await _login_as(owner_client, "inv_atacante@x.com")

        resp = await owner_client.delete(f"/api/v1/inventory/rolls/{roll.id}")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_roll_como_owner_ok(
        self, owner_client: AsyncClient, db_session, test_store: Store
    ):
        roll = await _make_roll(db_session, test_store, "Poliester Scope B")
        resp = await owner_client.delete(f"/api/v1/inventory/rolls/{roll.id}")
        assert resp.status_code == 200


class TestCreateAppointmentScope:
    """#6 — criar agendamento respeita escopo de loja (grava em loja alheia)."""

    _BODY = {
        "department": "film",
        "delivery_date": "2026-09-01",
        "delivery_time": "10:00:00",
        "vehicle_plate": "ABC1D23",
        "service_ids": [],
    }

    @pytest.mark.asyncio
    async def test_create_em_loja_fora_do_escopo_retorna_404(
        self, owner_client: AsyncClient, db_session, test_store: Store, second_store: Store
    ):
        # Atacante: scheduling:can_edit, mas vinculado à second_store
        await _make_scoped_user(db_session, second_store, "scheduling", "sched_atacante@x.com")
        await _login_as(owner_client, "sched_atacante@x.com")

        resp = await owner_client.post(
            "/api/v1/scheduling/", json={**self._BODY, "store_id": test_store.id}
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_create_como_owner_ok(self, owner_client: AsyncClient, test_store: Store):
        resp = await owner_client.post(
            "/api/v1/scheduling/", json={**self._BODY, "store_id": test_store.id}
        )
        assert resp.status_code == 201


class TestCreateAppointmentDepartmentScope:
    """#7 — criar agendamento respeita a restrição de DEPARTAMENTO do perfil.

    Usuário acessa a loja (via perfil), mas o perfil restringe o Agendamento a
    'security_film'. Criar 'film' nessa loja deve ser bloqueado (403); criar
    'security_film' é permitido.
    """

    @pytest.mark.asyncio
    async def test_create_em_departamento_fora_do_escopo_bloqueado(
        self, owner_client: AsyncClient, db_session, test_store: Store, second_store: Store
    ):
        # Loja direta = second_store; perfil concede test_store SÓ p/ security_film
        await _make_scoped_user(
            db_session,
            test_store,
            "scheduling",
            "dept_atacante@x.com",
            direct_store=second_store,
            scheduling_departments=["security_film"],
        )
        await _login_as(owner_client, "dept_atacante@x.com")

        base = {
            "delivery_date": "2026-09-01",
            "delivery_time": "10:00:00",
            "vehicle_plate": "ABC1D23",
            "service_ids": [],
            "store_id": test_store.id,
        }
        # 'film' está fora do escopo do perfil nessa loja → 403
        blocked = await owner_client.post(
            "/api/v1/scheduling/", json={**base, "department": "film"}
        )
        assert blocked.status_code == 403
        # 'security_film' está no escopo → 201
        allowed = await owner_client.post(
            "/api/v1/scheduling/", json={**base, "department": "security_film"}
        )
        assert allowed.status_code == 201


class TestCadastrosPorPerfil:
    """Decisão 2026-08-22: cadastros stores/brands/services abrem para "por perfil"
    (can_edit/can_delete), antes Owner-only. Concessionária segue Owner-only.

    Capability-based (dados globais/por-marca) — sem escopo de loja no ato de
    administrar o cadastro, coerente com o modelo dos submódulos.
    """

    @pytest.mark.asyncio
    async def test_store_patch_por_perfil_can_edit(
        self, client: AsyncClient, db_session, test_store
    ):
        await _make_scoped_user(db_session, test_store, "stores", "st_edit@test.com")
        await _login_as(client, "st_edit@test.com")
        resp = await client.patch(
            f"/api/v1/stores/{test_store.id}", json={"address": "Rua Nova, 123"}
        )
        assert resp.status_code == 200, resp.text

    @pytest.mark.asyncio
    async def test_store_patch_sem_grant_403(
        self, authenticated_client: AsyncClient, test_store
    ):
        resp = await authenticated_client.patch(
            f"/api/v1/stores/{test_store.id}", json={"address": "X"}
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_store_delete_requer_can_delete(
        self, client: AsyncClient, db_session, test_store
    ):
        await _make_scoped_user(
            db_session, test_store, "stores", "st_nodel@test.com", can_delete=False
        )
        await _login_as(client, "st_nodel@test.com")
        resp = await client.delete(f"/api/v1/stores/{test_store.id}")
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_brand_patch_por_perfil_can_edit(
        self, client: AsyncClient, db_session, test_store, test_brand
    ):
        await _make_scoped_user(db_session, test_store, "brands", "br_edit@test.com")
        await _login_as(client, "br_edit@test.com")
        resp = await client.patch(
            f"/api/v1/brands/{test_brand.id}", json={"name": "Marca Editada"}
        )
        assert resp.status_code == 200, resp.text

    @pytest.mark.asyncio
    async def test_brand_patch_sem_grant_403(
        self, authenticated_client: AsyncClient, test_brand
    ):
        resp = await authenticated_client.patch(
            f"/api/v1/brands/{test_brand.id}", json={"name": "X"}
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_service_patch_por_perfil_can_edit(
        self, client: AsyncClient, db_session, test_store, test_brand
    ):
        from app.modules.services.models import Service

        svc = Service(
            name="Serviço X", department="film", base_price=100.0,
            is_active=True, brand_id=test_brand.id,
        )
        db_session.add(svc)
        await db_session.commit()
        await db_session.refresh(svc)

        await _make_scoped_user(db_session, test_store, "services", "sv_edit@test.com")
        await _login_as(client, "sv_edit@test.com")
        resp = await client.patch(
            f"/api/v1/services/{svc.id}", json={"base_price": 150.0}
        )
        assert resp.status_code == 200, resp.text

    @pytest.mark.asyncio
    async def test_service_patch_sem_grant_403(
        self, client: AsyncClient, db_session, test_store, test_brand
    ):
        from app.modules.services.models import Service

        svc = Service(
            name="Serviço Y", department="film", base_price=100.0,
            is_active=True, brand_id=test_brand.id,
        )
        db_session.add(svc)
        await db_session.commit()
        await db_session.refresh(svc)

        await _make_scoped_user(db_session, test_store, "service_orders", "sv_noperm@test.com")
        await _login_as(client, "sv_noperm@test.com")
        resp = await client.patch(f"/api/v1/services/{svc.id}", json={"base_price": 1.0})
        assert resp.status_code == 403
