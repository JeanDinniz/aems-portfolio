"""
Unit tests for CSRFProtectionMiddleware.

Tests the middleware in isolation by constructing a minimal Starlette/FastAPI
application and sending requests through it with httpx.AsyncClient.  This
avoids any side-effects from the full AEMS app (rate-limiting, DB, etc.) and
lets us enable/disable CSRF freely for each test case.

Test categories:
1. Feature-flag disabled  – middleware is a no-op when enabled=False
2. Safe HTTP methods       – GET, HEAD, OPTIONS bypass CSRF even when enabled
3. Exempt paths            – /health, /ws/*, /api/v1/auth/login, /api/v1/auth/refresh
4. Valid Origin header     – requests from an allowed origin pass
5. Valid Referer header    – requests with a Referer from an allowed origin pass
6. Invalid Origin          – unknown origin is blocked (403)
7. Invalid Referer         – referer from a foreign host is blocked (403)
8. No Origin/Referer       – production mode → 403; debug mode → pass-through
9. WebSocket upgrade       – Upgrade: websocket header bypasses CSRF
10. Trailing slash on Origin – normalised correctly
"""

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.core.middleware import CSRFProtectionMiddleware

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ALLOWED = ["http://localhost:3000", "http://localhost:5173"]


def _make_sentinel_response(_request: Request) -> JSONResponse:
    """Tiny ASGI route that always returns 200 so we can detect pass-through."""
    return JSONResponse({"ok": True})


def _build_app(
    *,
    enabled: bool = True,
    debug: bool = False,
    allowed_origins: list[str] | None = None,
) -> Starlette:
    """Build a minimal Starlette app wrapped with CSRFProtectionMiddleware."""
    if allowed_origins is None:
        allowed_origins = ALLOWED

    routes = [
        Route("/api/v1/items", _make_sentinel_response, methods=["GET", "POST", "PUT", "PATCH", "DELETE"]),
        Route("/api/v1/auth/login", _make_sentinel_response, methods=["POST"]),
        Route("/api/v1/auth/refresh", _make_sentinel_response, methods=["POST"]),
        Route("/health", _make_sentinel_response, methods=["GET", "POST"]),
        Route("/ws/connect", _make_sentinel_response, methods=["GET", "POST"]),
    ]

    app = Starlette(routes=routes)
    app.add_middleware(
        CSRFProtectionMiddleware,
        allowed_origins=allowed_origins,
        debug=debug,
        enabled=enabled,
    )
    return app


def _client(app: Starlette) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")


# ===========================================================================
# 1. Feature-flag disabled
# ===========================================================================


class TestCSRFDisabled:
    """When enabled=False the middleware is a complete no-op."""

    @pytest.mark.asyncio
    async def test_post_without_origin_passes_when_disabled(self) -> None:
        app = _build_app(enabled=False)
        async with _client(app) as client:
            response = await client.post("/api/v1/items")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_post_with_foreign_origin_passes_when_disabled(self) -> None:
        app = _build_app(enabled=False)
        async with _client(app) as client:
            response = await client.post(
                "/api/v1/items", headers={"Origin": "http://evil.com"}
            )
        assert response.status_code == 200


# ===========================================================================
# 2. Safe HTTP methods
# ===========================================================================


class TestSafeMethodsBypass:
    """GET, HEAD, and OPTIONS must always bypass CSRF validation."""

    @pytest.mark.parametrize("method", ["GET", "HEAD", "OPTIONS"])
    @pytest.mark.asyncio
    async def test_safe_method_bypasses_csrf(self, method: str) -> None:
        app = _build_app(enabled=True)
        async with _client(app) as client:
            # No Origin header – CSRF would normally block this on POST
            response = await client.request(method, "/api/v1/items")
        # 200 (pass-through) or 405 (method not allowed) – but NOT 403
        assert response.status_code != 403


# ===========================================================================
# 3. Exempt paths
# ===========================================================================


class TestExemptPaths:
    """Certain paths bypass CSRF regardless of Origin/Referer."""

    @pytest.mark.asyncio
    async def test_auth_login_exempt(self) -> None:
        app = _build_app(enabled=True, debug=False)
        async with _client(app) as client:
            # POST with no Origin header – would be 403 on a protected path
            response = await client.post("/api/v1/auth/login")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_auth_refresh_exempt(self) -> None:
        app = _build_app(enabled=True, debug=False)
        async with _client(app) as client:
            response = await client.post("/api/v1/auth/refresh")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_health_endpoint_exempt(self) -> None:
        """POST to /health (e.g. a load-balancer probe) must be exempt."""
        app = _build_app(enabled=True, debug=False)
        async with _client(app) as client:
            response = await client.post("/health")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_ws_path_prefix_exempt(self) -> None:
        """Any path starting with /ws must be exempt."""
        app = _build_app(enabled=True, debug=False)
        async with _client(app) as client:
            response = await client.post("/ws/connect")
        assert response.status_code == 200


