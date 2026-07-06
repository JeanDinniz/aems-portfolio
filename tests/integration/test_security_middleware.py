"""
Integration tests for security middlewares.
Tests rate limiting, security headers, and request ID tracking.
"""

import pytest
from httpx import AsyncClient

from app.modules.auth.models import User
from tests.conftest import VALID_TEST_PASSWORD


class TestSecurityHeaders:
    """Tests for SecurityHeadersMiddleware."""

    @pytest.mark.asyncio
    async def test_x_content_type_options_header(self, client: AsyncClient):
        """Response should include X-Content-Type-Options: nosniff."""
        response = await client.get("/health")
        assert response.headers.get("X-Content-Type-Options") == "nosniff"

    @pytest.mark.asyncio
    async def test_x_frame_options_header(self, client: AsyncClient):
        """Response should include X-Frame-Options: DENY."""
        response = await client.get("/health")
        assert response.headers.get("X-Frame-Options") == "DENY"

    @pytest.mark.asyncio
    async def test_x_xss_protection_header(self, client: AsyncClient):
        """Response should include X-XSS-Protection header."""
        response = await client.get("/health")
        assert response.headers.get("X-XSS-Protection") == "1; mode=block"

    @pytest.mark.asyncio
    async def test_referrer_policy_header(self, client: AsyncClient):
        """Response should include Referrer-Policy header."""
        response = await client.get("/health")
        assert response.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"

    @pytest.mark.asyncio
    async def test_permissions_policy_header(self, client: AsyncClient):
        """Response should include Permissions-Policy header."""
        response = await client.get("/health")
        assert "camera=()" in response.headers.get("Permissions-Policy", "")

    @pytest.mark.asyncio
    async def test_headers_present_on_all_endpoints(self, client: AsyncClient):
        """Security headers should be present on all endpoints."""
        response = await client.get("/")
        assert response.headers.get("X-Content-Type-Options") == "nosniff"
        assert response.headers.get("X-Frame-Options") == "DENY"

    @pytest.mark.asyncio
    async def test_headers_present_on_api_endpoints(self, client: AsyncClient):
        """Security headers should be present on API endpoints."""
        response = await client.get("/api/v1/auth/me")
        # Even on 401, headers should be present
        assert response.headers.get("X-Content-Type-Options") == "nosniff"


class TestRequestID:
    """Tests for RequestIDMiddleware."""

    @pytest.mark.asyncio
    async def test_response_includes_request_id(self, client: AsyncClient):
        """Response should include X-Request-ID header."""
        response = await client.get("/health")
        assert "X-Request-ID" in response.headers
        assert len(response.headers["X-Request-ID"]) > 0

    @pytest.mark.asyncio
    async def test_request_id_is_uuid_format(self, client: AsyncClient):
        """Generated Request ID should be a valid UUID."""
        import uuid

        response = await client.get("/health")
        request_id = response.headers["X-Request-ID"]
        # Should not raise ValueError
        uuid.UUID(request_id)

    @pytest.mark.asyncio
    async def test_custom_request_id_preserved(self, client: AsyncClient):
        """Client-provided X-Request-ID should be preserved."""
        custom_id = "my-custom-request-id-12345"
        response = await client.get(
            "/health", headers={"X-Request-ID": custom_id}
        )
        assert response.headers["X-Request-ID"] == custom_id

    @pytest.mark.asyncio
    async def test_different_requests_get_different_ids(self, client: AsyncClient):
        """Each request should get a unique Request ID."""
        response1 = await client.get("/health")
        response2 = await client.get("/health")

        id1 = response1.headers["X-Request-ID"]
        id2 = response2.headers["X-Request-ID"]
        assert id1 != id2


class TestRateLimiting:
    """Tests for rate limiting on auth endpoints."""

    @pytest.mark.asyncio
    async def test_login_within_limit_succeeds(
        self, client: AsyncClient, test_user: User, test_user_profile
    ):
        """Login attempts within the rate limit should succeed."""
        response = await client.post(
            "/api/v1/auth/login",
            data={"username": "user@test.com", "password": VALID_TEST_PASSWORD},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_health_endpoint_not_rate_limited(self, client: AsyncClient):
        """Health endpoint should handle many requests without rate limiting."""
        for _ in range(20):
            response = await client.get("/health")
            assert response.status_code == 200


class TestRateLimitConfiguration:
    """Tests for rate limit configuration."""

    def test_rate_limit_settings_exist(self):
        """Rate limit settings should be configured."""
        from app.config import get_settings

        settings = get_settings()
        assert settings.RATE_LIMIT_ENABLED is not None
        assert settings.RATE_LIMIT_DEFAULT is not None
        assert settings.RATE_LIMIT_LOGIN is not None
        assert settings.RATE_LIMIT_REFRESH is not None

    def test_rate_limit_login_format(self):
        """Login rate limit should be in valid format."""
        from app.config import get_settings

        settings = get_settings()
        # Should be format like "5/minute"
        parts = settings.RATE_LIMIT_LOGIN.split("/")
        assert len(parts) == 2
        assert parts[0].isdigit()
        assert parts[1] in ("second", "minute", "hour", "day")

    def test_rate_limit_refresh_format(self):
        """Refresh rate limit should be in valid format."""
        from app.config import get_settings

        settings = get_settings()
        parts = settings.RATE_LIMIT_REFRESH.split("/")
        assert len(parts) == 2
        assert parts[0].isdigit()

    def test_limiter_instance_exists(self):
        """Limiter instance should be properly configured."""
        from app.core.rate_limit import limiter

        assert limiter is not None
        assert limiter.enabled == get_settings().RATE_LIMIT_ENABLED


def get_settings():
    from app.config import get_settings as _get_settings
    return _get_settings()
