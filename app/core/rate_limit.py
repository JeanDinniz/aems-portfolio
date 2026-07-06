"""
Rate limiting configuration using SlowAPI.
Protects endpoints against brute force and abuse.
"""

import logging

from slowapi import Limiter

from app.config import get_settings
from app.core.security import get_client_ip

logger = logging.getLogger(__name__)
settings = get_settings()


def _get_storage_uri() -> str:
    """Get storage URI, falling back to memory if Redis is unavailable."""
    try:
        import redis

        r = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1)
        r.ping()
        return settings.REDIS_URL
    except Exception:
        logger.info("Redis unavailable for rate limiting, using in-memory storage")
        return "memory://"


limiter = Limiter(
    key_func=get_client_ip,
    default_limits=[settings.RATE_LIMIT_DEFAULT],
    enabled=settings.RATE_LIMIT_ENABLED,
    storage_uri=_get_storage_uri(),
)
