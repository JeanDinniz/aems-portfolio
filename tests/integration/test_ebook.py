"""
Testes de integração do módulo Biblioteca (documentos do e-book).

Cobre CRUD (owner), filtros/paginação, soft/hard delete e o gate de permissão do
submódulo "ebook".
"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash
from app.modules.access_profiles.models import (
    AccessProfile,
    AccessProfileModulePermission,
    access_profile_users,
)
from app.modules.auth.models import User

# Mesmo valor de tests/conftest.py::VALID_TEST_PASSWORD (satisfaz a força de senha).
VALID_TEST_PASSWORD = "TestPass123!@"

EBOOK_URL = "/api/v1/ebook"


def _doc_payload(title: str = "Manual de Operação", category: str = "operacional") -> dict:
    return {
        "category": category,
        "title": title,
        "description": "Procedimento padrão da loja.",
        "file_url": "http://localhost:8000/uploads/documents_abc.pdf",
        "file_name": "manual.pdf",
        "file_type": "pdf",
        "file_size": 12345,
    }


# ---------------------------------------------------------------------------
# Fixtures de permissão
# ---------------------------------------------------------------------------


@pytest.fixture
async def ebook_viewer(db_session: AsyncSession, test_store) -> User:
    """Usuário com perfil que concede apenas can_view no submódulo ebook."""
    user = User(
        email="ebookviewer@test.com",
        hashed_password=get_password_hash(VALID_TEST_PASSWORD),
        full_name="Ebook Viewer",
        role="user",
        store_id=test_store.id,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.flush()

    profile = AccessProfile(name="Ebook Viewer Profile", is_active=True)
    db_session.add(profile)
    await db_session.flush()

    db_session.add(
        AccessProfileModulePermission(
            profile_id=profile.id,
            module_group="ADM",
            sub_module="ebook",
            can_view=True,
            can_edit=False,
            can_delete=False,
        )
    )
    await db_session.flush()
    await db_session.execute(
        access_profile_users.insert().values(profile_id=profile.id, user_id=user.id)
    )
    await db_session.commit()
    return user


@pytest.fixture
async def ebook_viewer_client(client: AsyncClient, ebook_viewer: User) -> AsyncClient:
    resp = await client.post(
        "/api/v1/auth/login",
        data={"username": "ebookviewer@test.com", "password": VALID_TEST_PASSWORD},
    )
    token = resp.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"
    return client


# ---------------------------------------------------------------------------
# CRUD como Owner
# ---------------------------------------------------------------------------


async def test_owner_create_document(owner_client: AsyncClient):
    resp = await owner_client.post(EBOOK_URL, json=_doc_payload())
    assert resp.status_code == 201, resp.text
    data = resp.json()

    assert data["title"] == "Manual de Operação"
    assert data["category"] == "operacional"
    assert data["file_name"] == "manual.pdf"
    assert data["file_type"] == "pdf"
    assert data["is_active"] is True
    assert data["uploaded_by_name"]  # snapshot do autor


async def test_get_by_id(owner_client: AsyncClient):
    created = (await owner_client.post(EBOOK_URL, json=_doc_payload())).json()
    resp = await owner_client.get(f"{EBOOK_URL}/{created['id']}")
    assert resp.status_code == 200
    assert resp.json()["id"] == created["id"]


async def test_get_by_id_not_found(owner_client: AsyncClient):
    resp = await owner_client.get(f"{EBOOK_URL}/999999")
    assert resp.status_code == 404


async def test_update(owner_client: AsyncClient):
    created = (await owner_client.post(EBOOK_URL, json=_doc_payload())).json()
    resp = await owner_client.patch(
        f"{EBOOK_URL}/{created['id']}",
        json={"title": "Manual Revisado", "category": "apresentacoes"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["title"] == "Manual Revisado"
    assert data["category"] == "apresentacoes"


async def test_soft_then_hard_delete(owner_client: AsyncClient):
    created = (await owner_client.post(EBOOK_URL, json=_doc_payload())).json()
    doc_id = created["id"]

    soft = await owner_client.delete(f"{EBOOK_URL}/{doc_id}")
    assert soft.status_code == 200
    assert soft.json()["is_active"] is False

    # não aparece mais no filtro de ativos
    active = await owner_client.get(EBOOK_URL, params={"is_active": True})
    assert all(i["id"] != doc_id for i in active.json()["items"])

    hard = await owner_client.delete(f"{EBOOK_URL}/{doc_id}/permanent")
    assert hard.status_code == 200
    assert (await owner_client.get(f"{EBOOK_URL}/{doc_id}")).status_code == 404


# ---------------------------------------------------------------------------
# Filtros e paginação
# ---------------------------------------------------------------------------


async def test_filters_by_category_and_search(owner_client: AsyncClient):
    await owner_client.post(EBOOK_URL, json=_doc_payload("Checklist Diário", "operacional"))
    await owner_client.post(EBOOK_URL, json=_doc_payload("Pitch Comercial", "apresentacoes"))

    by_cat = await owner_client.get(EBOOK_URL, params={"category": "apresentacoes"})
    assert by_cat.status_code == 200
    items = by_cat.json()["items"]
    assert len(items) == 1 and items[0]["title"] == "Pitch Comercial"

    by_search = await owner_client.get(EBOOK_URL, params={"search": "checklist"})
    titles = [i["title"] for i in by_search.json()["items"]]
    assert "Checklist Diário" in titles


async def test_list_pagination_shape(owner_client: AsyncClient):
    await owner_client.post(EBOOK_URL, json=_doc_payload())
    resp = await owner_client.get(EBOOK_URL, params={"page": 1, "limit": 10})
    assert resp.status_code == 200
    body = resp.json()
    assert set(body["pagination"].keys()) == {
        "page",
        "limit",
        "total",
        "total_pages",
        "has_next",
        "has_prev",
    }


async def test_invalid_category_rejected(owner_client: AsyncClient):
    resp = await owner_client.post(EBOOK_URL, json=_doc_payload(category="inexistente"))
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Gate de permissão
# ---------------------------------------------------------------------------


async def test_unauthenticated_is_rejected(client: AsyncClient):
    assert (await client.get(EBOOK_URL)).status_code == 401


async def test_user_without_ebook_permission_forbidden(authenticated_client: AsyncClient):
    # authenticated_client tem apenas service_orders, não ebook
    assert (await authenticated_client.get(EBOOK_URL)).status_code == 403


async def test_viewer_can_read_but_not_edit(ebook_viewer_client: AsyncClient):
    # leitura permitida
    assert (await ebook_viewer_client.get(EBOOK_URL)).status_code == 200
    # escrita bloqueada (só can_view)
    resp = await ebook_viewer_client.post(EBOOK_URL, json=_doc_payload())
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_document_rejects_external_url(owner_client: AsyncClient):
    """🟠 (auditoria): file_url deve vir do upload interno; URL externa é rejeitada."""
    payload = _doc_payload()
    payload["file_url"] = "http://evil.com/malware.pdf"
    resp = await owner_client.post(EBOOK_URL, json=payload)
    assert resp.status_code in (400, 422)


@pytest.mark.asyncio
async def test_create_document_accepts_internal_url(owner_client: AsyncClient):
    """URL do upload do próprio sistema (/uploads/) é aceita."""
    resp = await owner_client.post(EBOOK_URL, json=_doc_payload())
    assert resp.status_code == 201
