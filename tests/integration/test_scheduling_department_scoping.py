"""
Testes de integração da restrição de departamentos visíveis no Agendamento.

Um Perfil de Acesso pode limitar quais departamentos o usuário enxerga no módulo
de Agendamentos via scheduling_departments. Lista vazia = sem restrição. A
restrição vale para a listagem (GET /scheduling) e aparece nas permissões
efetivas (GET /users/me/permissions). Owner nunca é restrito.
"""

import pytest
import pytest_asyncio
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
from app.modules.stores.models import Store
from tests.conftest import VALID_TEST_PASSWORD

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_user(db: AsyncSession, email: str) -> User:
    user = User(
        email=email,
        hashed_password=get_password_hash(VALID_TEST_PASSWORD),
        full_name=email.split("@")[0],
        role="user",
        is_active=True,
        must_change_password=False,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_profile(
    db: AsyncSession,
    name: str,
    stores: list[Store],
    *,
    scheduling_departments: list[str] | None = None,
) -> AccessProfile:
    profile = AccessProfile(
        name=name,
        is_active=True,
        scheduling_departments=scheduling_departments or [],
    )
    db.add(profile)
    await db.flush()
    db.add(
        AccessProfileModulePermission(
            profile_id=profile.id,
            module_group="OPERACIONAL",
            sub_module="scheduling",
            can_view=True,
            can_edit=True,
            can_delete=False,
        )
    )
    for store in stores:
        await db.execute(
            access_profile_stores.insert().values(profile_id=profile.id, store_id=store.id)
        )
    await db.commit()
    return profile


async def _link(db: AsyncSession, profile: AccessProfile, user: User) -> None:
    await db.execute(access_profile_users.insert().values(profile_id=profile.id, user_id=user.id))
    await db.commit()
    db.expire(user, ["access_profiles"])


async def _login(client: AsyncClient, email: str) -> AsyncClient:
    response = await client.post(
        "/api/v1/auth/login",
        data={"username": email, "password": VALID_TEST_PASSWORD},
    )
    assert response.status_code == 200, response.text
    client.headers["Authorization"] = f"Bearer {response.json()['access_token']}"
    return client


def _payload(store_id: int, department: str, plate: str) -> dict:
    return {
        "store_id": store_id,
        "department": department,
        "delivery_date": "2030-01-15",
        "delivery_time": "10:00:00",
        "vehicle_plate": plate,
        "vehicle_model": "Corolla",
        "vehicle_color": "Preto",
    }


@pytest_asyncio.fixture
async def dept_appointments(owner_client: AsyncClient, test_store: Store) -> None:
    """Cria um agendamento film e um security_film na mesma loja."""
    for dept, plate in (("film", "AAA1A11"), ("security_film", "BBB2B22")):
        response = await owner_client.post(
            "/api/v1/scheduling/", json=_payload(test_store.id, dept, plate)
        )
        assert response.status_code == 201, response.text


async def _list_departments(client: AsyncClient) -> list[str]:
    response = await client.get("/api/v1/scheduling/?limit=200")
    assert response.status_code == 200, response.text
    return [item["department"] for item in response.json()["items"]]


async def _list_plates(client: AsyncClient) -> set[str]:
    response = await client.get("/api/v1/scheduling/?limit=200")
    assert response.status_code == 200, response.text
    return {item["vehicle_plate"] for item in response.json()["items"]}


@pytest_asyncio.fixture
async def two_store_appointments(
    owner_client: AsyncClient, test_store: Store, second_store: Store
) -> None:
    """film + security_film em cada uma das duas lojas (placas distintas)."""
    matrix = (
        (test_store.id, "film", "AAA1A11"),
        (test_store.id, "security_film", "BBB2B22"),
        (second_store.id, "film", "CCC3C33"),
        (second_store.id, "security_film", "DDD4D44"),
    )
    for store_id, dept, plate in matrix:
        response = await owner_client.post(
            "/api/v1/scheduling/", json=_payload(store_id, dept, plate)
        )
        assert response.status_code == 201, response.text


# ---------------------------------------------------------------------------
# Testes
# ---------------------------------------------------------------------------


class TestSchedulingDepartmentScoping:
    @pytest.mark.asyncio
    async def test_perfil_restrito_ve_apenas_o_departamento_permitido(
        self, client: AsyncClient, db_session: AsyncSession, test_store, dept_appointments
    ):
        user = await _make_user(db_session, "seguranca@test.com")
        profile = await _make_profile(
            db_session, "Só Segurança", [test_store], scheduling_departments=["security_film"]
        )
        await _link(db_session, profile, user)

        await _login(client, "seguranca@test.com")
        assert await _list_departments(client) == ["security_film"]

        response = await client.get("/api/v1/users/me/permissions")
        assert response.json()["scheduling_departments"] == ["security_film"]

    @pytest.mark.asyncio
    async def test_perfil_sem_restricao_ve_todos(
        self, client: AsyncClient, db_session: AsyncSession, test_store, dept_appointments
    ):
        user = await _make_user(db_session, "livre@test.com")
        profile = await _make_profile(db_session, "Agendamentos", [test_store])
        await _link(db_session, profile, user)

        await _login(client, "livre@test.com")
        assert set(await _list_departments(client)) == {"film", "security_film"}

        response = await client.get("/api/v1/users/me/permissions")
        assert response.json()["scheduling_departments"] == []

    @pytest.mark.asyncio
    async def test_perfil_livre_libera_apesar_de_outro_restrito(
        self, client: AsyncClient, db_session: AsyncSession, test_store, dept_appointments
    ):
        """Se algum perfil ativo não restringe, o usuário vê todos os departamentos."""
        user = await _make_user(db_session, "misto@test.com")
        await _link(
            db_session,
            await _make_profile(
                db_session, "Só Segurança", [test_store], scheduling_departments=["security_film"]
            ),
            user,
        )
        await _link(
            db_session,
            await _make_profile(db_session, "Agendamentos", [test_store]),
            user,
        )

        await _login(client, "misto@test.com")
        assert set(await _list_departments(client)) == {"film", "security_film"}

    @pytest.mark.asyncio
    async def test_owner_ve_todos(self, owner_client: AsyncClient, dept_appointments):
        assert set(await _list_departments(owner_client)) == {"film", "security_film"}

        response = await owner_client.get("/api/v1/users/me/permissions")
        assert response.json()["scheduling_departments"] == []


class TestSchedulingScopesPorPerfil:
    """Escopos combinados (loja × departamento) unidos por perfil — caso do report."""

    @pytest.mark.asyncio
    async def test_dois_perfis_escopos_diferentes(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_store,
        second_store,
        two_store_appointments,
    ):
        """Segurança em TODAS as lojas + todos os departamentos só na loja shopping.

        Espera-se ver: segurança nas duas lojas + película da loja shopping,
        mas NÃO a película da outra loja.
        """
        user = await _make_user(db_session, "combinado@test.com")
        # Perfil A: todas as lojas × só segurança
        await _link(
            db_session,
            await _make_profile(
                db_session,
                "Segurança Geral",
                [test_store, second_store],
                scheduling_departments=["security_film"],
            ),
            user,
        )
        # Perfil B: loja shopping (second_store) × todos os departamentos
        await _link(
            db_session,
            await _make_profile(db_session, "Shopping Full", [second_store]),
            user,
        )

        await _login(client, "combinado@test.com")
        plates = await _list_plates(client)
        # BBB(seg@loja1) + DDD(seg@loja2) + CCC(film@loja2); NÃO AAA(film@loja1)
        assert plates == {"BBB2B22", "CCC3C33", "DDD4D44"}
        assert "AAA1A11" not in plates

    @pytest.mark.asyncio
    async def test_perfil_restringe_loja_e_departamento(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_store,
        second_store,
        two_store_appointments,
    ):
        """Um único perfil: só segurança e só na loja shopping."""
        user = await _make_user(db_session, "shopseg@test.com")
        await _link(
            db_session,
            await _make_profile(
                db_session,
                "Shopping Segurança",
                [second_store],
                scheduling_departments=["security_film"],
            ),
            user,
        )

        await _login(client, "shopseg@test.com")
        assert await _list_plates(client) == {"DDD4D44"}
