"""
Integration tests for push notification device registration endpoints.

Covers:
- POST /api/v1/push/devices — registro e upsert
- DELETE /api/v1/push/devices/{token} — remocao idempotente
- Autenticacao obrigatoria em ambos os endpoints
- Migracao de token entre usuarios
"""

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.push.models import PushDevice

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

REGISTER_URL = "/api/v1/push/devices"
SAMPLE_TOKEN = "ExponentPushToken[test-device-token-abc123]"
SAMPLE_PAYLOAD = {
    "token": SAMPLE_TOKEN,
    "platform": "android",
    "app_version": "1.0.0",
}


async def _count_devices(db: AsyncSession, token: str) -> int:
    result = await db.execute(
        select(PushDevice).where(PushDevice.token == token)
    )
    return len(result.scalars().all())


# ===========================================================================
# POST /push/devices
# ===========================================================================


class TestRegisterDevice:
    """Testa o registro de devices de push notification."""

    @pytest.mark.asyncio
    async def test_register_new_device_returns_200(
        self, authenticated_client: AsyncClient
    ):
        """Registrar um novo token retorna 200 com o device criado."""
        response = await authenticated_client.post(REGISTER_URL, json=SAMPLE_PAYLOAD)
        assert response.status_code == 200
        data = response.json()
        assert data["token"] == SAMPLE_TOKEN
        assert data["platform"] == "android"
        assert data["app_version"] == "1.0.0"
        assert "id" in data
        assert "created_at" in data
        assert "last_seen" in data

    @pytest.mark.asyncio
    async def test_register_device_without_app_version(
        self, authenticated_client: AsyncClient
    ):
        """app_version e opcional — aceita None."""
        payload = {"token": "token-no-version", "platform": "ios"}
        response = await authenticated_client.post(REGISTER_URL, json=payload)
        assert response.status_code == 200
        assert response.json()["app_version"] is None

    @pytest.mark.asyncio
    async def test_register_same_token_twice_upserts(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
    ):
        """Registrar o mesmo token duas vezes resulta em apenas 1 registro
        com last_seen atualizado (upsert)."""
        await authenticated_client.post(
            REGISTER_URL, json={**SAMPLE_PAYLOAD, "app_version": "1.0.0"}
        )
        response2 = await authenticated_client.post(
            REGISTER_URL, json={**SAMPLE_PAYLOAD, "app_version": "1.1.0"}
        )
        assert response2.status_code == 200
        assert response2.json()["app_version"] == "1.1.0"

        count = await _count_devices(db_session, SAMPLE_TOKEN)
        assert count == 1

    @pytest.mark.asyncio
    async def test_register_token_migrates_to_new_user(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_owner: User,
        authenticated_client: AsyncClient,
        owner_client: AsyncClient,
    ):
        """Token registrado pelo user_a e depois pelo user_b deve migrar:
        o registro fica com user_id=user_b (1 registro total)."""
        # Registrar com usuario normal
        resp1 = await authenticated_client.post(REGISTER_URL, json=SAMPLE_PAYLOAD)
        assert resp1.status_code == 200
        first_id = resp1.json()["id"]

        # Registrar o mesmo token com owner
        resp2 = await owner_client.post(REGISTER_URL, json=SAMPLE_PAYLOAD)
        assert resp2.status_code == 200
        assert resp2.json()["id"] == first_id  # mesmo registro

        # Verifica no banco que o user_id foi atualizado para owner
        result = await db_session.execute(
            select(PushDevice).where(PushDevice.token == SAMPLE_TOKEN)
        )
        device = result.scalar_one()
        assert device.user_id == test_owner.id

        # Continua sendo 1 registro
        count = await _count_devices(db_session, SAMPLE_TOKEN)
        assert count == 1

    @pytest.mark.asyncio
    async def test_register_invalid_platform(self, authenticated_client: AsyncClient):
        """Platform invalida deve retornar 422."""
        payload = {"token": "some-token", "platform": "windows"}
        response = await authenticated_client.post(REGISTER_URL, json=payload)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_register_empty_token_rejected(
        self, authenticated_client: AsyncClient
    ):
        """Token vazio deve retornar 422."""
        payload = {"token": "", "platform": "ios"}
        response = await authenticated_client.post(REGISTER_URL, json=payload)
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_register_requires_authentication(self, client: AsyncClient):
        """Endpoint exige autenticacao — sem token retorna 401."""
        response = await client.post(REGISTER_URL, json=SAMPLE_PAYLOAD)
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_register_multiple_devices_same_user(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Um usuario pode ter varios tokens (varios aparelhos)."""
        await authenticated_client.post(
            REGISTER_URL, json={"token": "token-device-1", "platform": "android"}
        )
        await authenticated_client.post(
            REGISTER_URL, json={"token": "token-device-2", "platform": "ios"}
        )

        result = await db_session.execute(
            select(PushDevice).where(PushDevice.user_id == test_user.id)
        )
        devices = result.scalars().all()
        assert len(devices) == 2


# ===========================================================================
# DELETE /push/devices/{token}
# ===========================================================================


class TestDeleteDevice:
    """Testa a remocao de devices de push notification."""

    @pytest.mark.asyncio
    async def test_delete_existing_device_returns_204(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
    ):
        """Remover um token registrado retorna 204 e apaga o registro."""
        await authenticated_client.post(REGISTER_URL, json=SAMPLE_PAYLOAD)

        response = await authenticated_client.delete(
            f"{REGISTER_URL}/{SAMPLE_TOKEN}"
        )
        assert response.status_code == 204

        count = await _count_devices(db_session, SAMPLE_TOKEN)
        assert count == 0

    @pytest.mark.asyncio
    async def test_delete_nonexistent_token_returns_204(
        self, authenticated_client: AsyncClient
    ):
        """Remover token que nao existe e idempotente — retorna 204."""
        response = await authenticated_client.delete(
            f"{REGISTER_URL}/token-que-nao-existe-xyz"
        )
        assert response.status_code == 204

    @pytest.mark.asyncio
    async def test_delete_other_users_token_is_noop(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
        test_owner: User,
        test_user_profile,
    ):
        """Usuario nao pode deletar token registrado por outro usuario.
        A operacao e silenciosa (204) mas o registro permanece no banco."""
        from tests.conftest import VALID_OWNER_PASSWORD, VALID_TEST_PASSWORD

        # Obter token de autenticacao do owner
        resp = await client.post(
            "/api/v1/auth/login",
            data={"username": "owner@test.com", "password": VALID_OWNER_PASSWORD},
        )
        owner_token = resp.json()["access_token"]

        # Owner registra o device token
        await client.post(
            REGISTER_URL,
            json=SAMPLE_PAYLOAD,
            headers={"Authorization": f"Bearer {owner_token}"},
        )

        # Garantir que existe 1 registro
        count = await _count_devices(db_session, SAMPLE_TOKEN)
        assert count == 1

        # Obter token de autenticacao do usuario normal
        resp2 = await client.post(
            "/api/v1/auth/login",
            data={"username": "user@test.com", "password": VALID_TEST_PASSWORD},
        )
        user_token = resp2.json()["access_token"]

        # Usuario normal tenta deletar o token do owner — 204 silencioso
        response = await client.delete(
            f"{REGISTER_URL}/{SAMPLE_TOKEN}",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert response.status_code == 204

        # Token do owner ainda deve existir no banco
        count = await _count_devices(db_session, SAMPLE_TOKEN)
        assert count == 1

    @pytest.mark.asyncio
    async def test_delete_requires_authentication(self, client: AsyncClient):
        """Endpoint exige autenticacao — sem token retorna 401."""
        response = await client.delete(f"{REGISTER_URL}/{SAMPLE_TOKEN}")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_delete_only_removes_specified_token(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
    ):
        """Remocao afeta apenas o token especificado, nao outros do usuario."""
        token_a = "token-device-A"
        token_b = "token-device-B"
        await authenticated_client.post(
            REGISTER_URL, json={"token": token_a, "platform": "android"}
        )
        await authenticated_client.post(
            REGISTER_URL, json={"token": token_b, "platform": "ios"}
        )

        await authenticated_client.delete(f"{REGISTER_URL}/{token_a}")

        count_a = await _count_devices(db_session, token_a)
        count_b = await _count_devices(db_session, token_b)
        assert count_a == 0
        assert count_b == 1
