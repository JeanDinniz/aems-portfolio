"""
Testes do controle de acesso a mídia (/upload/media-auth + cookie aems_media).

O Nginx chama GET /upload/media-auth via auth_request antes de servir qualquer
arquivo de /uploads/ — fecha o acesso público às fotos (ALTO-2 da auditoria).
"""

import pytest
from httpx import AsyncClient

from app.core.security import create_access_token, create_media_token, create_refresh_token
from app.modules.auth.models import User
from tests.conftest import VALID_TEST_PASSWORD

MEDIA_AUTH_URL = "/api/v1/upload/media-auth"


class TestMediaAuth:
    @pytest.mark.asyncio
    async def test_sem_credencial_retorna_401(self, client: AsyncClient):
        response = await client.get(MEDIA_AUTH_URL)
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_cookie_media_valido_retorna_204(self, client: AsyncClient, test_user: User):
        token = create_media_token(test_user.id)
        response = await client.get(MEDIA_AUTH_URL, cookies={"aems_media": token})
        assert response.status_code == 204

    @pytest.mark.asyncio
    async def test_bearer_access_token_retorna_204(self, client: AsyncClient, test_user: User):
        # Mobile: envia o access token no header das <Image>
        access_token, _ = create_access_token({"sub": str(test_user.id)})
        response = await client.get(
            MEDIA_AUTH_URL, headers={"Authorization": f"Bearer {access_token}"}
        )
        assert response.status_code == 204

    @pytest.mark.asyncio
    async def test_refresh_token_nao_serve_para_midia(self, client: AsyncClient, test_user: User):
        refresh_token, _ = create_refresh_token({"sub": str(test_user.id)})
        response = await client.get(MEDIA_AUTH_URL, cookies={"aems_media": refresh_token})
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_token_invalido_retorna_401(self, client: AsyncClient):
        response = await client.get(MEDIA_AUTH_URL, cookies={"aems_media": "lixo.invalido.token"})
        assert response.status_code == 401


class TestMediaCookieNoLogin:
    @pytest.mark.asyncio
    async def test_login_seta_cookie_de_midia(
        self, client: AsyncClient, test_user: User, test_user_profile
    ):
        response = await client.post(
            "/api/v1/auth/login",
            data={"username": test_user.email, "password": VALID_TEST_PASSWORD},
        )
        assert response.status_code == 200
        set_cookie = response.headers.get("set-cookie", "")
        assert "aems_media=" in set_cookie
        assert "HttpOnly" in set_cookie
        assert "Path=/uploads" in set_cookie

    @pytest.mark.asyncio
    async def test_cookie_do_login_autoriza_midia(
        self, client: AsyncClient, test_user: User, test_user_profile
    ):
        login = await client.post(
            "/api/v1/auth/login",
            data={"username": test_user.email, "password": VALID_TEST_PASSWORD},
        )
        assert login.status_code == 200
        media_cookie = login.cookies.get("aems_media")
        assert media_cookie
        response = await client.get(MEDIA_AUTH_URL, cookies={"aems_media": media_cookie})
        assert response.status_code == 204