# ===========================================================================
# 4. Valid Origin header
# ===========================================================================


class TestValidOriginHeader:
    """State-changing requests with an allowed Origin pass through."""

    @pytest.mark.parametrize(
        "method,origin",
        [
            ("POST",   "http://localhost:3000"),
            ("PUT",    "http://localhost:3000"),
            ("PATCH",  "http://localhost:3000"),
            ("DELETE", "http://localhost:3000"),
            ("POST",   "http://localhost:5173"),
        ],
    )
    @pytest.mark.asyncio
    async def test_state_changing_with_allowed_origin_passes(
        self, method: str, origin: str
    ) -> None:
        app = _build_app(enabled=True)
        async with _client(app) as client:
            response = await client.request(
                method, "/api/v1/items", headers={"Origin": origin}
            )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_origin_with_trailing_slash_passes(self) -> None:
        """Origin header with trailing slash is normalised and accepted."""
        app = _build_app(enabled=True)
        async with _client(app) as client:
            response = await client.post(
                "/api/v1/items", headers={"Origin": "http://localhost:3000/"}
            )
        assert response.status_code == 200


# ===========================================================================
# 5. Valid Referer header
# ===========================================================================


class TestValidRefererHeader:
    """State-changing requests whose Referer maps to an allowed origin pass."""

    @pytest.mark.parametrize(
        "referer",
        [
            "http://localhost:3000/dashboard",
            "http://localhost:3000/service-orders/new",
            "http://localhost:5173/login",
        ],
    )
    @pytest.mark.asyncio
    async def test_state_changing_with_allowed_referer_passes(
        self, referer: str
    ) -> None:
        app = _build_app(enabled=True)
        async with _client(app) as client:
            response = await client.post(
                "/api/v1/items", headers={"Referer": referer}
            )
        assert response.status_code == 200


# ===========================================================================
# 6. Invalid / unknown Origin
# ===========================================================================


class TestInvalidOriginRejected:
    """State-changing requests with an unknown Origin must be blocked."""

    @pytest.mark.parametrize(
        "method,origin",
        [
            ("POST",   "http://evil.com"),
            ("PUT",    "https://attacker.io"),
            ("PATCH",  "http://phishing.example.com"),
            ("DELETE", "http://other-app.local:4000"),
        ],
    )
    @pytest.mark.asyncio
    async def test_unknown_origin_is_blocked(
        self, method: str, origin: str
    ) -> None:
        app = _build_app(enabled=True)
        async with _client(app) as client:
            response = await client.request(
                method, "/api/v1/items", headers={"Origin": origin}
            )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_blocked_response_contains_detail(self) -> None:
        """The 403 response must include an explanatory detail field."""
        app = _build_app(enabled=True)
        async with _client(app) as client:
            response = await client.post(
                "/api/v1/items", headers={"Origin": "http://evil.com"}
            )
        assert response.status_code == 403
        body = response.json()
        assert "detail" in body
        assert "evil.com" in body["detail"]


# ===========================================================================
# 7. Invalid Referer
# ===========================================================================


class TestInvalidRefererRejected:
    """State-changing requests with a Referer from an unknown host are blocked."""

    @pytest.mark.parametrize(
        "referer",
        [
            "http://evil.com/steal",
            "https://attacker.io/csrf",
            "http://192.168.99.1/malicious",
        ],
    )
    @pytest.mark.asyncio
    async def test_unknown_referer_is_blocked(self, referer: str) -> None:
        app = _build_app(enabled=True)
        async with _client(app) as client:
            response = await client.post(
                "/api/v1/items", headers={"Referer": referer}
            )
        assert response.status_code == 403


# ===========================================================================
# 8. No Origin / Referer
# ===========================================================================


