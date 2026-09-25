"""
Cache de leitura (cached_catalog) do GET /film-types, catálogo de referência
consumido pelo editor de O.S. (junto com Consultores e Funcionários).

Diferente de Consultores/Funcionários, tipos de película NÃO são filtrados por
loja (acessível a qualquer usuário autenticado) — a chave de cache aqui não
inclui escopo de usuário, só os filtros/paginação (ver
app/modules/inventory/router.py::list_film_types).

A suíte roda com DEBUG=true (bypass total do cache, ver tests/conftest.py);
cada teste liga o cache (DEBUG=False) com um Redis fake e restaura no finally.
"""

from unittest.mock import patch

import pytest
from httpx import AsyncClient

from app.config import get_settings
from app.core.redis import bump_catalogs_cache
from app.modules.inventory.models import FilmType


class _FakeRedis:
    """Fake mínimo de redis.asyncio.Redis (get/setex/incr) para ligar o cache
    de catálogos nestes testes sem depender de um Redis real."""

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


class TestFilmTypesListCache:
    @pytest.mark.asyncio
    async def test_list_is_cached_until_bump(
        self,
        authenticated_client: AsyncClient,
        db_session,
    ):
        """2ª leitura não reflete um tipo novo até bump_catalogs_cache()."""
        film_type = FilmType(
            name="Fumê G20 Cache",
            department="film",
            yellow_threshold_meters=10.0,
            red_threshold_meters=3.0,
            is_active=True,
            available_tonalities=["G20"],
        )
        db_session.add(film_type)
        await db_session.commit()

        settings = get_settings()
        fake = _FakeRedis()
        object.__setattr__(settings, "DEBUG", False)
        try:
            with patch("app.core.redis.get_redis", return_value=fake):
                # Semeia a versão antes da 1ª leitura: um INCR do Redis numa chave
                # ausente cria-a em 1 — mesmo valor que a leitura já assume por
                # padrão sem essa chave — então o 1º bump da vida do Redis seria
                # um no-op. Todo bump seguinte (o caso real de produção) invalida
                # normalmente.
                await bump_catalogs_cache()

                first = await authenticated_client.get("/api/v1/film-types")
                assert first.status_code == 200
                total_first = first.json()["pagination"]["total"]

                new_type = FilmType(
                    name="Nano G35 Cache",
                    department="film",
                    yellow_threshold_meters=10.0,
                    red_threshold_meters=3.0,
                    is_active=True,
                    available_tonalities=["G35"],
                )
                db_session.add(new_type)
                await db_session.commit()

                second = await authenticated_client.get("/api/v1/film-types")
                assert second.json()["pagination"]["total"] == total_first  # ainda cache

                await bump_catalogs_cache()

                third = await authenticated_client.get("/api/v1/film-types")
                assert third.json()["pagination"]["total"] == total_first + 1  # recomputou
        finally:
            object.__setattr__(settings, "DEBUG", True)

    @pytest.mark.asyncio
    async def test_different_filters_do_not_share_cache_entry(
        self,
        authenticated_client: AsyncClient,
        db_session,
    ):
        """department=film e department=ppf são chaves de cache distintas."""
        film = FilmType(
            name="Fumê Filtro Film",
            department="film",
            yellow_threshold_meters=10.0,
            red_threshold_meters=3.0,
            is_active=True,
            available_tonalities=["G20"],
        )
        ppf = FilmType(
            name="PPF Filtro Ppf",
            department="ppf",
            yellow_threshold_meters=10.0,
            red_threshold_meters=3.0,
            is_active=True,
            available_tonalities=[],
        )
        db_session.add_all([film, ppf])
        await db_session.commit()

        settings = get_settings()
        fake = _FakeRedis()
        object.__setattr__(settings, "DEBUG", False)
        try:
            with patch("app.core.redis.get_redis", return_value=fake):
                film_resp = await authenticated_client.get("/api/v1/film-types?department=film")
                ppf_resp = await authenticated_client.get("/api/v1/film-types?department=ppf")

                film_names = {i["name"] for i in film_resp.json()["items"]}
                ppf_names = {i["name"] for i in ppf_resp.json()["items"]}

                assert "Fumê Filtro Film" in film_names
                assert "PPF Filtro Ppf" not in film_names
                assert "PPF Filtro Ppf" in ppf_names
                assert "Fumê Filtro Film" not in ppf_names
        finally:
            object.__setattr__(settings, "DEBUG", True)
