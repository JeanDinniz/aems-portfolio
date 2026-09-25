"""Integração (smoke): exports Excel de bobinas de película.

Caracteriza os endpoints GET /inventory/rolls/export e
GET /inventory/rolls/{id}/export — garante 200 + XLSX. Rede de segurança para o
refactor que deixou de mutar o objeto ORM p/ carregar o visual_id.
"""

import pytest
from httpx import AsyncClient

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


async def _film_type(owner_client: AsyncClient, name: str) -> int:
    resp = await owner_client.post(
        "/api/v1/film-types",
        json={
            "name": name,
            "department": "film",
            "yellow_threshold_meters": 6,
            "red_threshold_meters": 2,
            "available_tonalities": ["G05", "G20", "G35"],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _register_roll(owner_client: AsyncClient, store_id: int, ft_id: int) -> dict:
    resp = await owner_client.post(
        "/api/v1/inventory/rolls",
        json={
            "store_id": store_id,
            "film_type_id": ft_id,
            "tonality": "G20",
            "total_meters": 15,
            "receipt_date": "2026-08-01",
            "nfe_number": "111",
            "cost": "100.00",
            "supplier": "Fornecedor X",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestInventoryExport:
    @pytest.mark.asyncio
    async def test_export_inventory_list(self, owner_client: AsyncClient, test_store):
        ft_id = await _film_type(owner_client, "Export List FT")
        await _register_roll(owner_client, test_store.id, ft_id)

        resp = await owner_client.get("/api/v1/inventory/export")
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == XLSX_MIME
        assert len(resp.content) > 0

    @pytest.mark.asyncio
    async def test_export_single_roll(self, owner_client: AsyncClient, test_store):
        ft_id = await _film_type(owner_client, "Export Roll FT")
        roll = await _register_roll(owner_client, test_store.id, ft_id)

        resp = await owner_client.get(f"/api/v1/inventory/rolls/{roll['id']}/export")
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == XLSX_MIME
        # O nome do arquivo usa o visual_id computado (NomeTipo_Tonalidade_DDMMAAAA)
        assert "ExportRollFT_G20_01082026" in resp.headers.get("content-disposition", "")
        assert len(resp.content) > 0
