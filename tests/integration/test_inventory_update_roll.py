"""Integração: edição dos dados de uma bobina (PATCH /inventory/rolls/{id})."""

import pytest
from httpx import AsyncClient


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
            "supplier": "Antigo",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestUpdateRoll:
    @pytest.mark.asyncio
    async def test_edit_metadata_and_total_meters(self, owner_client: AsyncClient, test_store):
        ft_id = await _film_type(owner_client, "Edit Roll FT")
        roll = await _register_roll(owner_client, test_store.id, ft_id)
        roll_id = roll["id"]

        # Sem consumo → remaining == total. Ao mudar total p/ 20, remaining vira 20.
        resp = await owner_client.patch(
            f"/api/v1/inventory/rolls/{roll_id}",
            json={
                "tonality": "G35",
                "nfe_number": "222",
                "cost": "150.50",
                "total_meters": 20,
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["tonality"] == "G35"
        assert body["nfe_number"] == "222"
        assert float(body["cost"]) == 150.5
        assert body["total_meters"] == 20
        assert body["remaining_meters"] == 20

    @pytest.mark.asyncio
    async def test_clear_optional_fields(self, owner_client: AsyncClient, test_store):
        ft_id = await _film_type(owner_client, "Clear Roll FT")
        roll = await _register_roll(owner_client, test_store.id, ft_id)
        roll_id = roll["id"]

        resp = await owner_client.patch(
            f"/api/v1/inventory/rolls/{roll_id}",
            json={"clear_nfe": True, "clear_cost": True},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["nfe_number"] is None
        assert body["cost"] is None

    @pytest.mark.asyncio
    async def test_update_requires_edit_permission(
        self, client: AsyncClient, db_session, test_store, owner_client
    ):
        ft_id = await _film_type(owner_client, "Perm Roll FT")
        roll = await _register_roll(owner_client, test_store.id, ft_id)
        roll_id = roll["id"]

        from app.core.security import get_password_hash
        from app.modules.access_profiles.models import (
            AccessProfile,
            AccessProfileModulePermission,
            access_profile_users,
        )
        from app.modules.auth.models import User
        from tests.conftest import VALID_TEST_PASSWORD

        user = User(
            email="rollviewer@test.com",
            hashed_password=get_password_hash(VALID_TEST_PASSWORD),
            full_name="Roll Viewer",
            role="user",
            store_id=test_store.id,
            is_active=True,
            must_change_password=False,
        )
        db_session.add(user)
        await db_session.flush()
        profile = AccessProfile(name="Só Ver Estoque", is_active=True)
        db_session.add(profile)
        await db_session.flush()
        db_session.add(
            AccessProfileModulePermission(
                profile_id=profile.id,
                module_group="OPERACIONAL",
                sub_module="inventory",
                can_view=True,
                can_edit=False,
                can_delete=False,
            )
        )
        await db_session.execute(
            access_profile_users.insert().values(profile_id=profile.id, user_id=user.id)
        )
        await db_session.commit()

        login = await client.post(
            "/api/v1/auth/login",
            data={"username": "rollviewer@test.com", "password": VALID_TEST_PASSWORD},
        )
        client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"
        resp = await client.patch(f"/api/v1/inventory/rolls/{roll_id}", json={"nfe_number": "999"})
        assert resp.status_code == 403
