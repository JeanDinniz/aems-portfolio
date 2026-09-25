"""
I3 — create_request cria FilmRoll com visual_id duplicado quando o mesmo
pedido tem 2 linhas do mesmo tipo/tonalidade/metragem na mesma data.

O visual_id é computado em runtime via compute_visual_id(name, tonality,
receipt_date, total_meters). Bobinas diferentes com os mesmos 4 parâmetros
resultam em IDs visuais idênticos, confundindo o usuário no painel de Estoque.

O register_roll em inventory/service.py resolve isso auto-incrementando
receipt_date (+1 dia) quando já existe uma bobina com mesma combinação de
store + film_type + tonality + receipt_date. _create_roll_from_line em
material_requests/service.py não aplicava essa lógica.

Após o fix: duas linhas idênticas no mesmo pedido devem gerar bobinas com
visual_ids distintos (receipt_dates distintas).
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.inventory.models import FilmRoll
from app.modules.inventory.service import compute_visual_id
from app.modules.stores.models import Store


@pytest_asyncio.fixture
async def film_type_for_i3(owner_client: AsyncClient) -> int:
    resp = await owner_client.post(
        "/api/v1/film-types",
        json={
            "name": "PoliesterI3",
            "department": "film",
            "yellow_threshold_meters": 6,
            "red_threshold_meters": 2,
            "available_tonalities": ["G05", "G20"],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


class TestMaterialRequestVisualIdUniqueness:
    @pytest.mark.asyncio
    async def test_two_identical_film_lines_get_distinct_visual_ids(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        film_type_for_i3: int,
    ):
        """
        Criar pedido com 2 linhas de película idênticas (mesmo tipo/tonalidade/
        metros) deve gerar bobinas com visual_ids distintos.
        """
        resp = await owner_client.post(
            "/api/v1/material-requests",
            json={
                "store_id": test_store.id,
                "request_date": "2030-01-15",
                "film_lines": [
                    {
                        "film_type_id": film_type_for_i3,
                        "total_meters": 15.0,
                        "tonality": "G05",
                    },
                    {
                        "film_type_id": film_type_for_i3,
                        "total_meters": 15.0,
                        "tonality": "G05",
                    },
                ],
                "tool_lines": [],
            },
        )
        assert resp.status_code in (200, 201), resp.text

        # Buscar as bobinas criadas para este pedido
        rolls = (
            await db_session.execute(
                select(FilmRoll)
                .where(FilmRoll.film_type_id == film_type_for_i3)
                .where(FilmRoll.store_id == test_store.id)
                .where(FilmRoll.total_meters == 15.0)
                .order_by(FilmRoll.receipt_date)
            )
        ).scalars().all()

        assert len(rolls) == 2, f"Esperava 2 bobinas, encontrou {len(rolls)}"

        visual_ids = [
            compute_visual_id("PoliesterI3", r.tonality, r.receipt_date, r.total_meters)
            for r in rolls
        ]

        assert visual_ids[0] != visual_ids[1], (
            f"BUG I3: duas bobinas com visual_id idêntico: '{visual_ids[0]}'. "
            "receipt_dates deveriam diferir para distingui-las."
        )

    @pytest.mark.asyncio
    async def test_different_tonalities_get_distinct_visual_ids(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        film_type_for_i3: int,
    ):
        """
        Duas linhas com tonalidades diferentes → visual_ids naturalmente distintos
        (regressão: isso deve continuar funcionando sem ser afetado pelo fix).
        """
        resp = await owner_client.post(
            "/api/v1/material-requests",
            json={
                "store_id": test_store.id,
                "request_date": "2030-02-15",
                "film_lines": [
                    {
                        "film_type_id": film_type_for_i3,
                        "total_meters": 15.0,
                        "tonality": "G05",
                    },
                    {
                        "film_type_id": film_type_for_i3,
                        "total_meters": 15.0,
                        "tonality": "G20",
                    },
                ],
                "tool_lines": [],
            },
        )
        assert resp.status_code in (200, 201), resp.text

        rolls = (
            await db_session.execute(
                select(FilmRoll)
                .where(FilmRoll.film_type_id == film_type_for_i3)
                .where(FilmRoll.store_id == test_store.id)
                .where(FilmRoll.total_meters == 15.0)
            )
        ).scalars().all()

        # Filtra só os desta tonalidade
        g05 = next((r for r in rolls if r.tonality == "G05"), None)
        g20 = next((r for r in rolls if r.tonality == "G20"), None)
        assert g05 is not None and g20 is not None

        vid_g05 = compute_visual_id("PoliesterI3", "G05", g05.receipt_date, 15.0)
        vid_g20 = compute_visual_id("PoliesterI3", "G20", g20.receipt_date, 15.0)
        assert vid_g05 != vid_g20