class TestNoOriginOrReferer:
    """
    When neither Origin nor Referer is present:
    - In debug mode the request passes (supports curl / pytest clients).
    - In production mode (debug=False) the request is blocked.
    """

    @pytest.mark.asyncio
    async def test_missing_headers_blocked_in_production(self) -> None:
        app = _build_app(enabled=True, debug=False)
        async with _client(app) as client:
            response = await client.post("/api/v1/items")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_missing_headers_detail_message(self) -> None:
        """403 detail should mention the missing Origin/Referer header."""
        app = _build_app(enabled=True, debug=False)
        async with _client(app) as client:
            response = await client.post("/api/v1/items")
        body = response.json()
        assert "detail" in body
        assert "Origin" in body["detail"]

    @pytest.mark.asyncio
    async def test_missing_headers_allowed_in_debug_mode(self) -> None:
        """In debug mode (e.g. local dev/test), no Origin is acceptable."""
        app = _build_app(enabled=True, debug=True)
        async with _client(app) as client:
            response = await client.post("/api/v1/items")
        assert response.status_code == 200


# ===========================================================================
# 9. WebSocket upgrade
# ===========================================================================


class TestWebSocketUpgradeBypass:
    """Requests with Upgrade: websocket must bypass CSRF validation."""

    @pytest.mark.asyncio
    async def test_websocket_upgrade_bypasses_csrf(self) -> None:
        """
        httpx sends a GET for the upgrade handshake; the middleware must
        skip CSRF for it even if the path is not under /ws.
        """
        app = _build_app(enabled=True, debug=False)
        async with _client(app) as client:
            response = await client.get(
                "/api/v1/items",
                headers={"Upgrade": "websocket", "Connection": "Upgrade"},
            )
        # 200 from our sentinel route (GET is safe anyway, but belt-and-braces)
        assert response.status_code != 403

    @pytest.mark.asyncio
    async def test_websocket_upgrade_on_post_path(self) -> None:
        """Upgrade header on POST-like usage should still bypass CSRF."""
        app = _build_app(enabled=True, debug=False)
        async with _client(app) as client:
            # No Origin header, but Upgrade: websocket is present
            response = await client.post(
                "/api/v1/items",
                headers={"Upgrade": "websocket"},
            )
        # Must not be 403 – the upgrade flag skips CSRF
        assert response.status_code != 403


# ===========================================================================
# 10. Internal helper methods (white-box unit tests)
# ===========================================================================


class TestCSRFHelperMethods:
    """Direct unit tests for the private helper methods on the middleware class."""

    def _middleware(self, **kwargs) -> CSRFProtectionMiddleware:
        """Instantiate the middleware with a dummy ASGI app."""

        async def dummy_app(scope, receive, send):  # pragma: no cover
            pass

        return CSRFProtectionMiddleware(
            dummy_app,
            allowed_origins=kwargs.pop("allowed_origins", ALLOWED),
            **kwargs,
        )

    # _origin_is_allowed -------------------------------------------------------

    @pytest.mark.parametrize(
        "origin,expected",
        [
            ("http://localhost:3000",  True),
            ("http://localhost:5173",  True),
            ("http://localhost:3000/", True),   # trailing slash normalised
            ("http://evil.com",        False),
            ("",                       False),
        ],
    )
    def test_origin_is_allowed(self, origin: str, expected: bool) -> None:
        mw = self._middleware()
        assert mw._origin_is_allowed(origin) is expected

    # _extract_origin_from_referer ---------------------------------------------

    @pytest.mark.parametrize(
        "referer,expected_origin",
        [
            ("http://localhost:3000/dashboard",     "http://localhost:3000"),
            ("https://app.aems.com.br/service-orders", "https://app.aems.com.br"),
            ("http://localhost:5173/login",         "http://localhost:5173"),
            ("not-a-url",                           ""),   # unparseable → empty
            ("",                                    ""),
        ],
    )
    def test_extract_origin_from_referer(
        self, referer: str, expected_origin: str
    ) -> None:
        mw = self._middleware()
        assert mw._extract_origin_from_referer(referer) == expected_origin

    # _is_exempt_path ----------------------------------------------------------

    @pytest.mark.parametrize(
        "path,expected",
        [
            ("/api/v1/auth/login",   True),
            ("/api/v1/auth/refresh", True),
            ("/health",              True),
            ("/health/live",         True),   # prefix match
            ("/ws",                  True),
            ("/ws/service-orders",   True),   # prefix match
            ("/api/v1/items",        False),
            ("/api/v1/users",        False),
        ],
    )
    def test_is_exempt_path(self, path: str, expected: bool) -> None:
        mw = self._middleware()
        assert mw._is_exempt_path(path) is expected
