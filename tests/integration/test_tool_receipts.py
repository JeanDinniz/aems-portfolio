"""Integração: cards de recebimento de ferramentas (Controle de EPIs).

Fluxo: ferramenta do pedido vinculada a um funcionário → card pendente; o
funcionário logado (Employee.user_id) vê só os seus e confirma com assinatura
+ 1 foto por item → card recebido; 2ª confirmação = 409; confirmar card de
outro sem permissão = 403; faltar foto de algum item ou mandar item_id fora
do card = 422.
"""

import pytest
from httpx import AsyncClient

from app.core.security import get_password_hash
from app.modules.access_profiles.models import (
    AccessProfile,
    AccessProfileModulePermission,
    access_profile_users,
)
from app.modules.auth.models import User
from app.modules.employees.models import Employee
from tests.conftest import VALID_TEST_PASSWORD

SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42m  "
PHOTO_URL = "https://cdn.test/uploads/foto-ferramenta.jpg"
PHOTO_URL_2 = "https://cdn.test/uploads/foto-ferramenta-2.jpg"


async def _add_employee(db, store_id, name, user_id=None) -> Employee:
    emp = Employee(name=name, store_id=store_id, is_active=True, user_id=user_id)
    db.add(emp)
    await db.flush()
    return emp


async def _employee_user(db, store, email) -> tuple[User, Employee]:
    user = User(
        email=email,
        hashed_password=get_password_hash(VALID_TEST_PASSWORD),
        full_name="Func Logado",
        role="user",
        store_id=store.id,
        is_active=True,
        must_change_password=False,
    )
    db.add(user)
    await db.flush()
    # Perfil mínimo (só time_clock) — necessário para o login funcionar, mas SEM
    # material_requests/epi, então o usuário fica em modo self-service.
    profile = AccessProfile(name=f"Func {email}", is_active=True)
    db.add(profile)
    await db.flush()
    db.add(
        AccessProfileModulePermission(
            profile_id=profile.id,
            module_group="OPERACIONAL",
            sub_module="time_clock",
            can_view=True,
            can_edit=False,
            can_delete=False,
        )
    )
    await db.execute(access_profile_users.insert().values(profile_id=profile.id, user_id=user.id))
    emp = await _add_employee(db, store.id, "Func Logado", user_id=user.id)
    await db.commit()
    return user, emp


async def _login(client: AsyncClient, email: str) -> None:
    r = await client.post(
        "/api/v1/auth/login",
        data={"username": email, "password": VALID_TEST_PASSWORD},
    )
    assert r.status_code == 200, r.text
    client.headers["Authorization"] = f"Bearer {r.json()['access_token']}"


