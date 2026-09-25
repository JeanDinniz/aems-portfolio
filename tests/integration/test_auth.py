"""
Integration tests for authentication endpoints.
"""

import pytest
from httpx import AsyncClient

from app.modules.auth.models import User
from tests.conftest import VALID_TEST_PASSWORD


class TestLogin:
    """Tests for login endpoint."""

    @pytest.mark.asyncio
    async def test_login_success(self, client: AsyncClient, test_user: User, test_user_profile):
        """Successful login should return tokens."""
        response = await client.post(
            "/api/v1/auth/login",
            data={"username": "user@test.com", "password": VALID_TEST_PASSWORD},
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"
        assert data["expires_in"] > 0

    @pytest.mark.asyncio
    async def test_login_wrong_password(self, client: AsyncClient, test_user: User):
        """Login with wrong password should return 401."""
        response = await client.post(
            "/api/v1/auth/login",
            data={"username": "user@test.com", "password": "wrongpassword"},
        )
        assert response.status_code == 401
        assert "inválidos" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_login_nonexistent_user(self, client: AsyncClient):
        """Login with nonexistent user should return 401."""
        response = await client.post(
            "/api/v1/auth/login",
            data={"username": "nobody@test.com", "password": "anypassword"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_login_increments_failed_attempts(
        self, client: AsyncClient, test_user: User, db_session
    ):
        """Failed login should increment failed_login_attempts."""
        # Attempt login with wrong password
        await client.post(
            "/api/v1/auth/login",
            data={"username": "user@test.com", "password": "wrongpass"},
        )

        # Refresh user from database
        await db_session.refresh(test_user)
        assert test_user.failed_login_attempts >= 1


class TestRefreshToken:
    """Tests for refresh token endpoint."""

    @pytest.mark.asyncio
    async def test_refresh_token_success(self, client: AsyncClient, test_user: User, test_user_profile):
        """Valid refresh token should return new tokens."""
        # First login to get refresh token
        login_response = await client.post(
            "/api/v1/auth/login",
            data={"username": "user@test.com", "password": VALID_TEST_PASSWORD},
        )
        refresh_token = login_response.json()["refresh_token"]

        # Use refresh token
        response = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": refresh_token},
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data

    @pytest.mark.asyncio
    async def test_refresh_token_invalid(self, client: AsyncClient):
        """Invalid refresh token should return 401."""
        response = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": "invalid.token.here"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_fail_open_when_redis_down_and_fail_closed_false(
        self, client: AsyncClient, test_user: User, test_user_profile
    ):
        """
        A1 (fail-open): TOKEN_REVOCATION_FAIL_CLOSED=False + Redis fora deve
        CONTINUAR emitindo tokens (modo disponibilidade).
        """
        from unittest.mock import AsyncMock, patch

        login_resp = await client.post(
            "/api/v1/auth/login",
            data={"username": "user@test.com", "password": VALID_TEST_PASSWORD},
        )
        assert login_resp.status_code == 200
        refresh_token = login_resp.json()["refresh_token"]

        # Simula Redis completamente fora — patch no módulo core onde é definido e
        # de onde o service importa localmente.
        broken_redis = AsyncMock()
        broken_redis.get = AsyncMock(side_effect=ConnectionError("Redis down"))

        with (
            patch("app.core.redis.get_redis", return_value=broken_redis),
            patch("app.modules.auth.service.settings") as mock_settings,
        ):
            mock_settings.TOKEN_REVOCATION_FAIL_CLOSED = False
            mock_settings.REFRESH_TOKEN_EXPIRE_DAYS = 7
            mock_settings.ACCESS_TOKEN_EXPIRE_MINUTES = 30

            response = await client.post(
                "/api/v1/auth/refresh",
                json={"refresh_token": refresh_token},
            )

        # Deve ter passado (fail-open = modo disponibilidade)
        assert response.status_code == 200, response.text
        assert "access_token" in response.json()

    @pytest.mark.asyncio
    async def test_refresh_fail_closed_when_redis_down(
        self, client: AsyncClient, test_user: User, test_user_profile
    ):
        """
        A1 (fail-closed): TOKEN_REVOCATION_FAIL_CLOSED=True + Redis fora deve
        NEGAR o refresh (401) — mesma postura do access token em security.py.
        """
        from unittest.mock import AsyncMock, patch

        login_resp = await client.post(
            "/api/v1/auth/login",
            data={"username": "user@test.com", "password": VALID_TEST_PASSWORD},
        )
        assert login_resp.status_code == 200
        refresh_token = login_resp.json()["refresh_token"]

        # Simula Redis completamente fora — patch no módulo core onde é definido.
        broken_redis = AsyncMock()
        broken_redis.get = AsyncMock(side_effect=ConnectionError("Redis down"))

        with (
            patch("app.core.redis.get_redis", return_value=broken_redis),
            patch("app.modules.auth.service.settings") as mock_settings,
        ):
            mock_settings.TOKEN_REVOCATION_FAIL_CLOSED = True
            mock_settings.REFRESH_TOKEN_EXPIRE_DAYS = 7
            mock_settings.ACCESS_TOKEN_EXPIRE_MINUTES = 30

            response = await client.post(
                "/api/v1/auth/refresh",
                json={"refresh_token": refresh_token},
            )

        # Deve ter negado (fail-closed = segurança sobre disponibilidade)
        assert response.status_code == 401, response.text


class TestChangePassword:
    """Tests for change password endpoint."""

    @pytest.mark.asyncio
    async def test_change_password_success(
        self, authenticated_client: AsyncClient, test_user: User
    ):
        """Successful password change."""
        response = await authenticated_client.post(
            "/api/v1/auth/change-password",
            json={
                "current_password": VALID_TEST_PASSWORD,
                "new_password": "NewPass456!@",
            },
        )
        assert response.status_code == 200
        assert "sucesso" in response.json()["message"].lower()

    @pytest.mark.asyncio
    async def test_change_password_wrong_current(
        self, authenticated_client: AsyncClient, test_user: User
    ):
        """Wrong current password should return error."""
        response = await authenticated_client.post(
            "/api/v1/auth/change-password",
            json={
                "current_password": "wrongcurrent",
                "new_password": "NewPass456!@",
            },
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_change_password_too_short(
        self, authenticated_client: AsyncClient, test_user: User
    ):
        """New password too short should return validation error."""
        response = await authenticated_client.post(
            "/api/v1/auth/change-password",
            json={
                "current_password": VALID_TEST_PASSWORD,
                "new_password": "short",
            },
        )
        assert response.status_code == 422


class TestGetCurrentUser:
    """Tests for get current user endpoint."""

    @pytest.mark.asyncio
    async def test_get_me_authenticated(
        self, authenticated_client: AsyncClient, test_user: User
    ):
        """Authenticated user should get their info."""
        response = await authenticated_client.get("/api/v1/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "user@test.com"
        assert data["role"] == "user"
        assert "permissions" in data

    @pytest.mark.asyncio
    async def test_get_me_unauthenticated(self, client: AsyncClient):
        """Unauthenticated request should return 401."""
        response = await client.get("/api/v1/auth/me")
        assert response.status_code == 401


class TestCreateUser:
    """Tests for user creation endpoint."""

    @pytest.mark.asyncio
    async def test_create_user_as_owner(
        self, owner_client: AsyncClient, test_store
    ):
        """Owner should be able to create users."""
        response = await owner_client.post(
            "/api/v1/auth/users",
            json={
                "email": "newuser@test.com",
                "password": "NewUser123!@",
                "full_name": "New User",
                "role": "user",
                "store_id": test_store.id,
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["email"] == "newuser@test.com"
        assert data["must_change_password"] is True

    @pytest.mark.asyncio
    async def test_create_user_as_operator_denied(
        self, authenticated_client: AsyncClient, test_store
    ):
        """User should not be able to create users."""
        response = await authenticated_client.post(
            "/api/v1/auth/users",
            json={
                "email": "newuser@test.com",
                "password": "NewUser123!@",
                "full_name": "New User",
                "role": "user",
                "store_id": test_store.id,
            },
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_create_user_duplicate_email(
        self, owner_client: AsyncClient, test_user: User, test_store
    ):
        """Creating user with existing email should return conflict."""
        response = await owner_client.post(
            "/api/v1/auth/users",
            json={
                "email": "user@test.com",  # Already exists
                "password": "SomePass123!@",
                "full_name": "Duplicate User",
                "role": "user",
                "store_id": test_store.id,
            },
        )
        assert response.status_code == 409


class TestLogout:
    """Tests for logout endpoint."""

    @pytest.mark.asyncio
    async def test_logout_success(
        self, authenticated_client: AsyncClient, test_user: User
    ):
        """Authenticated user should be able to logout."""
        response = await authenticated_client.post("/api/v1/auth/logout")
        assert response.status_code == 200
        assert "sucesso" in response.json()["message"].lower()


class TestNoAccountLockout:
    """Login must NOT lock the account after repeated failed attempts."""

    @pytest.mark.asyncio
    async def test_login_succeeds_after_many_failed_attempts(
        self, client: AsyncClient, test_user: User, test_user_profile, db_session
    ):
        """Correct password must work even after several failed attempts."""
        for _ in range(6):
            await client.post(
                "/api/v1/auth/login",
                data={"username": "user@test.com", "password": "wrongpass"},
            )

        response = await client.post(
            "/api/v1/auth/login",
            data={"username": "user@test.com", "password": VALID_TEST_PASSWORD},
        )
        assert response.status_code == 200, response.json()


class TestInactiveUser:
    """Tests for inactive user authentication."""

    @pytest.mark.asyncio
    async def test_inactive_user_cannot_login(
        self, client: AsyncClient, test_user: User, db_session
    ):
        """Inactive user should not be able to login."""
        test_user.is_active = False
        await db_session.commit()

        response = await client.post(
            "/api/v1/auth/login",
            data={"username": "user@test.com", "password": VALID_TEST_PASSWORD},
        )
        assert response.status_code == 401
        assert "desativado" in response.json()["detail"].lower() or "inactive" in response.json()["detail"].lower()


class TestPasswordChangeSamePassword:
    """Tests for password change with same password validation."""

    @pytest.mark.asyncio
    async def test_change_password_same_as_current(
        self, authenticated_client: AsyncClient, test_user: User
    ):
        """New password should not be the same as current password."""
        response = await authenticated_client.post(
            "/api/v1/auth/change-password",
            json={
                "current_password": VALID_TEST_PASSWORD,
                "new_password": VALID_TEST_PASSWORD,  # Same as current
            },
        )
        assert response.status_code in [400, 422]


class TestRefreshTokenEdgeCases:
    """Tests for refresh token edge cases."""

    @pytest.mark.asyncio
    async def test_refresh_token_with_access_token_fails(
        self, client: AsyncClient, test_user: User, test_user_profile
    ):
        """Using access token as refresh token should fail."""
        # First login to get tokens
        login_response = await client.post(
            "/api/v1/auth/login",
            data={"username": "user@test.com", "password": VALID_TEST_PASSWORD},
        )
        access_token = login_response.json()["access_token"]

        # Try to use access token as refresh token
        response = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": access_token},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_token_for_inactive_user(
        self, client: AsyncClient, test_user: User, test_user_profile, db_session
    ):
        """Refresh token should fail if user becomes inactive."""
        # First login to get refresh token
        login_response = await client.post(
            "/api/v1/auth/login",
            data={"username": "user@test.com", "password": VALID_TEST_PASSWORD},
        )
        refresh_token = login_response.json()["refresh_token"]

        # Deactivate user
        test_user.is_active = False
        await db_session.commit()

        # Try to refresh
        response = await client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": refresh_token},
        )
        assert response.status_code == 401


class TestUserCreationEdgeCases:
    """Tests for user creation edge cases."""

    @pytest.mark.asyncio
    async def test_create_user_email_case_insensitive(
        self, owner_client: AsyncClient, test_user: User, test_store
    ):
        """Email comparison should be case insensitive."""
        response = await owner_client.post(
            "/api/v1/auth/users",
            json={
                "email": "USER@TEST.COM",  # Uppercase version of existing email
                "password": "SomePass123!@",
                "full_name": "Duplicate User",
                "role": "user",
                "store_id": test_store.id,
            },
        )
        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_created_user_must_change_password(
        self, owner_client: AsyncClient, test_store
    ):
        """Newly created user should have must_change_password=True."""
        response = await owner_client.post(
            "/api/v1/auth/users",
            json={
                "email": "newuser2@test.com",
                "password": "NewUser2_123!@",
                "full_name": "New User 2",
                "role": "user",
                "store_id": test_store.id,
            },
        )
        assert response.status_code == 201
        data = response.json()
        assert data["must_change_password"] is True


class TestSuccessfulLoginResets:
    """Tests that successful login resets failed attempts and lockout."""

    @pytest.mark.asyncio
    async def test_successful_login_resets_failed_attempts(
        self, client: AsyncClient, test_user: User, test_user_profile, db_session
    ):
        """Successful login should reset failed_login_attempts to 0."""
        # Make a failed attempt first
        await client.post(
            "/api/v1/auth/login",
            data={"username": "user@test.com", "password": "wrongpass"},
        )
        await db_session.refresh(test_user)
        assert test_user.failed_login_attempts >= 1

        # Now login successfully
        response = await client.post(
            "/api/v1/auth/login",
            data={"username": "user@test.com", "password": VALID_TEST_PASSWORD},
        )
        assert response.status_code == 200

        # Check that failed attempts was reset
        await db_session.refresh(test_user)
        assert test_user.failed_login_attempts == 0
        assert test_user.locked_until is None

    @pytest.mark.asyncio
    async def test_successful_login_updates_last_login(
        self, client: AsyncClient, test_user: User, test_user_profile, db_session
    ):
        """Successful login should update last_login timestamp."""

        old_last_login = test_user.last_login

        # Login successfully
        response = await client.post(
            "/api/v1/auth/login",
            data={"username": "user@test.com", "password": VALID_TEST_PASSWORD},
        )
        assert response.status_code == 200

        # Check last_login was updated
        await db_session.refresh(test_user)
        assert test_user.last_login is not None
        if old_last_login:
            assert test_user.last_login > old_last_login


class TestForgotPassword:
    """Tests for POST /api/v1/auth/forgot-password."""

    @pytest.mark.asyncio
    async def test_forgot_password_nonexistent_email(self, client: AsyncClient):
        """Non-existent email should still return success message (security)."""
        response = await client.post(
            "/api/v1/auth/forgot-password",
            json={"email": "nobody@test.com"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "message" in data

    @pytest.mark.asyncio
    async def test_forgot_password_existing_email(
        self, client: AsyncClient, test_user: User
    ):
        """Existing email enfileira e-mail de reset e retorna mensagem genérica."""
        from unittest.mock import AsyncMock, patch

        mock_redis_client = AsyncMock()
        mock_redis_client.setex = AsyncMock()

        with (
            patch("app.core.redis.get_redis", return_value=mock_redis_client),
            patch("app.workers.tasks.send_transactional_email.delay") as mock_delay,
        ):
            response = await client.post(
                "/api/v1/auth/forgot-password",
                json={"email": "user@test.com"},
            )

        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "dev_token" not in data
        assert "dev_user_id" not in data

        # E-mail de reset foi enfileirado com o link do frontend (token não vaza na resposta)
        mock_delay.assert_called_once()
        kwargs = mock_delay.call_args.kwargs
        assert kwargs["to"] == "user@test.com"
        assert "/reset-password?token=" in kwargs["text"]


class TestResetPassword:
    """Tests for POST /api/v1/auth/reset-password."""

    @pytest.mark.asyncio
    async def test_reset_password_invalid_token(self, client: AsyncClient):
        """Invalid token should return 401 (Redis unavailable falls to error)."""
        response = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": "invalid-token", "new_password": "NewPass123!@"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_reset_password_with_mocked_redis(
        self, client: AsyncClient, test_user: User, db_session
    ):
        """Reset password with mocked Redis should update password."""
        from unittest.mock import AsyncMock, patch

        mock_redis_client = AsyncMock()
        mock_redis_client.get = AsyncMock(return_value=str(test_user.id))
        mock_redis_client.delete = AsyncMock()

        # O serviço obtém o cliente via app.core.redis.get_redis (pool compartilhado)
        with patch("app.core.redis.get_redis", return_value=mock_redis_client):
            response = await client.post(
                "/api/v1/auth/reset-password",
                json={"token": "valid-token-123", "new_password": "NewPass123!@"},
            )
            assert response.status_code == 200
            assert "sucesso" in response.json()["message"].lower()

    @pytest.mark.asyncio
    async def test_reset_password_user_inactive(
        self, client: AsyncClient, test_user: User, db_session
    ):
        """Reset password for inactive user should fail."""
        import sys
        from unittest.mock import AsyncMock, MagicMock

        mock_redis_client = AsyncMock()
        mock_redis_client.get = AsyncMock(return_value=str(test_user.id))
        mock_redis_client.delete = AsyncMock()
        mock_redis_client.aclose = AsyncMock()

        mock_aioredis = MagicMock()
        mock_aioredis.from_url = MagicMock(return_value=mock_redis_client)

        mock_redis_pkg = MagicMock()
        mock_redis_pkg.asyncio = mock_aioredis

        # Deactivate user
        test_user.is_active = False
        await db_session.commit()

        old_redis = sys.modules.get("redis")
        old_redis_asyncio = sys.modules.get("redis.asyncio")
        sys.modules["redis"] = mock_redis_pkg
        sys.modules["redis.asyncio"] = mock_aioredis

        try:
            response = await client.post(
                "/api/v1/auth/reset-password",
                json={"token": "some-token", "new_password": "NewPass123!@"},
            )
            assert response.status_code == 401
        finally:
            if old_redis is not None:
                sys.modules["redis"] = old_redis
            else:
                sys.modules.pop("redis", None)
            if old_redis_asyncio is not None:
                sys.modules["redis.asyncio"] = old_redis_asyncio
            else:
                sys.modules.pop("redis.asyncio", None)

    @pytest.mark.asyncio
    async def test_reset_password_token_not_found_in_redis(
        self, client: AsyncClient, test_user: User
    ):
        """Token not found in Redis should return 401."""
        import sys
        from unittest.mock import AsyncMock, MagicMock

        mock_redis_client = AsyncMock()
        mock_redis_client.get = AsyncMock(return_value=None)  # Token not found
        mock_redis_client.aclose = AsyncMock()

        mock_aioredis = MagicMock()
        mock_aioredis.from_url = MagicMock(return_value=mock_redis_client)

        mock_redis_pkg = MagicMock()
        mock_redis_pkg.asyncio = mock_aioredis

        old_redis = sys.modules.get("redis")
        old_redis_asyncio = sys.modules.get("redis.asyncio")
        sys.modules["redis"] = mock_redis_pkg
        sys.modules["redis.asyncio"] = mock_aioredis

        try:
            response = await client.post(
                "/api/v1/auth/reset-password",
                json={"token": "expired-token", "new_password": "NewPass123!@"},
            )
            assert response.status_code == 401
        finally:
            if old_redis is not None:
                sys.modules["redis"] = old_redis
            else:
                sys.modules.pop("redis", None)
            if old_redis_asyncio is not None:
                sys.modules["redis.asyncio"] = old_redis_asyncio
            else:
                sys.modules.pop("redis.asyncio", None)


class TestUpdateProfile:
    """Tests for PATCH /api/v1/auth/profile."""

    @pytest.mark.asyncio
    async def test_update_full_name(
        self, authenticated_client: AsyncClient, test_user: User
    ):
        response = await authenticated_client.patch(
            "/api/v1/auth/profile",
            json={"full_name": "Novo Nome Completo"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["full_name"] == "Novo Nome Completo"

    @pytest.mark.asyncio
    async def test_update_profile_no_changes(
        self, authenticated_client: AsyncClient, test_user: User
    ):
        response = await authenticated_client.patch(
            "/api/v1/auth/profile",
            json={},
        )
        assert response.status_code == 200
        assert response.json()["full_name"] == test_user.full_name

    @pytest.mark.asyncio
    async def test_update_profile_unauthenticated(self, client: AsyncClient):
        response = await client.patch(
            "/api/v1/auth/profile",
            json={"full_name": "Hacker"},
        )
        assert response.status_code == 401


class TestGetUserWithStores:
    """Tests for get user with stores information."""

    @pytest.mark.asyncio
    async def test_get_me_includes_permissions(
        self, authenticated_client: AsyncClient, test_user: User
    ):
        """Get me should include permissions based on role."""
        response = await authenticated_client.get("/api/v1/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert "permissions" in data
        assert isinstance(data["permissions"], list)

    @pytest.mark.asyncio
    async def test_get_me_includes_store_name(
        self, authenticated_client: AsyncClient, test_user: User, test_store
    ):
        """Get me should include store_name for users with store_id."""
        response = await authenticated_client.get("/api/v1/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert data["store_name"] == test_store.name
