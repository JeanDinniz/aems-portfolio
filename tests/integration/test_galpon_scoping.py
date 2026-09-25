"""
Testes de integração da semântica ADITIVA dos perfis de galpão.

Bug original: usuário com perfis de loja + perfil galpão era tratado como
"só galpão" (lógica ANY) e perdia as O.S. normais das suas lojas. Com a
semântica aditiva, a restrição só vale quando TODOS os perfis ativos têm a
flag; usuário misto é usuário normal (vê galpão + normais das suas lojas).
"""

from datetime import UTC, datetime

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
from app.modules.service_orders.models import ServiceOrder
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
    is_galpon_profile: bool = False,
    hide_galpon_option: bool = False,
) -> AccessProfile:
    profile = AccessProfile(
        name=name,
        is_active=True,
        is_galpon_profile=is_galpon_profile,
        hide_galpon_option=hide_galpon_option,
    )
    db.add(profile)
    await db.flush()
    db.add(
        AccessProfileModulePermission(
            profile_id=profile.id,
            module_group="OPERACIONAL",
            sub_module="service_orders",
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
    # A sessão é compartilhada com o app no teste: expira a coleção lazy="selectin"
    # já carregada (vazia) para o get_current_user reler os vínculos novos.
    db.expire(user, ["access_profiles"])


async def _login(client: AsyncClient, email: str) -> AsyncClient:
    response = await client.post(
        "/api/v1/auth/login",
        data={"username": email, "password": VALID_TEST_PASSWORD},
    )
    assert response.status_code == 200, response.text
    client.headers["Authorization"] = f"Bearer {response.json()['access_token']}"
    return client


def _make_order(store: Store, plate: str, *, is_galpon: bool) -> ServiceOrder:
    return ServiceOrder(
        store_id=store.id,
        vehicle_plate=plate,
        department="film",
        status="waiting",
        is_courtesy=False,
        is_galpon=is_galpon,
        is_return=False,
        entry_time=datetime(2026, 7, 1, 8, 0, tzinfo=UTC),
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def scoped_orders(
    db_session: AsyncSession, test_store: Store, second_store: Store
) -> dict[str, ServiceOrder]:
    """3 O.S.: normal na loja 1, galpão na loja 1, normal na loja 2."""
    orders = {
        "normal_store1": _make_order(test_store, "AAA1A11", is_galpon=False),
        "galpon_store1": _make_order(test_store, "BBB2B22", is_galpon=True),
        "normal_store2": _make_order(second_store, "CCC3C33", is_galpon=False),
    }
    for order in orders.values():
        db_session.add(order)
    await db_session.commit()
    return orders


async def _list_plates(client: AsyncClient) -> set[str]:
    response = await client.get("/api/v1/service-orders?limit=100")
    assert response.status_code == 200, response.text
    return {item["vehicle_plate"] for item in response.json()["items"]}


# ---------------------------------------------------------------------------
# Usuário misto (caso do bug): perfis de loja + perfil galpão
# ---------------------------------------------------------------------------


class TestMixedUser:
    @pytest.mark.asyncio
    async def test_misto_ve_os_normais_e_de_galpao_das_suas_lojas(
        self, client: AsyncClient, db_session: AsyncSession, test_store, second_store, scoped_orders
    ):
        user = await _make_user(db_session, "misto@test.com")
        store_profile = await _make_profile(db_session, "Lojas", [test_store, second_store])
        galpon_profile = await _make_profile(
            db_session, "Galpão", [test_store], is_galpon_profile=True
        )
        await _link(db_session, store_profile, user)
        await _link(db_session, galpon_profile, user)

        await _login(client, "misto@test.com")
        plates = await _list_plates(client)
        assert plates == {"AAA1A11", "BBB2B22", "CCC3C33"}

    @pytest.mark.asyncio
    async def test_misto_effective_permissions_sem_flags(
        self, client: AsyncClient, db_session: AsyncSession, test_store, second_store
    ):
        user = await _make_user(db_session, "misto2@test.com")
        await _link(
            db_session, await _make_profile(db_session, "Lojas", [test_store, second_store]), user
        )
        await _link(
            db_session,
            await _make_profile(db_session, "Galpão", [test_store], is_galpon_profile=True),
            user,
        )

        await _login(client, "misto2@test.com")
        response = await client.get("/api/v1/users/me/permissions")
        assert response.status_code == 200
        data = response.json()
        assert data["is_galpon_profile"] is False
        assert data["hide_galpon_option"] is False
        assert set(data["store_ids"]) == {test_store.id, second_store.id}

    @pytest.mark.asyncio
    async def test_misto_perde_dashboard_de_galpao(
        self, client: AsyncClient, db_session: AsyncSession, test_store
    ):
        """Consequência intencional: misto = usuário normal → 403 no analytics."""
        user = await _make_user(db_session, "misto3@test.com")
        await _link(db_session, await _make_profile(db_session, "Loja", [test_store]), user)
        await _link(
            db_session,
            await _make_profile(db_session, "Galpão", [test_store], is_galpon_profile=True),
            user,
        )

        await _login(client, "misto3@test.com")
        response = await client.get(
            "/api/v1/analytics/dashboard/overview?start_date=2026-07-01&end_date=2026-07-31"
        )
        assert response.status_code == 403


# ---------------------------------------------------------------------------
# Usuários com um único tipo de perfil (comportamento preservado)
# ---------------------------------------------------------------------------


class TestSingleFlagUsers:
    @pytest.mark.asyncio
    async def test_so_galpao_continua_vendo_apenas_galpao(
        self, client: AsyncClient, db_session: AsyncSession, test_store, scoped_orders
    ):
        user = await _make_user(db_session, "galpao@test.com")
        await _link(
            db_session,
            await _make_profile(db_session, "Galpão", [test_store], is_galpon_profile=True),
            user,
        )

        await _login(client, "galpao@test.com")
        plates = await _list_plates(client)
        assert plates == {"BBB2B22"}

        response = await client.get("/api/v1/users/me/permissions")
        data = response.json()
        assert data["is_galpon_profile"] is True
        assert data["hide_galpon_option"] is False


class TestConferenceExportGalponScope:
    """#11 — o export da Conferência/Fotos respeita o escopo de galpão.

    Antes, build_conference_export_query aplicava só o filtro de loja (não o de
    galpão), então um perfil galpão baixava no Excel/ZIP O.S. normais das suas
    lojas — divergindo da tela (que filtra) e vazando fora do escopo.
    """

    @pytest.mark.asyncio
    async def test_export_query_perfil_galpao_exclui_os_normais(
        self, db_session: AsyncSession, test_store, second_store, scoped_orders
    ):
        from sqlalchemy import select as sa_select
        from sqlalchemy.orm import selectinload

        from app.modules.service_orders.service import build_conference_export_query

        user = await _make_user(db_session, "galpon_export@test.com")
        await _link(
            db_session,
            await _make_profile(db_session, "Galpão Export", [test_store], is_galpon_profile=True),
            user,
        )
        # Carrega perfis + lojas para a chamada direta ao service
        user = (
            await db_session.execute(
                sa_select(User)
                .options(selectinload(User.access_profiles).selectinload(AccessProfile.stores))
                .where(User.id == user.id)
            )
        ).scalar_one()

        query = build_conference_export_query(user)
        rows = (await db_session.execute(query)).scalars().all()
        plates = {r.vehicle_plate for r in rows}

        assert "BBB2B22" in plates  # galpão da loja 1 → visível
        assert "AAA1A11" not in plates  # normal da loja 1 → excluída (perfil galpão)

    @pytest.mark.asyncio
    async def test_so_ocultar_continua_sem_galpao(
        self, client: AsyncClient, db_session: AsyncSession, test_store, second_store, scoped_orders
    ):
        user = await _make_user(db_session, "ocultar@test.com")
        await _link(
            db_session,
            await _make_profile(
                db_session, "Sem Galpão", [test_store, second_store], hide_galpon_option=True
            ),
            user,
        )

        await _login(client, "ocultar@test.com")
        plates = await _list_plates(client)
        assert plates == {"AAA1A11", "CCC3C33"}


# ---------------------------------------------------------------------------
# Conflito: perfil galpão + perfil ocultar galpão no mesmo usuário
# ---------------------------------------------------------------------------


class TestConflictingProfiles:
    @pytest.mark.asyncio
    async def test_galpao_mais_ocultar_ve_tudo_das_suas_lojas(
        self, client: AsyncClient, db_session: AsyncSession, test_store, second_store, scoped_orders
    ):
        user = await _make_user(db_session, "conflito@test.com")
        await _link(
            db_session,
            await _make_profile(
                db_session, "Galpão", [test_store, second_store], is_galpon_profile=True
            ),
            user,
        )
        await _link(
            db_session,
            await _make_profile(
                db_session, "Sem Galpão", [test_store, second_store], hide_galpon_option=True
            ),
            user,
        )

        await _login(client, "conflito@test.com")
        plates = await _list_plates(client)
        assert plates == {"AAA1A11", "BBB2B22", "CCC3C33"}

        response = await client.get("/api/v1/users/me/permissions")
        data = response.json()
        assert data["is_galpon_profile"] is False
        assert data["hide_galpon_option"] is False


# ---------------------------------------------------------------------------
# Owner (inalterado)
# ---------------------------------------------------------------------------


class TestOwnerUnchanged:
    @pytest.mark.asyncio
    async def test_owner_effective_permissions_inalterado(self, owner_client: AsyncClient):
        response = await owner_client.get("/api/v1/users/me/permissions")
        assert response.status_code == 200
        data = response.json()
        assert data["is_owner"] is True
        assert data["is_galpon_profile"] is True
        assert data["hide_galpon_option"] is False
