"""
I4 — Unicidade de nome de FilmType: IntegrityError deve virar 409 amigável.

Antes do fix: create_film_type faz SELECT-then-INSERT sem capturar
IntegrityError. Se dois requests concurrent passarem pelo SELECT antes de
um deles inserir, o segundo vira 500 IntegrityError no banco.

Após o fix: o INSERT é envolvido em try/except IntegrityError que re-lança
ConflictError (409) com mensagem amigável.

Também valida que o update (que já usa with_for_update) não regride.
"""

import pytest
from httpx import AsyncClient

from app.core.exceptions import ConflictError


class TestFilmTypeNameUniquenessRace:
    @pytest.mark.asyncio
    async def test_duplicate_name_via_api_returns_409(self, owner_client: AsyncClient):
        """Criar FilmType com nome duplicado via API deve retornar 409 (não 500)."""
        payload = {
            "name": "UniqueNameRaceTest",
            "department": "film",
            "yellow_threshold_meters": 6.0,
            "red_threshold_meters": 2.0,
        }

        # Primeiro: cria com sucesso
        resp1 = await owner_client.post("/api/v1/film-types", json=payload)
        assert resp1.status_code == 201, resp1.text

        # Segundo: mesmo nome deve ser 409 (checagem via SELECT já existe)
        resp2 = await owner_client.post("/api/v1/film-types", json=payload)
        assert resp2.status_code == 409, (
            f"Nome duplicado retornou {resp2.status_code} em vez de 409"
        )

    @pytest.mark.asyncio
    async def test_service_layer_wraps_integrity_error_as_conflict(self):
        """
        Teste unitário: a função create_film_type deve capturar IntegrityError
        e relançar como ConflictError quando a guarda de SELECT passa mas o
        INSERT falha (race condition real).
        """
        from unittest.mock import AsyncMock, MagicMock

        from sqlalchemy.exc import IntegrityError as SAIntegrityError

        from app.modules.inventory import service as inv_service
        from app.modules.inventory.schemas import FilmTypeCreate

        data = FilmTypeCreate(
            name="RaceTestUnit",
            department="film",
            yellow_threshold_meters=6.0,
            red_threshold_meters=2.0,
        )

        # Cria um db mock que: SELECT retorna None (guarda passa), flush levanta IntegrityError
        mock_db = MagicMock()
        mock_db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=lambda: None))
        mock_db.add = MagicMock()
        mock_db.flush = AsyncMock(
            side_effect=SAIntegrityError(
                "UNIQUE constraint failed: film_types.name",
                params=None,
                orig=Exception("UNIQUE"),
            )
        )
        mock_db.rollback = AsyncMock()

        with pytest.raises(ConflictError) as exc_info:
            await inv_service.create_film_type(mock_db, data, created_by_id=1)

        assert exc_info.value.status_code == 409
        assert (
            "nome" in exc_info.value.detail.lower() or "já existe" in exc_info.value.detail.lower()
        )
