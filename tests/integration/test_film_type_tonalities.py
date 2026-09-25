"""Regressão: as respostas de tipo de película devem incluir available_tonalities.

Antes do fix, os handlers montavam FilmTypeResponse manualmente e omitiam
available_tonalities, então a resposta sempre serializava [] (default do schema).
No banco os valores persistiam, mas o frontend — que reabre a edição lendo da
listagem — enxergava [] e parecia que a edição não tinha salvo.
"""

import pytest
from httpx import AsyncClient


class TestFilmTypeTonalitiesUpdate:
    @pytest.mark.asyncio
    async def test_create_returns_default_tonalities(self, owner_client: AsyncClient):
        resp = await owner_client.post(
            "/api/v1/film-types",
            json={
                "name": "TonalidadeCreate",
                "department": "film",
                "yellow_threshold_meters": 6,
                "red_threshold_meters": 2,
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["available_tonalities"] == ["G05", "G20", "G35", "G50", "G75"]

    @pytest.mark.asyncio
    async def test_update_persists_tonalities_in_response_and_listing(
        self, owner_client: AsyncClient
    ):
        create = await owner_client.post(
            "/api/v1/film-types",
            json={
                "name": "TonalidadeUpdate",
                "department": "film",
                "yellow_threshold_meters": 6,
                "red_threshold_meters": 2,
                "available_tonalities": ["G05", "G20", "G35", "G50", "G75"],
            },
        )
        assert create.status_code == 201, create.text
        ft_id = create.json()["id"]

        # Edita reduzindo para 3 tonalidades (cenário do bug relatado)
        patch = await owner_client.patch(
            f"/api/v1/film-types/{ft_id}",
            json={"available_tonalities": ["G05", "G20", "G35"]},
        )
        assert patch.status_code == 200, patch.text
        assert patch.json()["available_tonalities"] == ["G05", "G20", "G35"]

        # A listagem (usada pelo frontend para reabrir a edição) deve refletir
        listing = await owner_client.get("/api/v1/film-types?department=film&limit=200")
        assert listing.status_code == 200, listing.text
        item = next(i for i in listing.json()["items"] if i["id"] == ft_id)
        assert item["available_tonalities"] == ["G05", "G20", "G35"]


@pytest.mark.asyncio
async def test_listagem_acessivel_sem_permissao_de_estoque(client, db_session, test_store):
    """Regressão: o GET /film-types é dado de referência (usado pelo modal Novo
    Agendamento e pelo QuickCreate de O.S.). Um usuário com perfil só de
    Agendamentos (sem Estoque/inventory) deve conseguir listar — antes do fix
    caía em 403 e o modal exibia "Erro ao carregar dados"."""
    from app.core.security import get_password_hash
    from app.modules.access_profiles.models import (
        AccessProfile,
        AccessProfileModulePermission,
        access_profile_users,
    )
    from app.modules.auth.models import User
    from tests.conftest import VALID_TEST_PASSWORD

    user = User(
        email="sched_user@test.com",
        hashed_password=get_password_hash(VALID_TEST_PASSWORD),
        full_name="Scheduling User",
        role="user",
        store_id=test_store.id,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.flush()
    profile = AccessProfile(name="Só Agendamentos", is_active=True)
    db_session.add(profile)
    await db_session.flush()
    db_session.add(
        AccessProfileModulePermission(
            profile_id=profile.id,
            module_group="OPERACIONAL",
            sub_module="scheduling",
            can_view=True,
            can_edit=True,
            can_delete=True,
        )
    )
    await db_session.execute(
        access_profile_users.insert().values(profile_id=profile.id, user_id=user.id)
    )
    await db_session.commit()

    login = await client.post(
        "/api/v1/auth/login",
        data={"username": "sched_user@test.com", "password": VALID_TEST_PASSWORD},
    )
    token = login.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"

    resp = await client.get("/api/v1/film-types?department=film&limit=200")
    assert resp.status_code == 200, resp.text
