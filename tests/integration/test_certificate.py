"""
Testes de integração do Certificado de Garantia (histórico + PDF, via e-book).

Fluxo novo: POST salva o certificado (histórico), GET lista, GET /{id}/pdf baixa
o PDF regerado, DELETE remove (somente Proprietário). Gate pelo submódulo "ebook".
"""

from httpx import AsyncClient

from app.core.security import get_password_hash
from app.modules.access_profiles.models import (
    AccessProfile,
    AccessProfileModulePermission,
    access_profile_stores,
    access_profile_users,
)
from app.modules.auth.models import User
from tests.conftest import VALID_TEST_PASSWORD

CERT_URL = "/api/v1/ebook/certificates"
BODY = {
    "brand_code": "toyota",
    "plate": "RIO2A34",
    "model": "Corolla XEI",
    "color": "Prata",
    "customer_name": "Fulano de Tal",
    "invoice_number": "015782",
    "chassi": "9BR12345678901234",
}


async def _make_ebook_viewer_in_store(db_session, store, email: str) -> None:
    """Cria um usuário com ebook:can_view vinculado a `store` (não faz login)."""
    user = User(
        email=email,
        hashed_password=get_password_hash(VALID_TEST_PASSWORD),
        full_name="Atacante Cert",
        role="user",
        store_id=store.id,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.flush()
    profile = AccessProfile(name=f"ebook viewer {email}", is_active=True)
    db_session.add(profile)
    await db_session.flush()
    db_session.add(
        AccessProfileModulePermission(
            profile_id=profile.id,
            module_group="OPERACIONAL",
            sub_module="ebook",
            can_view=True,
            can_edit=True,
            can_delete=False,
        )
    )
    await db_session.execute(
        access_profile_users.insert().values(profile_id=profile.id, user_id=user.id)
    )
    await db_session.execute(
        access_profile_stores.insert().values(profile_id=profile.id, store_id=store.id)
    )
    await db_session.commit()


class TestCertificateScope:
    """#10 — get/pdf/patch de certificado respeitam escopo de loja (IDOR fechado)."""

    async def test_get_e_pdf_de_outra_loja_bloqueados(
        self, owner_client: AsyncClient, db_session, test_store, second_store
    ):
        # Certificado atado à test_store (via owner)
        created = await owner_client.post(CERT_URL, json={**BODY, "store_id": test_store.id})
        assert created.status_code == 201, created.text
        cid = created.json()["id"]

        # Atacante: ebook:can_view, mas vinculado à second_store
        await _make_ebook_viewer_in_store(db_session, second_store, "cert_atacante@x.com")
        login = await owner_client.post(
            "/api/v1/auth/login",
            data={"username": "cert_atacante@x.com", "password": VALID_TEST_PASSWORD},
        )
        owner_client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"

        # require_resource_access levanta 404 (não vaza existência entre lojas)
        assert (await owner_client.get(f"{CERT_URL}/{cid}")).status_code == 404
        assert (await owner_client.get(f"{CERT_URL}/{cid}/pdf")).status_code == 404
        patch = await owner_client.patch(f"{CERT_URL}/{cid}", json={"color": "Preto"})
        assert patch.status_code == 404


async def test_owner_creates_and_downloads_certificate(owner_client: AsyncClient):
    # cria (salva no histórico) — não baixa nada aqui
    resp = await owner_client.post(CERT_URL, json=BODY)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["id"] > 0
    assert data["brand_code"] == "toyota"
    assert data["customer_name"] == "Fulano de Tal"
    assert data["created_by_name"]  # snapshot do autor
    assert data["issue_date"]

    # baixa o PDF do certificado salvo
    pdf = await owner_client.get(f"{CERT_URL}/{data['id']}/pdf")
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content[:4] == b"%PDF"
    assert "attachment" in pdf.headers.get("content-disposition", "")


async def test_list_certificates(owner_client: AsyncClient):
    await owner_client.post(CERT_URL, json=BODY)
    resp = await owner_client.get(CERT_URL)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["pagination"]["total"] >= 1
    assert any(c["customer_name"] == "Fulano de Tal" for c in body["items"])


async def test_create_minimal_only_brand(owner_client: AsyncClient):
    # Só a marca; demais campos vazios -> salva mesmo assim
    resp = await owner_client.post(CERT_URL, json={"brand_code": "byd"})
    assert resp.status_code == 201, resp.text


async def test_brand_code_required(owner_client: AsyncClient):
    resp = await owner_client.post(CERT_URL, json={"plate": "ABC1D23"})
    assert resp.status_code == 422


async def test_requires_auth(client: AsyncClient):
    assert (await client.post(CERT_URL, json=BODY)).status_code == 401


async def test_requires_ebook_permission(authenticated_client: AsyncClient):
    # authenticated_client tem service_orders, não ebook -> 403
    assert (await authenticated_client.post(CERT_URL, json=BODY)).status_code == 403


async def test_delete_by_owner(owner_client: AsyncClient):
    created = await owner_client.post(CERT_URL, json=BODY)
    assert created.status_code == 201, created.text
    cid = created.json()["id"]

    # Proprietário exclui; depois o PDF não é mais encontrado
    assert (await owner_client.delete(f"{CERT_URL}/{cid}")).status_code == 200
    assert (await owner_client.get(f"{CERT_URL}/{cid}/pdf")).status_code == 404


async def test_delete_forbidden_for_non_owner(authenticated_client: AsyncClient):
    # require_roles(OWNER) bloqueia antes mesmo de checar a existência
    assert (await authenticated_client.delete(f"{CERT_URL}/999999")).status_code == 403


# ---------------------------------------------------------------------------
# HML-236: serviço/garantia editáveis, status, O.S. e edição
# ---------------------------------------------------------------------------


async def test_create_persists_service_and_warranty(owner_client: AsyncClient):
    """Regressão do bug: service_name/warranty_months eram ignorados no create."""
    body = {
        **BODY,
        "service_name": "Vitrificação de Vidros",
        "warranty_months": 24,
        "os_number": "OS-9931",
    }
    resp = await owner_client.post(CERT_URL, json=body)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["service_name"] == "Vitrificação de Vidros"
    assert data["warranty_months"] == 24
    assert data["os_number"] == "OS-9931"
    # emitido hoje com 24 meses -> vigente
    assert data["warranty_status"] == "vigente"


async def test_warranty_status_vencida(owner_client: AsyncClient):
    body = {**BODY, "issue_date": "2020-01-01", "warranty_months": 12}
    resp = await owner_client.post(CERT_URL, json=body)
    assert resp.status_code == 201, resp.text
    assert resp.json()["warranty_status"] == "vencida"


async def test_get_certificate_detail(owner_client: AsyncClient):
    created = (await owner_client.post(CERT_URL, json=BODY)).json()
    resp = await owner_client.get(f"{CERT_URL}/{created['id']}")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["id"] == created["id"]
    assert "warranty_status" in data
    assert "valid_until" in data


async def test_update_certificate_by_owner(owner_client: AsyncClient):
    created = (await owner_client.post(CERT_URL, json=BODY)).json()
    resp = await owner_client.patch(
        f"{CERT_URL}/{created['id']}",
        json={"customer_name": "Cliente Editado", "warranty_months": 36},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["customer_name"] == "Cliente Editado"
    assert data["warranty_months"] == 36


async def test_update_forbidden_without_edit(authenticated_client: AsyncClient):
    # authenticated_client tem service_orders, não ebook -> 403
    assert (
        await authenticated_client.patch(f"{CERT_URL}/999999", json={"customer_name": "x"})
    ).status_code == 403


async def test_signed_photo_url_roundtrips(owner_client: AsyncClient):
    body = {**BODY, "signed_photo_url": "http://localhost:8000/uploads/photos_signed.jpg"}
    resp = await owner_client.post(CERT_URL, json=body)
    assert resp.status_code == 201, resp.text
    assert resp.json()["signed_photo_url"] == "http://localhost:8000/uploads/photos_signed.jpg"


async def test_search_by_os_number(owner_client: AsyncClient):
    await owner_client.post(CERT_URL, json={**BODY, "os_number": "OS-77123"})
    resp = await owner_client.get(CERT_URL, params={"search": "77123"})
    assert resp.status_code == 200, resp.text
    assert any(c["os_number"] == "OS-77123" for c in resp.json()["items"])


async def test_create_certificate_rejects_external_signed_photo(owner_client: AsyncClient):
    """🟠 (auditoria): signed_photo_url deve vir do upload interno; URL externa rejeitada."""
    resp = await owner_client.post(
        CERT_URL, json={**BODY, "signed_photo_url": "http://evil.com/steal.jpg"}
    )
    assert resp.status_code in (400, 422)
