"""
Testes do cache de leitura fail-open dos catálogos de referência (tipos de
película, consultores, funcionários) consumidos pelo editor de O.S.

Espelha o comportamento de `app.modules.analytics.router._cached` (que não
tinha teste dedicado até aqui): chave versionada, bypass em DEBUG, fail-open
quando o Redis está fora. Como a suíte roda inteira com DEBUG=true (ver
tests/conftest.py, para não contaminar outros testes com cache reaproveitado),
os testes que precisam exercitar o cache "ligado" alternam `settings.DEBUG`
para False dentro do próprio teste e restauram no finally.

O fixture `client` (usado nos testes de integração) sobrescreve `get_db` com
um `yield` direto, sem passar pelo hook pós-commit de `app.db.session.get_db`
— por isso o mecanismo de invalidação (B3) é testado aqui isoladamente,
chamando `get_db()` de verdade.
"""

from unittest.mock import AsyncMock, patch

import pytest

from app.config import get_settings
from app.core.redis import (
    bump_catalogs_cache,
    cache_get_catalogs_version,
    cached_catalog,
)


class FakeRedis:
    """Fake mínimo de redis.asyncio.Redis (get/setex/incr) para testar o
    cache sem depender de um Redis real rodando na porta 6380."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def setex(self, key: str, ttl: int, value: str) -> None:
        self.store[key] = value

    async def incr(self, key: str) -> int:
        current = int(self.store.get(key, 0)) + 1
        self.store[key] = str(current)
        return current


class _DebugOff:
    """Context manager: liga o cache (DEBUG=False) e restaura ao sair.

    Preserva o padrão já usado no projeto (`object.__setattr__` em
    `test_auth.py`/`test_push_send.py`) para mutar a Settings singleton nos
    testes sem quebrar a imutabilidade esperada em produção.
    """

    def __enter__(self):
        self.settings = get_settings()
        object.__setattr__(self.settings, "DEBUG", False)
        return self.settings

    def __exit__(self, *exc):
        object.__setattr__(self.settings, "DEBUG", True)


class TestCachedCatalogDebugBypass:
    @pytest.mark.asyncio
    async def test_bypassed_when_debug_true(self):
        """Em DEBUG (modo padrão da suíte), cached_catalog nunca cacheia."""
        assert get_settings().DEBUG is True  # sanity: conftest liga DEBUG=true

        calls = []

        async def compute():
            calls.append(1)
            return {"n": len(calls)}

        first = await cached_catalog("debug:key", compute)
        second = await cached_catalog("debug:key", compute)

        assert first == {"n": 1}
        assert second == {"n": 2}
        assert len(calls) == 2  # recomputou as duas vezes — sem cache


class TestCachedCatalogHitMiss:
    @pytest.mark.asyncio
    async def test_second_call_hits_cache(self):
        """Fora de DEBUG, a 2ª chamada com a mesma chave não recomputa."""
        fake = FakeRedis()
        calls = []

        async def compute():
            calls.append(1)
            return {"items": [1, 2, 3]}

        with _DebugOff(), patch("app.core.redis.get_redis", return_value=fake):
            first = await cached_catalog("catalog:hit", compute)
            second = await cached_catalog("catalog:hit", compute)

        assert first == {"items": [1, 2, 3]}
        assert second == {"items": [1, 2, 3]}
        assert len(calls) == 1

    @pytest.mark.asyncio
    async def test_different_keys_do_not_collide(self):
        """Chaves diferentes (ex.: filtros/escopo diferentes) não compartilham cache."""
        fake = FakeRedis()
        calls = []

        async def make_compute(tag):
            async def compute():
                calls.append(tag)
                return {"tag": tag}

            return compute

        with _DebugOff(), patch("app.core.redis.get_redis", return_value=fake):
            result_a = await cached_catalog("catalog:a", await make_compute("a"))
            result_b = await cached_catalog("catalog:b", await make_compute("b"))

        assert result_a == {"tag": "a"}
        assert result_b == {"tag": "b"}
        assert calls == ["a", "b"]


class TestBumpCatalogsCacheInvalidation:
    @pytest.mark.asyncio
    async def test_bump_forces_recompute_then_caches_again(self):
        """bump_catalogs_cache incrementa a versão embutida na chave -> a
        leitura seguinte recomputa; a leitura depois dessa volta a cachear."""
        fake = FakeRedis()
        calls = []

        async def compute():
            calls.append(1)
            return {"n": len(calls)}

        with _DebugOff(), patch("app.core.redis.get_redis", return_value=fake):
            # Semeia a versão ANTES da 1ª leitura: no Redis real, um INCR numa
            # chave ausente cria-a em 1 (mesmo valor que cache_get_catalogs_version
            # já assume por padrão quando a chave não existe) — sem isso, o
            # PRIMEIRO bump da vida do processo seria um no-op (1 -> 1) e não
            # provaria nada. Qualquer bump seguinte (o caso real, já que toda
            # mutação de catálogo bumpa) incrementa normalmente (1 -> 2 -> ...).
            await bump_catalogs_cache()

            first = await cached_catalog("catalog:bump", compute)
            second = await cached_catalog("catalog:bump", compute)  # hit
            await bump_catalogs_cache()
            third = await cached_catalog("catalog:bump", compute)  # miss pós-bump
            fourth = await cached_catalog("catalog:bump", compute)  # hit de novo

        assert (first, second, third, fourth) == (
            {"n": 1},
            {"n": 1},
            {"n": 2},
            {"n": 2},
        )
        assert len(calls) == 2

    @pytest.mark.asyncio
    async def test_bump_does_not_affect_unrelated_module_version(self):
        """A versão de catálogos é independente da de analytics (chaves prefixadas
        distintas) — bump de um não deve invalidar o outro."""
        from app.core.redis import cache_get_analytics_version

        fake = FakeRedis()
        with _DebugOff(), patch("app.core.redis.get_redis", return_value=fake):
            before = await cache_get_analytics_version()
            await bump_catalogs_cache()
            after = await cache_get_analytics_version()

        assert before == after == 1


class TestCatalogCacheFailOpen:
    @pytest.mark.asyncio
    async def test_cached_catalog_falls_back_to_compute_when_redis_down(self):
        """Redis indisponível não derruba a leitura: cai para compute() (fail-open)."""
        broken = AsyncMock()
        broken.get = AsyncMock(side_effect=ConnectionError("Redis down"))
        broken.setex = AsyncMock(side_effect=ConnectionError("Redis down"))

        calls = []

        async def compute():
            calls.append(1)
            return {"ok": True}

        with _DebugOff(), patch("app.core.redis.get_redis", return_value=broken):
            result = await cached_catalog("catalog:down", compute)

        assert result == {"ok": True}
        assert len(calls) == 1

    @pytest.mark.asyncio
    async def test_bump_catalogs_cache_swallows_redis_error(self):
        """bump_catalogs_cache não propaga erro do Redis (best-effort)."""
        broken = AsyncMock()
        broken.incr = AsyncMock(side_effect=ConnectionError("Redis down"))

        with patch("app.core.redis.get_redis", return_value=broken):
            await bump_catalogs_cache()  # não deve levantar

    @pytest.mark.asyncio
    async def test_cache_get_catalogs_version_defaults_to_1_when_redis_down(self):
        """Sem Redis, a versão cai para 1 (não quebra a composição da chave)."""
        broken = AsyncMock()
        broken.get = AsyncMock(side_effect=ConnectionError("Redis down"))

        with patch("app.core.redis.get_redis", return_value=broken):
            version = await cache_get_catalogs_version()

        assert version == 1


class TestGetDbBumpCatalogsHook:
    """Testa o MECANISMO de invalidação pós-commit (B3) isoladamente do HTTP.

    O fixture `client` usado nos testes de integração sobrescreve `get_db`
    com um `yield` direto (sem hook), então a wiring real de
    `app/db/session.py` só é exercitada chamando `get_db()` de verdade, como
    abaixo — com sua PRÓPRIA sessão (sessionmaker isolado sobre o mesmo
    `db_engine` de teste), para não interferir no ciclo de vida do fixture
    `db_session` usado pelos demais testes.
    """

    @pytest.mark.asyncio
    async def test_bump_catalogs_called_when_flag_is_set(self, db_engine):
        """Quando um service marca db.info['bump_catalogs'], o get_db() real
        chama bump_catalogs_cache() após o commit."""
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

        import app.core.redis as redis_module
        import app.db.session as session_module

        calls = []

        async def fake_bump():
            calls.append(1)

        test_sessionmaker = async_sessionmaker(
            bind=db_engine, class_=AsyncSession, expire_on_commit=False
        )

        with (
            patch.object(redis_module, "bump_catalogs_cache", fake_bump),
            patch.object(session_module, "AsyncSessionLocal", test_sessionmaker),
        ):
            gen = session_module.get_db()
            session = await gen.__anext__()
            session.info["bump_catalogs"] = True
            with pytest.raises(StopAsyncIteration):
                await gen.__anext__()

        assert calls == [1]

    @pytest.mark.asyncio
    async def test_bump_catalogs_not_called_when_flag_absent(self, db_engine):
        """Sem a flag, get_db() não chama bump_catalogs_cache (não invalida à toa)."""
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

        import app.core.redis as redis_module
        import app.db.session as session_module

        calls = []

        async def fake_bump():
            calls.append(1)

        test_sessionmaker = async_sessionmaker(
            bind=db_engine, class_=AsyncSession, expire_on_commit=False
        )

        with (
            patch.object(redis_module, "bump_catalogs_cache", fake_bump),
            patch.object(session_module, "AsyncSessionLocal", test_sessionmaker),
        ):
            gen = session_module.get_db()
            await gen.__anext__()
            with pytest.raises(StopAsyncIteration):
                await gen.__anext__()

        assert calls == []