async def _pedido_with_tools(
    owner_client: AsyncClient, store_id: int, tool_lines: list[dict]
) -> tuple[int, list[int]]:
    """Cria pedido com as ``tool_lines`` dadas. Retorna (request_id, [item_ids])
    na mesma ordem das linhas enviadas.

    ``nfe_number``/``cost`` são obrigatórios em MaterialRequestToolCreate — aqui
    entram com um valor padrão quando a linha não os informa, para não obrigar
    cada teste (focado em recebimento/cards) a repeti-los.
    """
    lines = [{"nfe_number": "NF-TESTE", "cost": "10.00", **line} for line in tool_lines]
    r = await owner_client.post(
        "/api/v1/material-requests",
        json={
            "store_id": store_id,
            "request_date": "2026-08-14",
            "tool_lines": lines,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    return body["id"], [t["id"] for t in body["tool_items"]]


async def _pedido_with_tool(
    owner_client: AsyncClient, store_id: int, employee_id: int
) -> tuple[int, int]:
    """Pedido com 1 ferramenta destinada a 1 funcionário. Retorna (request_id, item_id)."""
    req_id, item_ids = await _pedido_with_tools(
        owner_client, store_id, [{"name": "Espátula", "quantity": 2, "employee_id": employee_id}]
    )
    return req_id, item_ids[0]


class TestToolCards:
    @pytest.mark.asyncio
    async def test_linked_tool_creates_pending_card(
        self, owner_client: AsyncClient, db_session, test_store, test_employee
    ):
        req_id, item_id = await _pedido_with_tool(owner_client, test_store.id, test_employee.id)
        resp = await owner_client.get("/api/v1/material-requests/tool-cards")
        assert resp.status_code == 200, resp.text
        card = next(c for c in resp.json()["items"] if c["request_id"] == req_id)
        assert card["employee_id"] == test_employee.id
        assert card["status"] == "pendente"
        assert card["items"][0]["id"] == item_id
        assert card["items"][0]["name"] == "Espátula"
        assert card["items"][0]["quantity"] == 2
        assert card["items"][0]["photo_url"] is None
        assert card["signature_base64"] is None

    @pytest.mark.asyncio
    async def test_self_service_scope_and_confirm(
        self, client: AsyncClient, owner_client: AsyncClient, db_session, test_store
    ):
        _user, emp = await _employee_user(db_session, test_store, "func@test.com")
        other = await _add_employee(db_session, test_store.id, "Outro")
        await db_session.commit()

        req_id, item_id = await _pedido_with_tool(owner_client, test_store.id, emp.id)
        await _pedido_with_tool(owner_client, test_store.id, other.id)

        # Funcionário logado vê só o próprio card
        await _login(client, "func@test.com")
        resp = await client.get("/api/v1/material-requests/tool-cards")
        assert resp.status_code == 200, resp.text
        cards = resp.json()["items"]
        assert len(cards) == 1
        assert cards[0]["request_id"] == req_id
        assert cards[0]["status"] == "pendente"

        # Confirma com assinatura + 1 foto para o único item do card
        conf = await client.post(
            "/api/v1/material-requests/tool-cards/confirm",
            json={
                "request_id": req_id,
                "employee_id": emp.id,
                "signature_base64": SIGNATURE,
                "item_photos": [{"item_id": item_id, "photo_url": PHOTO_URL}],
            },
        )
        assert conf.status_code == 201, conf.text

        resp2 = await client.get("/api/v1/material-requests/tool-cards")
        card2 = resp2.json()["items"][0]
        assert card2["status"] == "recebido"
        assert card2["received_at"] is not None
        assert card2["signature_base64"] == SIGNATURE
        assert card2["items"][0]["photo_url"] == PHOTO_URL

        # Segunda confirmação → 409
        dup = await client.post(
            "/api/v1/material-requests/tool-cards/confirm",
            json={
                "request_id": req_id,
                "employee_id": emp.id,
                "signature_base64": SIGNATURE,
                "item_photos": [{"item_id": item_id, "photo_url": PHOTO_URL}],
            },
        )
        assert dup.status_code == 409

    @pytest.mark.asyncio
    async def test_confirm_forbidden_for_other_employee(
        self, client: AsyncClient, owner_client: AsyncClient, db_session, test_store
    ):
        _user, _emp = await _employee_user(db_session, test_store, "func2@test.com")
        other = await _add_employee(db_session, test_store.id, "Alheio")
        await db_session.commit()
        req_other, item_other = await _pedido_with_tool(owner_client, test_store.id, other.id)

        await _login(client, "func2@test.com")
        # Tentar confirmar card de outro funcionário, sem permissão → 403
        resp = await client.post(
            "/api/v1/material-requests/tool-cards/confirm",
            json={
                "request_id": req_other,
                "employee_id": other.id,
                "signature_base64": SIGNATURE,
                "item_photos": [{"item_id": item_other, "photo_url": PHOTO_URL}],
            },
        )
        assert resp.status_code == 403


class TestToolReceiptPhotos:
    """Foto obrigatória por item no recebimento (Fase A)."""

    @pytest.mark.asyncio
    async def test_confirm_with_one_photo_per_item_persists_and_lists(
        self, owner_client: AsyncClient, db_session, test_store, test_employee
    ):
        req_id, item_ids = await _pedido_with_tools(
            owner_client,
            test_store.id,
            [
                {"name": "Espátula", "quantity": 1, "employee_id": test_employee.id},
                {"name": "Chave de Fenda", "quantity": 1, "employee_id": test_employee.id},
            ],
        )
        assert len(item_ids) == 2

        conf = await owner_client.post(
            "/api/v1/material-requests/tool-cards/confirm",
            json={
                "request_id": req_id,
                "employee_id": test_employee.id,
                "signature_base64": SIGNATURE,
                "item_photos": [
                    {"item_id": item_ids[0], "photo_url": PHOTO_URL},
                    {"item_id": item_ids[1], "photo_url": PHOTO_URL_2},
                ],
            },
        )
        assert conf.status_code == 201, conf.text

        resp = await owner_client.get("/api/v1/material-requests/tool-cards")
        card = next(c for c in resp.json()["items"] if c["request_id"] == req_id)
        assert card["status"] == "recebido"
        assert card["signature_base64"] == SIGNATURE
        photos_by_item = {i["id"]: i["photo_url"] for i in card["items"]}
        assert photos_by_item[item_ids[0]] == PHOTO_URL
        assert photos_by_item[item_ids[1]] == PHOTO_URL_2

    @pytest.mark.asyncio
    async def test_confirm_missing_photo_for_one_item_rejected(
        self, owner_client: AsyncClient, db_session, test_store, test_employee
    ):
        req_id, item_ids = await _pedido_with_tools(
            owner_client,
            test_store.id,
            [
                {"name": "Espátula", "quantity": 1, "employee_id": test_employee.id},
                {"name": "Chave de Fenda", "quantity": 1, "employee_id": test_employee.id},
            ],
        )

        resp = await owner_client.post(
            "/api/v1/material-requests/tool-cards/confirm",
            json={
                "request_id": req_id,
                "employee_id": test_employee.id,
                "signature_base64": SIGNATURE,
                "item_photos": [{"item_id": item_ids[0], "photo_url": PHOTO_URL}],
            },
        )
        assert resp.status_code == 422, resp.text

    @pytest.mark.asyncio
    async def test_confirm_item_id_outside_card_rejected(
        self, owner_client: AsyncClient, db_session, test_store, test_employee
    ):
        req_id, item_id = await _pedido_with_tool(owner_client, test_store.id, test_employee.id)
        _other_req_id, other_item_id = await _pedido_with_tool(
            owner_client, test_store.id, test_employee.id
        )

        resp = await owner_client.post(
            "/api/v1/material-requests/tool-cards/confirm",
            json={
                "request_id": req_id,
                "employee_id": test_employee.id,
                "signature_base64": SIGNATURE,
                "item_photos": [{"item_id": other_item_id, "photo_url": PHOTO_URL}],
            },
        )
        assert resp.status_code == 422, resp.text
