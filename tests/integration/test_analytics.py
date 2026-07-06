"""
Integration tests for analytics endpoints.
Tests the overview endpoint with filters and data aggregation.
"""

from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem
from app.modules.services.models import Service
from app.modules.stores.models import Store

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
async def test_service(db_session: AsyncSession, test_brand) -> Service:
    """Create a test service for order items."""
    svc = Service(
        name="Película fumê",
        department="film",
        base_price=500.00,
        is_active=True,
        brand_id=test_brand.id,
    )
    db_session.add(svc)
    await db_session.commit()
    await db_session.refresh(svc)
    return svc


@pytest.fixture
async def service_orders_with_items(
    db_session: AsyncSession,
    test_store: Store,
    test_user: User,
    test_service: Service,
) -> list[ServiceOrder]:
    """Create service orders with items for analytics testing."""
    orders = []

    # Order 1: completed, Jan 2026
    so1 = ServiceOrder(
        store_id=test_store.id,
        vehicle_plate="ABC1D23",
        department="film",
        status="completed",
        entry_time=datetime(2026, 1, 15, 10, 0, tzinfo=UTC),
        created_by_id=test_user.id,
    )
    db_session.add(so1)
    await db_session.flush()

    item1 = ServiceOrderItem(
        service_order_id=so1.id,
        service_id=test_service.id,
        unit_price=500.00,
        quantity=1,
    )
    db_session.add(item1)
    orders.append(so1)

    # Order 2: waiting, Feb 2026
    so2 = ServiceOrder(
        store_id=test_store.id,
        vehicle_plate="XYZ9W87",
        department="aesthetics",
        status="waiting",
        entry_time=datetime(2026, 2, 10, 9, 0, tzinfo=UTC),
        created_by_id=test_user.id,
    )
    db_session.add(so2)
    await db_session.flush()

    item2 = ServiceOrderItem(
        service_order_id=so2.id,
        service_id=test_service.id,
        unit_price=300.00,
        quantity=2,
    )
    db_session.add(item2)
    orders.append(so2)

    # Order 3: completed, Jan 2026
    so3 = ServiceOrder(
        store_id=test_store.id,
        vehicle_plate="DEF5G67",
        department="film",
        status="completed",
        entry_time=datetime(2026, 1, 20, 11, 0, tzinfo=UTC),
        created_by_id=test_user.id,
    )
    db_session.add(so3)
    await db_session.flush()

    item3 = ServiceOrderItem(
        service_order_id=so3.id,
        service_id=test_service.id,
        unit_price=800.00,
        quantity=1,
    )
    db_session.add(item3)
    orders.append(so3)

    await db_session.commit()
    for o in orders:
        await db_session.refresh(o)
    return orders


@pytest.fixture
async def second_store_order(
    db_session: AsyncSession,
    second_store: Store,
    test_user: User,
    test_service: Service,
) -> ServiceOrder:
    """Create a service order in the second store."""
    so = ServiceOrder(
        store_id=second_store.id,
        vehicle_plate="OTH1R99",
        department="film",
        status="completed",
        entry_time=datetime(2026, 1, 25, 8, 0, tzinfo=UTC),
        created_by_id=test_user.id,
    )
    db_session.add(so)
    await db_session.flush()

    item = ServiceOrderItem(
        service_order_id=so.id,
        service_id=test_service.id,
        unit_price=450.00,
        quantity=1,
    )
    db_session.add(item)
    await db_session.commit()
    await db_session.refresh(so)
    return so


# ===========================================================================
# Tests
# ===========================================================================


