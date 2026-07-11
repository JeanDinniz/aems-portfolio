"""
Cliente Redis assíncrono compartilhado (singleton por processo).

Evita abrir/fechar uma conexão TCP a cada request (antes: get_current_user,
health check e auth criavam um cliente novo por chamada). O cliente do
redis-py gerencia um pool interno; basta reutilizar a mesma instância.

Uso:
    from app.core.redis import get_redis
    redis_client = get_redis()
    await redis_client.get(...)

Não chame .aclose() no cliente retornado — o ciclo de vida é do processo
(encerrado via close_redis() no shutdown do lifespan).
"""

import asyncio

import redis.asyncio as aioredis

from app.config import get_settings

_client: aioredis.Redis | None = None
_client_loop_id: int | None = None


def get_redis() -> aioredis.Redis:
    """
    Retorna o cliente Redis compartilhado do event loop atual (lazy).

    O cliente é vinculado ao event loop em que foi criado. Em produção há um
    único loop (uvicorn), então isso equivale a um singleton por processo.
    Em testes (pytest cria um loop novo por teste) um cliente novo é criado
    quando o loop muda — senão as conexões do loop anterior, já fechado,
    explodem com "Event loop is closed".
    """
    global _client, _client_loop_id
    loop_id = id(asyncio.get_running_loop())
    if _client is None or _client_loop_id != loop_id:
        settings = get_settings()
        _client = aioredis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            max_connections=20,
            # Reaproveita conexões com segurança após restart/idle do Redis
            health_check_interval=30,
        )
        _client_loop_id = loop_id
    return _client


async def close_redis() -> None:
    """Fecha o pool no shutdown da aplicação (lifespan)."""
    global _client, _client_loop_id
    if _client is not None:
        await _client.aclose()
        _client = None
        _client_loop_id = None


async def cache_json_get(key: str):
    """Lê um valor JSON do cache. Fail-open: Redis indisponível → None (miss)."""
    import json

    try:
        raw = await get_redis().get(key)
        return json.loads(raw) if raw else None
    except Exception:
        return None


async def cache_json_set(key: str, value, ttl_seconds: int) -> None:
    """Grava um valor JSON no cache com TTL. Fail-open: falha é ignorada."""
    import json

    try:
        await get_redis().setex(key, ttl_seconds, json.dumps(value, default=str))
    except Exception:
        pass
