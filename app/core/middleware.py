"""
Custom middlewares for security headers and request tracking.
"""

import uuid
from urllib.parse import urlparse

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds security headers to all responses."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"

        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        return response


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Adds a unique X-Request-ID header to each request/response for tracing."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id

        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id

        return response


# Methods that mutate server state and therefore require Origin/Referer validation.
_STATE_CHANGING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Paths that are always exempt from CSRF validation because the caller cannot
# hold a token yet (login) or the path is infrastructure-level (health, ws).
_EXEMPT_PATH_PREFIXES = (
    "/health",
    "/ws",  # WebSocket upgrade requests land here before the protocol switch
)

# The auth login path is exempt so that a fresh browser (no token) can log in.
_EXEMPT_EXACT_PATHS = {
    "/api/v1/auth/login",
    "/api/v1/auth/refresh",
}


class CSRFProtectionMiddleware(BaseHTTPMiddleware):
    """
    Defense-in-depth Origin/Referer validation for state-changing requests.

    Because AEMS uses JWT tokens sent in the Authorization header (not cookies),
    classic CSRF is not a real attack vector -- a cross-origin page cannot read
    the token.  This middleware adds a second layer of protection by requiring
    that the Origin or Referer header on POST/PUT/PATCH/DELETE requests matches
    one of the configured ALLOWED_ORIGINS.

    Skipped for:
    - Safe HTTP methods (GET, HEAD, OPTIONS)
    - The login / refresh endpoints (caller has no token yet)
    - Health-check and WebSocket paths
    - WebSocket upgrade requests (Upgrade: websocket header present)
    - DEBUG mode when no Origin/Referer header is present at all
      (allows Postman / curl / automated test clients during development)
    - When CSRF_ENABLED is False in settings
    """

    def __init__(
        self, app, allowed_origins: list[str], debug: bool = False, enabled: bool = True
    ) -> None:
        super().__init__(app)
        # Store only the scheme+host portion of each allowed origin so that
        # sub-paths in the Referer header are handled correctly.
        self._allowed_origins: set[str] = set(allowed_origins)
        self._debug = debug
        self._enabled = enabled

    def _origin_is_allowed(self, origin: str) -> bool:
        """Return True when *origin* (scheme+host[:port]) is in the allow-list."""
        # Normalise: strip trailing slash so "http://localhost:3000/" still matches.
        return origin.rstrip("/") in self._allowed_origins

    def _extract_origin_from_referer(self, referer: str) -> str:
        """Extract the scheme+host[:port] from a full Referer URL."""
        parsed = urlparse(referer)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"
        return ""

    def _is_websocket_upgrade(self, request: Request) -> bool:
        """Return True if this request is a WebSocket upgrade handshake."""
        return request.headers.get("upgrade", "").lower() == "websocket"

    def _is_exempt_path(self, path: str) -> bool:
        """Return True when the request path should bypass CSRF validation."""
        if path in _EXEMPT_EXACT_PATHS:
            return True
        return any(path.startswith(prefix) for prefix in _EXEMPT_PATH_PREFIXES)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Feature flag: allow disabling for test environments.
        if not self._enabled:
            return await call_next(request)

        # Only validate state-changing methods.
        if request.method not in _STATE_CHANGING_METHODS:
            return await call_next(request)

        # WebSocket upgrades negotiate their own protocol; skip them.
        if self._is_websocket_upgrade(request):
            return await call_next(request)

        # Exempt login, health, and WebSocket paths.
        if self._is_exempt_path(request.url.path):
            return await call_next(request)

        origin_header: str | None = request.headers.get("origin")
        referer_header: str | None = request.headers.get("referer")

        # Determine the effective origin to validate.
        if origin_header:
            effective_origin = origin_header.rstrip("/")
        elif referer_header:
            effective_origin = self._extract_origin_from_referer(referer_header)
        else:
            # No Origin or Referer present.
            # In DEBUG mode this is fine (Postman, curl, pytest HTTP client).
            # In production, deny the request to be safe.
            if self._debug:
                return await call_next(request)
            return JSONResponse(
                status_code=403,
                content={
                    "detail": (
                        "Requisição bloqueada: cabeçalho Origin ou Referer ausente. "
                        "Inclua o cabeçalho Origin na requisição."
                    )
                },
            )

        if self._origin_is_allowed(effective_origin):
            return await call_next(request)

        return JSONResponse(
            status_code=403,
            content={
                "detail": (
                    f"Requisição bloqueada: origem '{effective_origin}' não é permitida. "
                    "Verifique as configurações de CORS/CSRF."
                )
            },
        )
