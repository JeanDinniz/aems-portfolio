"""
I2 — FilmType: limiar vermelho deve ser menor que o limiar amarelo.

Antes do fix: FilmTypeCreate e FilmTypeUpdate validam apenas gt=0 para
ambos os campos, mas não validam que red < yellow. Isso permite criar um tipo
com red >= yellow, invertendo (ou anulando) a lógica dos alertas de estoque.

Após o fix: model_validator rejeita red >= yellow com mensagem clara
em ambos os schemas (Create e Update, considerando o estado final no Update).
"""

import pytest
from httpx import AsyncClient


class TestFilmTypeThresholdValidation:
    # ------------------------------------------------------------------ Create
    @pytest.mark.asyncio
    async def test_create_rejects_red_equal_to_yellow(self, owner_client: AsyncClient):
        """Criar FilmType com red == yellow deve retornar 422."""
        resp = await owner_client.post(
            "/api/v1/film-types",
            json={
                "name": "ThresholdTestEqual",
                "department": "film",
                "yellow_threshold_meters": 5.0,
                "red_threshold_meters": 5.0,
            },
        )
        assert resp.status_code == 422, (
            f"BUG I2: red == yellow foi aceito (status {resp.status_code}). "
            "Esperava rejeição 422."
        )

    @pytest.mark.asyncio
    async def test_create_rejects_red_greater_than_yellow(self, owner_client: AsyncClient):
        """Criar FilmType com red > yellow deve retornar 422."""
        resp = await owner_client.post(
            "/api/v1/film-types",
            json={
                "name": "ThresholdTestGreater",
                "department": "film",
                "yellow_threshold_meters": 3.0,
                "red_threshold_meters": 8.0,
            },
        )
        assert resp.status_code == 422, (
            f"BUG I2: red > yellow foi aceito (status {resp.status_code}). "
            "Esperava rejeição 422."
        )

    @pytest.mark.asyncio
    async def test_create_accepts_valid_thresholds(self, owner_client: AsyncClient):
        """Criar FilmType com red < yellow deve ser aceito (200/201)."""
        resp = await owner_client.post(
            "/api/v1/film-types",
            json={
                "name": "ThresholdTestValid",
                "department": "film",
                "yellow_threshold_meters": 6.0,
                "red_threshold_meters": 2.0,
            },
        )
        assert resp.status_code == 201, (
            f"Threshold válido (red=2 < yellow=6) foi rejeitado: {resp.text}"
        )

    # ------------------------------------------------------------------ Update
    @pytest.mark.asyncio
    async def test_update_rejects_red_equal_to_yellow(self, owner_client: AsyncClient):
        """Atualizar FilmType resultando em red == yellow deve retornar 422."""
        create = await owner_client.post(
            "/api/v1/film-types",
            json={
                "name": "ThresholdUpdateTestEqual",
                "department": "film",
                "yellow_threshold_meters": 6.0,
                "red_threshold_meters": 2.0,
            },
        )
        assert create.status_code == 201, create.text
        ft_id = create.json()["id"]

        # Atualiza yellow para o mesmo valor do red atual (2)
        resp = await owner_client.patch(
            f"/api/v1/film-types/{ft_id}",
            json={"yellow_threshold_meters": 2.0},
        )
        assert resp.status_code == 422, (
            f"BUG I2: update resultando em red == yellow foi aceito "
            f"(status {resp.status_code}). Esperava rejeição 422."
        )

    @pytest.mark.asyncio
    async def test_update_rejects_red_greater_than_yellow_after_merge(
        self, owner_client: AsyncClient
    ):
        """
        Atualização parcial: envia só red_threshold com valor maior que o yellow
        corrente → deve ser rejeitado.
        """
        create = await owner_client.post(
            "/api/v1/film-types",
            json={
                "name": "ThresholdUpdatePartial",
                "department": "film",
                "yellow_threshold_meters": 6.0,
                "red_threshold_meters": 2.0,
            },
        )
        assert create.status_code == 201, create.text
        ft_id = create.json()["id"]

        # Envia só red maior que yellow corrente (6)
        resp = await owner_client.patch(
            f"/api/v1/film-types/{ft_id}",
            json={"red_threshold_meters": 10.0},
        )
        assert resp.status_code == 422, (
            f"BUG I2: update parcial resultando em red > yellow foi aceito "
            f"(status {resp.status_code}). Esperava rejeição 422."
        )

    @pytest.mark.asyncio
    async def test_update_accepts_valid_threshold_change(self, owner_client: AsyncClient):
        """Atualizar mantendo red < yellow deve ser aceito."""
        create = await owner_client.post(
            "/api/v1/film-types",
            json={
                "name": "ThresholdUpdateValid",
                "department": "film",
                "yellow_threshold_meters": 6.0,
                "red_threshold_meters": 2.0,
            },
        )
        assert create.status_code == 201, create.text
        ft_id = create.json()["id"]

        resp = await owner_client.patch(
            f"/api/v1/film-types/{ft_id}",
            json={"yellow_threshold_meters": 10.0, "red_threshold_meters": 3.0},
        )
        assert resp.status_code == 200, (
            f"Threshold válido (red=3 < yellow=10) foi rejeitado na atualização: {resp.text}"
        )
