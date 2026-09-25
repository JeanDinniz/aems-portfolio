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
from collections.abc import Awaitable, Callable
from typing import TypeVar

import redis.asyncio as aioredis

from app.config import get_settings

_T = TypeVar("_T")

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


# Invalidação por VERSÃO do cache de analytics (Indicadores/Dashboard).
# O Redis compartilhado aqui não tem DEL por padrão; em vez de varrer chaves,
# embutimos uma versão nas chaves de leitura (ver analytics/router._cached) e
# damos INCR nessa versão quando um dado-fonte muda (bobina/consumo/O.S./pedido).
# Assim TODAS as chaves antigas ficam inalcançáveis de uma vez (O(1)) e expiram
# sozinhas pelo TTL. Fail-open: Redis fora → versão 1 / bump ignorado.
_ANALYTICS_VERSION_KEY = "analytics:cache_version"


async def cache_get_analytics_version() -> int:
    """Versão atual do cache de analytics (1 se ausente/Redis fora)."""
    try:
        raw = await get_redis().get(_ANALYTICS_VERSION_KEY)
        return int(raw) if raw else 1
    except Exception:
        return 1


async def bump_analytics_cache() -> None:
    """
    Invalida o cache de leitura de analytics (INCR da versão embutida nas chaves).

    Chamado nos writes que mexem em dado que os Indicadores agregam (bobina,
    consumo, O.S., pedido de material), para o número atualizar sem esperar o
    TTL. Best-effort: falha é ignorada (o TTL curto continua sendo o backstop).
    """
    try:
        await get_redis().incr(_ANALYTICS_VERSION_KEY)
    except Exception:
        pass


# Mesmo mecanismo de invalidação por VERSÃO, aplicado aos catálogos de
# referência consumidos pelo editor de O.S. (tipos de película, consultores,
# funcionários por loja/departamento). Ganho de cache aqui é marginal — o
# frontend já cacheia bastante no cliente — mas foi pedido explícito do dono
# para aliviar picos de leitura simultânea (várias lojas abrindo o editor ao
# mesmo tempo). Versão própria (não reaproveita a de analytics) para não
# invalidar catálogos toda vez que uma O.S./bobina muda, e vice-versa.
_CATALOGS_VERSION_KEY = "catalogs:cache_version"


async def cache_get_catalogs_version() -> int:
    """Versão atual do cache de catálogos (1 se ausente/Redis fora)."""
    try:
        raw = await get_redis().get(_CATALOGS_VERSION_KEY)
        return int(raw) if raw else 1
    except Exception:
        return 1


async def bump_catalogs_cache() -> None:
    """
    Invalida o cache de leitura dos catálogos (INCR da versão embutida nas chaves).

    Chamado nos writes de tipos de película, consultores e funcionários (create/
    update/delete), para o catálogo atualizar sem esperar o TTL. Best-effort:
    falha é ignorada (o TTL curto continua sendo o backstop).
    """
    try:
        await get_redis().incr(_CATALOGS_VERSION_KEY)
    except Exception:
        pass


async def cached_catalog(key: str, compute: Callable[[], Awaitable[_T]], ttl: int = 300) -> _T:
    """
    Cache de leitura fail-open para catálogos de referência (tipos de película,
    consultores, funcionários) consumidos pelo editor de O.S.

    Espelha o helper ``_cached`` de ``analytics/router.py``: a chave DEVE incluir
    todos os filtros/paginação do endpoint e, quando a listagem é restrita por
    loja, o escopo do usuário (ver ``store_scope_cache_key`` em
    ``app.core.permissions``) — nunca cachear o resultado de um usuário/perfil e
    servir para outro com lojas diferentes.

    Em DEBUG o cache é desligado: dev quer dado fresco e a suíte de testes
    reaproveita os mesmos filtros com dados diferentes entre casos (contaminaria).

    Args:
        key: Identifica a consulta (sem a versão — ela é embutida abaixo).
        compute: Callable assíncrona sem argumentos que produz o resultado.
        ttl: Tempo de vida em segundos do valor cacheado (default 5 min).
    """
    from fastapi.encoders import jsonable_encoder

    from app.config import get_settings

    if get_settings().DEBUG:
        return await compute()

    # Versão embutida na chave: um bump_catalogs_cache() num write torna todas
    # as chaves da versão anterior inalcançáveis de uma vez (invalidação O(1)).
    version = await cache_get_catalogs_version()
    versioned_key = f"v{version}:{key}"

    cached = await cache_json_get(versioned_key)
    if cached is not None:
        return cached
    result = await compute()
    await cache_json_set(versioned_key, jsonable_encoder(result), ttl)
    return result