class TestAnalyticsOverview:
    """Tests for GET /api/v1/analytics/overview."""

    @pytest.mark.asyncio
    async def test_overview_empty(self, authenticated_client: AsyncClient):
        response = await authenticated_client.get("/api/v1/analytics/overview")
        assert response.status_code == 200
        data = response.json()
        assert data["total_orders"] == 0
        assert data["completed_orders"] == 0
        assert data["revenue"] == 0
        assert data["avg_ticket"] == 0.0
        assert data["orders_by_month"] == []
        assert data["orders_by_status"] == {}
        assert data["orders_by_store"] == []

    @pytest.mark.asyncio
    async def test_overview_with_data(
        self,
        authenticated_client: AsyncClient,
        service_orders_with_items: list[ServiceOrder],
    ):
        response = await authenticated_client.get("/api/v1/analytics/overview")
        assert response.status_code == 200
        data = response.json()
        assert data["total_orders"] == 3
        assert data["completed_orders"] == 2  # 2 completed
        # Revenue: 500 + (300*2) + 800 = 1900
        assert data["revenue"] == 1900.0
        assert data["avg_ticket"] == round(1900.0 / 3, 2)

    @pytest.mark.asyncio
    async def test_overview_orders_by_status(
        self,
        authenticated_client: AsyncClient,
        service_orders_with_items: list[ServiceOrder],
    ):
        response = await authenticated_client.get("/api/v1/analytics/overview")
        data = response.json()
        assert data["orders_by_status"]["completed"] == 2
        assert data["orders_by_status"]["waiting"] == 1

    @pytest.mark.asyncio
    async def test_overview_orders_by_store(
        self,
        owner_client: AsyncClient,
        service_orders_with_items: list[ServiceOrder],
        second_store_order: ServiceOrder,
    ):
        # Owner can see all stores
        response = await owner_client.get("/api/v1/analytics/overview")
        data = response.json()
        assert len(data["orders_by_store"]) == 2
        store_counts = {s["store_id"]: s["count"] for s in data["orders_by_store"]}
        assert store_counts[service_orders_with_items[0].store_id] == 3
        assert store_counts[second_store_order.store_id] == 1

    @pytest.mark.asyncio
    async def test_overview_filter_by_store(
        self,
        owner_client: AsyncClient,
        service_orders_with_items: list[ServiceOrder],
        second_store_order: ServiceOrder,
    ):
        # Owner can filter by any store
        store_id = second_store_order.store_id
        response = await owner_client.get(
            f"/api/v1/analytics/overview?store_id={store_id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total_orders"] == 1
        assert data["revenue"] == 450.0

    @pytest.mark.asyncio
    async def test_overview_filter_by_date_range(
        self,
        authenticated_client: AsyncClient,
        service_orders_with_items: list[ServiceOrder],
    ):
        response = await authenticated_client.get(
            "/api/v1/analytics/overview"
            "?start_date=2026-02-01T00:00:00Z"
            "&end_date=2026-02-28T23:59:59Z"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total_orders"] == 1
        assert data["completed_orders"] == 0

    @pytest.mark.asyncio
    async def test_overview_filter_by_start_date_only(
        self,
        authenticated_client: AsyncClient,
        service_orders_with_items: list[ServiceOrder],
    ):
        response = await authenticated_client.get(
            "/api/v1/analytics/overview?start_date=2026-02-01T00:00:00Z"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total_orders"] == 1

    @pytest.mark.asyncio
    async def test_overview_filter_by_end_date_only(
        self,
        authenticated_client: AsyncClient,
        service_orders_with_items: list[ServiceOrder],
    ):
        response = await authenticated_client.get(
            "/api/v1/analytics/overview?end_date=2026-01-31T23:59:59Z"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total_orders"] == 2

    @pytest.mark.asyncio
    async def test_overview_orders_by_month(
        self,
        authenticated_client: AsyncClient,
        service_orders_with_items: list[ServiceOrder],
    ):
        response = await authenticated_client.get("/api/v1/analytics/overview")
        data = response.json()
        months = data["orders_by_month"]
        assert len(months) >= 1

    @pytest.mark.asyncio
    async def test_overview_unauthenticated(self, client: AsyncClient):
        response = await client.get("/api/v1/analytics/overview")
        assert response.status_code == 401
