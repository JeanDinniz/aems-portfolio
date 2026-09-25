"""Integração: persistência de video_url na O.S. (create e update)."""

from datetime import UTC, datetime

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.brands.models import Brand
from app.modules.dealerships.models import Dealership
from app.modules.services.models import Service
from app.modules.stores.models import Store


@pytest_asyncio.fixture
async def _video_dealership(db_session: AsyncSession, test_store: Store) -> Dealership:
    dealership = Dealership(
        name="Toyota Video Test",
        store_id=test_store.id,
        brand="Toyota",
        address="Av. Teste, 1",
        is_active=True,
    )
    db_session.add(dealership)
    await db_session.commit()
    await db_session.refresh(dealership)
    return dealership


@pytest_asyncio.fixture
async def _video_service(db_session: AsyncSession, test_brand: Brand) -> Service:
    service = Service(
        name="Película Teste Video",
        department="film",
        description="Serviço para testes de video_url",
        base_price=100.00,
        is_active=True,
        brand_id=test_brand.id,
    )
    db_session.add(service)
    await db_session.commit()
    await db_session.refresh(service)
    return service


@pytest_asyncio.fixture
async def service_order_create_payload(
    test_store: Store,
    _video_dealership: Dealership,
    _video_service: Service,
) -> dict:
    """Payload mínimo válido para criar uma O.S. de película."""
    return {
        "store_id": test_store.id,
        "dealership_id": _video_dealership.id,
        "vehicle_plate": "VID1A23",
        "vehicle_brand": "Toyota",
        "vehicle_model": "Corolla",
        "vehicle_color": "Branco",
        "vehicle_year": 2023,
        "department": "film",
        "entry_time": datetime.now(UTC).isoformat(),
        "photos": ["http://localhost:8000/uploads/vid1.jpg"],
        "items": [{"service_id": _video_service.id, "quantity": 1}],
    }


@pytest.mark.asyncio
async def test_create_service_order_persists_video_url(
    authenticated_client: AsyncClient, service_order_create_payload: dict
):
    payload = {
        **service_order_create_payload,
        "video_url": "http://minio/aems-files/videos/abc.mp4",
    }
    resp = await authenticated_client.post("/api/v1/service-orders", json=payload)
    assert resp.status_code == 201, resp.text
    assert resp.json()["video_url"] == "http://minio/aems-files/videos/abc.mp4"


@pytest.mark.asyncio
async def test_create_service_order_without_video_url_is_null(
    authenticated_client: AsyncClient, service_order_create_payload: dict
):
    resp = await authenticated_client.post(
        "/api/v1/service-orders", json=service_order_create_payload
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["video_url"] is None


@pytest.mark.asyncio
async def test_update_can_set_and_remove_video_url(
    authenticated_client: AsyncClient, service_order_create_payload: dict
):
    created = await authenticated_client.post(
        "/api/v1/service-orders", json=service_order_create_payload
    )
    os_id = created.json()["id"]

    # set
    r1 = await authenticated_client.patch(
        f"/api/v1/service-orders/{os_id}",
        json={"video_url": "http://minio/aems-files/videos/x.mp4"},
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["video_url"] == "http://minio/aems-files/videos/x.mp4"

    # remove (envia null explícito)
    r2 = await authenticated_client.patch(
        f"/api/v1/service-orders/{os_id}", json={"video_url": None}
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["video_url"] is None
