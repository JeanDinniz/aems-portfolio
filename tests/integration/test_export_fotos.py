"""
Integration tests for the conference photos export endpoint
(`GET /service-orders/export/fotos`), which returns a ZIP with the photos of
the filtered service orders — one folder per O.S. named by the dealership O.S.
number (`external_os_number`).
"""

import io
import json
import zipfile
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.brands.models import Brand
from app.modules.service_orders.models import ServiceOrder
from app.modules.stores.models import Store

FAKE_JPEG = b"\xff\xd8\xff\xe0FAKEJPEGDATA"


@pytest.fixture(autouse=True)
def _patch_media_reader(monkeypatch):
    """
    Faz read_media_bytes devolver um JPEG fake para qualquer URL, tornando o
    teste independente do storage (MinIO local vs filesystem no CI).
    """
    monkeypatch.setattr(
        "app.modules.upload.router.read_media_bytes",
        lambda url, s3_client=None: FAKE_JPEG,
    )


@pytest.fixture
async def store_b(db_session: AsyncSession, test_brand: Brand) -> Store:
    store = Store(
        name="Loja Teste 02",
        code="LJ02",
        address="Rua Teste, 456",
        phone="11888888888",
        is_active=True,
        brand_id=test_brand.id,
    )
    db_session.add(store)
    await db_session.commit()
    await db_session.refresh(store)
    return store


@pytest.fixture
async def order_a(db_session: AsyncSession, test_store: Store) -> ServiceOrder:
    """O.S. na loja A com as três categorias de foto."""
    order = ServiceOrder(
        store_id=test_store.id,
        external_os_number="OS-A-100",
        vehicle_plate="ABC1D23",
        department="film",
        status="completed",
        entry_time=datetime.now(UTC),
        service_date=datetime.now(UTC).date(),
        photos=json.dumps(["https://s/photos/a1.jpg", "https://s/photos/a2.png"]),
        damage_photos=json.dumps(["https://s/photos/a_dmg.jpg"]),
        completion_photos=json.dumps(["https://s/photos/a_done.jpg"]),
        is_verified=True,
    )
    db_session.add(order)
    await db_session.commit()
    await db_session.refresh(order)
    return order


@pytest.fixture
async def order_b(db_session: AsyncSession, store_b: Store) -> ServiceOrder:
    """O.S. na loja B com uma foto principal."""
    order = ServiceOrder(
        store_id=store_b.id,
        external_os_number="OS-B-200",
        vehicle_plate="XYZ9W87",
        department="film",
        status="completed",
        entry_time=datetime.now(UTC),
        service_date=datetime.now(UTC).date(),
        photos=json.dumps(["https://s/photos/b1.jpg"]),
        is_verified=True,
    )
    db_session.add(order)
    await db_session.commit()
    await db_session.refresh(order)
    return order


def _open_zip(response) -> zipfile.ZipFile:
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    return zipfile.ZipFile(io.BytesIO(response.content))


class TestExportFotos:
    @pytest.mark.asyncio
    async def test_zip_groups_by_external_os_number_with_prefixes(
        self,
        owner_client: AsyncClient,
        order_a: ServiceOrder,
    ):
        """ZIP com pasta pelo nº da concessionária e prefixos foto_/avaria_/chancela_."""
        response = await owner_client.get("/api/v1/service-orders/export/fotos")
        zf = _open_zip(response)
        names = set(zf.namelist())

        assert "OS-A-100/foto_1.jpg" in names
        assert "OS-A-100/foto_2.png" in names  # extensão original preservada
        assert "OS-A-100/avaria_1.jpg" in names
        assert "OS-A-100/chancela_1.jpg" in names
        # Bytes reais gravados
        assert zf.read("OS-A-100/foto_1.jpg") == FAKE_JPEG

    @pytest.mark.asyncio
    async def test_respects_store_filter(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        order_a: ServiceOrder,
        order_b: ServiceOrder,
    ):
        """Filtrar por loja A traz só as fotos da O.S. da loja A."""
        response = await owner_client.get(
            f"/api/v1/service-orders/export/fotos?store_ids={test_store.id}"
        )
        zf = _open_zip(response)
        folders = {name.split("/", 1)[0] for name in zf.namelist()}

        assert "OS-A-100" in folders
        assert "OS-B-200" not in folders

    @pytest.mark.asyncio
    async def test_empty_result_returns_valid_empty_zip(
        self,
        owner_client: AsyncClient,
    ):
        """Sem O.S. no filtro, retorna um ZIP válido e vazio (não erro)."""
        response = await owner_client.get(
            "/api/v1/service-orders/export/fotos?date_from=2000-01-01&date_to=2000-01-02"
        )
        zf = _open_zip(response)
        assert zf.namelist() == []
