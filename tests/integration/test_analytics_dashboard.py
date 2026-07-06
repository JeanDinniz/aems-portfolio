"""
Integration tests for Dashboard Executivo endpoints.

Tests:
1. 200 OK as Owner for each of the 9 new endpoints
2. 403 Forbidden for non-owner users
3. delta_pct calculated correctly, including None when previous == 0
4. pct_courtesy/galpon/return calculated correctly
5. overdue counts correctly (in_progress AND start_time > 3h ago)
"""

from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.consultants.models import Consultant
from app.modules.dealerships.models import Dealership
from app.modules.employees.models import Employee
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem, ServiceOrderWorker
from app.modules.services.models import Service
from app.modules.stores.models import Store

# ---------------------------------------------------------------------------
# Shared date range (used in most tests)
# ---------------------------------------------------------------------------
START = "2026-01-01T00:00:00Z"
END = "2026-01-31T23:59:59Z"

PARAMS = f"start_date={START}&end_date={END}"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
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


@pytest_asyncio.fixture
async def test_dealership(db_session: AsyncSession, test_store: Store) -> Dealership:
    """Create a test dealership."""
    dealership = Dealership(
        name="Concessionária Toyota Teste",
        store_id=test_store.id,
        brand="Toyota",
        is_active=True,
    )
    db_session.add(dealership)
    await db_session.commit()
    await db_session.refresh(dealership)
    return dealership


@pytest_asyncio.fixture
async def test_consultant(
    db_session: AsyncSession, test_store: Store, test_dealership: Dealership
) -> Consultant:
    """Create a test consultant."""
    consultant = Consultant(
        name="Consultor Teste",
        store_id=test_store.id,
        dealership_id=test_dealership.id,
        is_active=True,
    )
    db_session.add(consultant)
    await db_session.commit()
    await db_session.refresh(consultant)
    return consultant


@pytest_asyncio.fixture
async def test_employee(db_session: AsyncSession, test_store: Store) -> Employee:
    """Create a test employee."""
    employee = Employee(
        name="Funcionário Teste",
        store_id=test_store.id,
        department="film",
        is_active=True,
    )
    db_session.add(employee)
    await db_session.commit()
    await db_session.refresh(employee)
    return employee


@pytest_asyncio.fixture
async def dashboard_orders(
    db_session: AsyncSession,
    test_store: Store,
    test_user: User,
    test_service: Service,
    test_consultant: Consultant,
    test_employee: Employee,
) -> list[ServiceOrder]:
    """
    Create a set of O.S. for dashboard testing in January 2026:
    - so1: regular, completed, film, R$ 500
    - so2: courtesy, completed, film, R$ 300
    - so3: galpon, in_progress, bodywork
    - so4: return, waiting, film, R$ 200
    """
    orders: list[ServiceOrder] = []

    # so1 — regular, completed
    so1 = ServiceOrder(
        store_id=test_store.id,
        vehicle_plate="ABC1D23",
        department="film",
        status="completed",
        is_courtesy=False,
        is_galpon=False,
        is_return=False,
        entry_time=datetime(2026, 1, 10, 8, 0, tzinfo=UTC),
        start_time=datetime(2026, 1, 10, 8, 30, tzinfo=UTC),
        completion_time=datetime(2026, 1, 10, 10, 0, tzinfo=UTC),
        verified_at=datetime(2026, 1, 10, 10, 15, tzinfo=UTC),
        consultant_id=test_consultant.id,
        created_by_id=test_user.id,
    )
    db_session.add(so1)
    await db_session.flush()
    db_session.add(
        ServiceOrderItem(
            service_order_id=so1.id,
            service_id=test_service.id,
            unit_price=500.00,
            quantity=1,
        )
    )
    db_session.add(
        ServiceOrderWorker(
            service_order_id=so1.id,
            employee_id=test_employee.id,
            hours_worked=1.5,
        )
    )
    orders.append(so1)

    # so2 — courtesy, completed (revenue should be excluded)
    so2 = ServiceOrder(
        store_id=test_store.id,
        vehicle_plate="XYZ9W87",
        department="film",
        status="completed",
        is_courtesy=True,
        is_galpon=False,
        is_return=False,
        entry_time=datetime(2026, 1, 15, 9, 0, tzinfo=UTC),
        start_time=datetime(2026, 1, 15, 9, 20, tzinfo=UTC),
        completion_time=datetime(2026, 1, 15, 11, 0, tzinfo=UTC),
        created_by_id=test_user.id,
    )
    db_session.add(so2)
    await db_session.flush()
    db_session.add(
        ServiceOrderItem(
            service_order_id=so2.id,
            service_id=test_service.id,
            unit_price=300.00,
            quantity=1,
        )
    )
    orders.append(so2)

    # so3 — galpon, in_progress
    so3 = ServiceOrder(
        store_id=test_store.id,
        vehicle_plate="DEF5G67",
        department="bodywork",
        status="in_progress",
        is_courtesy=False,
        is_galpon=True,
        is_return=False,
        entry_time=datetime(2026, 1, 20, 7, 0, tzinfo=UTC),
        start_time=datetime(2026, 1, 20, 7, 30, tzinfo=UTC),
        created_by_id=test_user.id,
    )
    db_session.add(so3)
    orders.append(so3)

    # so4 — return, waiting
    so4 = ServiceOrder(
        store_id=test_store.id,
        vehicle_plate="GHI3J45",
        department="film",
        status="waiting",
        is_courtesy=False,
        is_galpon=False,
        is_return=True,
        entry_time=datetime(2026, 1, 25, 10, 0, tzinfo=UTC),
        created_by_id=test_user.id,
    )
    db_session.add(so4)
    await db_session.flush()
    db_session.add(
        ServiceOrderItem(
            service_order_id=so4.id,
            service_id=test_service.id,
            unit_price=200.00,
            quantity=1,
        )
    )
    orders.append(so4)

    await db_session.commit()
    for o in orders:
        await db_session.refresh(o)
    return orders


@pytest_asyncio.fixture
async def overdue_order(
    db_session: AsyncSession,
    test_store: Store,
    test_user: User,
) -> ServiceOrder:
    """
    O.S. overdue: status=in_progress, start_time = 4h ago (> 3h threshold).
    """
    now = datetime.now(tz=UTC)
    so = ServiceOrder(
        store_id=test_store.id,
        vehicle_plate="OVR1D01",
        department="film",
        status="in_progress",
        is_courtesy=False,
        is_galpon=False,
        is_return=False,
        entry_time=now - timedelta(hours=5),
        start_time=now - timedelta(hours=4),  # started 4h ago → overdue
        created_by_id=test_user.id,
    )
    db_session.add(so)
    await db_session.commit()
    await db_session.refresh(so)
    return so


@pytest_asyncio.fixture
async def recent_in_progress_order(
    db_session: AsyncSession,
    test_store: Store,
    test_user: User,
) -> ServiceOrder:
    """
    O.S. in_progress but NOT overdue: start_time = 1h ago (< 3h threshold).
    """
    now = datetime.now(tz=UTC)
    so = ServiceOrder(
        store_id=test_store.id,
        vehicle_plate="OKI1D02",
        department="film",
        status="in_progress",
        is_courtesy=False,
        is_galpon=False,
        is_return=False,
        entry_time=now - timedelta(hours=2),
        start_time=now - timedelta(hours=1),  # started 1h ago → not overdue
        created_by_id=test_user.id,
    )
    db_session.add(so)
    await db_session.commit()
    await db_session.refresh(so)
    return so


# ===========================================================================
# Tests — 403 for non-owner
# ===========================================================================


class TestDashboardForbiddenForUser:
    """All dashboard endpoints must return 403 for non-owner users."""

    @pytest.mark.asyncio
    async def test_overview_forbidden(self, authenticated_client: AsyncClient):
        response = await authenticated_client.get(f"/api/v1/analytics/dashboard/overview?{PARAMS}")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_stores_forbidden(self, authenticated_client: AsyncClient):
        response = await authenticated_client.get(f"/api/v1/analytics/dashboard/stores?{PARAMS}")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_services_forbidden(self, authenticated_client: AsyncClient):
        response = await authenticated_client.get(f"/api/v1/analytics/dashboard/services?{PARAMS}")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_departments_forbidden(self, authenticated_client: AsyncClient):
        response = await authenticated_client.get(
            f"/api/v1/analytics/dashboard/departments?{PARAMS}"
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_employees_forbidden(self, authenticated_client: AsyncClient):
        response = await authenticated_client.get(
            f"/api/v1/analytics/dashboard/employees?{PARAMS}"
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_consultants_forbidden(self, authenticated_client: AsyncClient):
        response = await authenticated_client.get(
            f"/api/v1/analytics/dashboard/consultants?{PARAMS}"
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_sla_forbidden(self, authenticated_client: AsyncClient):
        response = await authenticated_client.get(f"/api/v1/analytics/dashboard/sla?{PARAMS}")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_queue_forbidden(self, authenticated_client: AsyncClient):
        response = await authenticated_client.get("/api/v1/analytics/dashboard/queue")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_timeseries_forbidden(self, authenticated_client: AsyncClient):
        response = await authenticated_client.get(
            f"/api/v1/analytics/dashboard/timeseries?{PARAMS}"
        )
        assert response.status_code == 403


# ===========================================================================
# Tests — 200 OK for Owner (empty DB)
# ===========================================================================


class TestDashboardOwnerEmptyDB:
    """All endpoints return 200 for owner even with no data."""

    @pytest.mark.asyncio
    async def test_overview_ok(self, owner_client: AsyncClient):
        response = await owner_client.get(f"/api/v1/analytics/dashboard/overview?{PARAMS}")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_stores_ok(self, owner_client: AsyncClient, test_store: Store):
        response = await owner_client.get(f"/api/v1/analytics/dashboard/stores?{PARAMS}")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    @pytest.mark.asyncio
    async def test_services_ok(self, owner_client: AsyncClient):
        response = await owner_client.get(f"/api/v1/analytics/dashboard/services?{PARAMS}")
        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_departments_ok(self, owner_client: AsyncClient):
        response = await owner_client.get(f"/api/v1/analytics/dashboard/departments?{PARAMS}")
        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_employees_ok(self, owner_client: AsyncClient):
        response = await owner_client.get(f"/api/v1/analytics/dashboard/employees?{PARAMS}")
        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_consultants_ok(self, owner_client: AsyncClient):
        response = await owner_client.get(f"/api/v1/analytics/dashboard/consultants?{PARAMS}")
        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_sla_ok(self, owner_client: AsyncClient):
        response = await owner_client.get(f"/api/v1/analytics/dashboard/sla?{PARAMS}")
        assert response.status_code == 200
        data = response.json()
        assert data["avg_wait_minutes"] == 0.0
        assert data["avg_execution_minutes"] == 0.0

    @pytest.mark.asyncio
    async def test_queue_ok(self, owner_client: AsyncClient):
        response = await owner_client.get("/api/v1/analytics/dashboard/queue")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    @pytest.mark.asyncio
    async def test_timeseries_ok(self, owner_client: AsyncClient):
        response = await owner_client.get(f"/api/v1/analytics/dashboard/timeseries?{PARAMS}")
        assert response.status_code == 200
        assert response.json() == []


# ===========================================================================
# Tests — delta_pct calculation
# ===========================================================================


class TestDeltaPct:
    """Verify delta_pct logic including None when previous == 0."""

    @pytest.mark.asyncio
    async def test_delta_pct_none_when_previous_zero(self, owner_client: AsyncClient):
        """
        With no data in previous period, delta_pct must be None for all KPIs
        that had previous == 0.
        """
        # Jan 2026 period. Previous period = before Dec 2025 — no data there.
        response = await owner_client.get(f"/api/v1/analytics/dashboard/overview?{PARAMS}")
        assert response.status_code == 200
        data = response.json()

        # Empty DB: current = 0, previous = 0 → delta_pct = None
        assert data["revenue"]["delta_pct"] is None
        assert data["total_orders"]["delta_pct"] is None

    @pytest.mark.asyncio
    async def test_delta_pct_positive(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
    ):
        """
        Jan 2026 has 4 orders. Previous period has 0 orders.
        delta_pct for total_orders should be None (previous == 0).
        Revenue Jan = 700 (500 non-courtesy + 200 non-courtesy; so2 courtesy excluded).
        """
        response = await owner_client.get(f"/api/v1/analytics/dashboard/overview?{PARAMS}")
        assert response.status_code == 200
        data = response.json()

        # 4 orders in Jan 2026, 0 in previous period → delta_pct is None
        assert data["total_orders"]["current"] == 4
        assert data["total_orders"]["previous"] == 0
        assert data["total_orders"]["delta_pct"] is None

        # Revenue: only non-courtesy O.S.
        # so1=500, so4=200 → revenue=700 (so2 is courtesy → excluded)
        assert data["revenue"]["current"] == 700.0
        assert data["revenue"]["delta_pct"] is None  # previous == 0

    @pytest.mark.asyncio
    async def test_delta_pct_computes_correctly_when_prev_nonzero(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service: Service,
    ):
        """
        Set up orders in period and previous period, verify delta_pct math.
        Period: Feb 2026 (1 order, R$ 1000)
        Previous: Jan 2026 (1 order, R$ 500) — same duration
        Expected delta_pct for revenue = (1000 - 500) / 500 * 100 = 100.0
        """
        # Previous period (Jan 2026) order
        so_prev = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="PRV1A01",
            department="film",
            status="completed",
            is_courtesy=False,
            is_galpon=False,
            is_return=False,
            entry_time=datetime(2026, 1, 15, 10, 0, tzinfo=UTC),
            created_by_id=test_user.id,
        )
        db_session.add(so_prev)
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=so_prev.id,
                service_id=test_service.id,
                unit_price=500.00,
                quantity=1,
            )
        )

        # Current period (Feb 2026) order
        so_curr = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="CRR1A01",
            department="film",
            status="completed",
            is_courtesy=False,
            is_galpon=False,
            is_return=False,
            entry_time=datetime(2026, 2, 15, 10, 0, tzinfo=UTC),
            created_by_id=test_user.id,
        )
        db_session.add(so_curr)
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=so_curr.id,
                service_id=test_service.id,
                unit_price=1000.00,
                quantity=1,
            )
        )
        await db_session.commit()

        # Feb 2026: 28 days. Previous period = 31 Jan - 1 day = 30 Jan → 1 Jan prev.
        # Use a symmetric approach: use same-length period
        # Period: 2026-02-01 to 2026-02-28 (28 days)
        # Previous: duration=27 days, prev_end = 2026-01-31, prev_start = 2026-01-04
        # Jan 15 is within that range.
        start = "2026-02-01T00:00:00Z"
        end = "2026-02-28T23:59:59Z"
        response = await owner_client.get(
            f"/api/v1/analytics/dashboard/overview?start_date={start}&end_date={end}"
        )
        assert response.status_code == 200
        data = response.json()

        rev = data["revenue"]
        assert rev["current"] == 1000.0
        assert rev["previous"] == 500.0
        expected_delta = round((1000.0 - 500.0) / 500.0 * 100, 1)
        assert rev["delta_pct"] == expected_delta  # 100.0


# ===========================================================================
# Tests — pct_courtesy, pct_galpon, pct_return
# ===========================================================================


class TestPctFlags:
    """Verify percentage calculations for courtesy/galpon/return flags."""

    @pytest.mark.asyncio
    async def test_pct_courtesy_correct(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
    ):
        """
        4 orders total, 1 courtesy → pct_courtesy = 25.0.
        """
        response = await owner_client.get(f"/api/v1/analytics/dashboard/overview?{PARAMS}")
        data = response.json()
        assert data["pct_courtesy"]["current"] == 25.0

    @pytest.mark.asyncio
    async def test_pct_galpon_correct(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
    ):
        """
        4 orders total, 1 galpon → pct_galpon = 25.0.
        """
        response = await owner_client.get(f"/api/v1/analytics/dashboard/overview?{PARAMS}")
        data = response.json()
        assert data["pct_galpon"]["current"] == 25.0

    @pytest.mark.asyncio
    async def test_pct_return_correct(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
    ):
        """
        4 orders total, 1 return → pct_return = 25.0.
        """
        response = await owner_client.get(f"/api/v1/analytics/dashboard/overview?{PARAMS}")
        data = response.json()
        assert data["pct_return"]["current"] == 25.0


# ===========================================================================
# Tests — overdue in queue
# ===========================================================================


class TestLiveQueueOverdue:
    """Verify overdue counter in live queue snapshot."""

    @pytest.mark.asyncio
    async def test_overdue_counted(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        overdue_order: ServiceOrder,
    ):
        """
        1 overdue order (start_time 4h ago) → overdue=1 for that store.
        """
        response = await owner_client.get("/api/v1/analytics/dashboard/queue")
        assert response.status_code == 200
        items = response.json()

        store_item = next((i for i in items if i["store_id"] == test_store.id), None)
        assert store_item is not None
        assert store_item["overdue"] == 1
        assert store_item["in_progress"] == 1

    @pytest.mark.asyncio
    async def test_overdue_not_counted_for_recent(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        recent_in_progress_order: ServiceOrder,
    ):
        """
        1 in_progress order started 1h ago → overdue=0.
        """
        response = await owner_client.get("/api/v1/analytics/dashboard/queue")
        assert response.status_code == 200
        items = response.json()

        store_item = next((i for i in items if i["store_id"] == test_store.id), None)
        assert store_item is not None
        assert store_item["overdue"] == 0
        assert store_item["in_progress"] == 1

    @pytest.mark.asyncio
    async def test_overdue_mixed(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        overdue_order: ServiceOrder,
        recent_in_progress_order: ServiceOrder,
    ):
        """
        2 in_progress orders: 1 overdue (4h), 1 not overdue (1h) → overdue=1.
        """
        response = await owner_client.get("/api/v1/analytics/dashboard/queue")
        assert response.status_code == 200
        items = response.json()

        store_item = next((i for i in items if i["store_id"] == test_store.id), None)
        assert store_item is not None
        assert store_item["in_progress"] == 2
        assert store_item["overdue"] == 1


# ===========================================================================
# Tests — Stores ranking
# ===========================================================================


class TestStoresRanking:
    """Verify store ranking data."""

    @pytest.mark.asyncio
    async def test_stores_ranking_revenue_excludes_courtesy(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
        test_store: Store,
    ):
        """
        Revenue for the store must exclude courtesy O.S.
        so1=500, so4=200 → store revenue=700 (so2 courtesy excluded).
        """
        response = await owner_client.get(f"/api/v1/analytics/dashboard/stores?{PARAMS}")
        assert response.status_code == 200
        items = response.json()
        assert len(items) >= 1

        store_item = next((i for i in items if i["store_id"] == test_store.id), None)
        assert store_item is not None
        assert store_item["revenue"] == 700.0
        assert store_item["orders_count"] == 4  # includes all, even courtesy


# ===========================================================================
# Tests — Department breakdown
# ===========================================================================


class TestDepartmentBreakdown:
    """Verify department breakdown."""

    @pytest.mark.asyncio
    async def test_breakdown_has_departments(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
    ):
        """Should return one item per distinct department."""
        response = await owner_client.get(f"/api/v1/analytics/dashboard/departments?{PARAMS}")
        assert response.status_code == 200
        items = response.json()
        assert len(items) >= 2  # film and bodywork

        departments = {i["department"] for i in items}
        assert "film" in departments
        assert "bodywork" in departments

    @pytest.mark.asyncio
    async def test_breakdown_pct_revenue_sums_to_100(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
    ):
        """pct_revenue across all departments must sum to ~100%."""
        response = await owner_client.get(f"/api/v1/analytics/dashboard/departments?{PARAMS}")
        items = response.json()
        # Only items with revenue > 0 count
        total_pct = sum(i["pct_revenue"] for i in items if i["revenue"] > 0)
        assert abs(total_pct - 100.0) < 0.1


# ===========================================================================
# Tests — SLA metrics
# ===========================================================================


class TestSLAMetrics:
    """Verify SLA time metrics."""

    @pytest.mark.asyncio
    async def test_sla_pct_courtesy_correct(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
    ):
        """pct_courtesy in SLA = 1/4 = 25.0."""
        response = await owner_client.get(f"/api/v1/analytics/dashboard/sla?{PARAMS}")
        assert response.status_code == 200
        data = response.json()
        assert data["pct_courtesy"] == 25.0

    @pytest.mark.asyncio
    async def test_sla_pct_galpon_correct(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
    ):
        """pct_galpon in SLA = 1/4 = 25.0."""
        response = await owner_client.get(f"/api/v1/analytics/dashboard/sla?{PARAMS}")
        data = response.json()
        assert data["pct_galpon"] == 25.0

    @pytest.mark.asyncio
    async def test_sla_avg_wait_minutes(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
    ):
        """
        so1: wait = 30 min (8:00 → 8:30)
        so2: wait = 20 min (9:00 → 9:20)
        so3: wait = 30 min (7:00 → 7:30)
        so4: no start_time → excluded
        avg_wait = (30 + 20 + 30) / 3 = 26.67 min
        """
        response = await owner_client.get(f"/api/v1/analytics/dashboard/sla?{PARAMS}")
        data = response.json()
        expected = round((30 + 20 + 30) / 3, 1)
        assert data["avg_wait_minutes"] == expected


# ===========================================================================
# Tests — Timeseries
# ===========================================================================


class TestTimeseries:
    """Verify timeseries grouping."""

    @pytest.mark.asyncio
    async def test_timeseries_month_granularity(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
    ):
        """Month granularity should return one point for Jan 2026."""
        response = await owner_client.get(
            f"/api/v1/analytics/dashboard/timeseries?{PARAMS}&granularity=month"
        )
        assert response.status_code == 200
        points = response.json()
        assert len(points) == 1
        assert points[0]["orders_count"] == 4

    @pytest.mark.asyncio
    async def test_timeseries_revenue_excludes_courtesy(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
    ):
        """
        Timeseries revenue must exclude courtesy O.S.
        so1=500, so4=200 → total=700 (so2 courtesy excluded; so3 has no items).
        """
        response = await owner_client.get(
            f"/api/v1/analytics/dashboard/timeseries?{PARAMS}&granularity=month"
        )
        points = response.json()
        assert len(points) == 1
        assert points[0]["revenue"] == 700.0

    @pytest.mark.asyncio
    async def test_timeseries_day_granularity(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
    ):
        """
        Day granularity should return at least 1 point.
        Note: in SQLite test DB the to_char stub returns YYYY-MM regardless of
        the requested format, so points may be collapsed. We only verify the
        endpoint accepts the parameter and returns a valid list with correct
        total order count.
        """
        response = await owner_client.get(
            f"/api/v1/analytics/dashboard/timeseries?{PARAMS}&granularity=day"
        )
        assert response.status_code == 200
        points = response.json()
        assert len(points) >= 1
        # Total orders across all points must equal 4
        total_orders = sum(p["orders_count"] for p in points)
        assert total_orders == 4


# ===========================================================================
# Tests — Services ranking
# ===========================================================================


class TestServicesRanking:
    """Verify services ranking."""

    @pytest.mark.asyncio
    async def test_services_ranking_returns_data(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
    ):
        """Should return the film service in ranking."""
        response = await owner_client.get(f"/api/v1/analytics/dashboard/services?{PARAMS}")
        assert response.status_code == 200
        items = response.json()
        assert len(items) >= 1
        assert items[0]["service_name"] == "Película fumê"

    @pytest.mark.asyncio
    async def test_services_ranking_department_filter(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
    ):
        """Filter by department=bodywork should return empty (no bodywork items)."""
        response = await owner_client.get(
            f"/api/v1/analytics/dashboard/services?{PARAMS}&department=bodywork"
        )
        assert response.status_code == 200
        assert response.json() == []


# ===========================================================================
# Tests — Employees ranking
# ===========================================================================


class TestEmployeesRanking:
    """Verify employees ranking."""

    @pytest.mark.asyncio
    async def test_employees_ranking_returns_data(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
        test_employee: Employee,
    ):
        """Should return the test employee in ranking."""
        response = await owner_client.get(f"/api/v1/analytics/dashboard/employees?{PARAMS}")
        assert response.status_code == 200
        items = response.json()
        assert len(items) >= 1
        emp = next((i for i in items if i["employee_id"] == test_employee.id), None)
        assert emp is not None
        assert emp["orders_count"] == 1
        assert emp["hours_worked"] == 1.5
        assert emp["avg_hours_per_order"] == 1.5


# ===========================================================================
# Tests — Consultants ranking
# ===========================================================================


class TestConsultantsRanking:
    """Verify consultants ranking."""

    @pytest.mark.asyncio
    async def test_consultants_ranking_returns_data(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
        test_consultant: Consultant,
        test_dealership: Dealership,
    ):
        """Should return the test consultant in ranking."""
        response = await owner_client.get(f"/api/v1/analytics/dashboard/consultants?{PARAMS}")
        assert response.status_code == 200
        items = response.json()
        assert len(items) >= 1
        cons = next((i for i in items if i["consultant_id"] == test_consultant.id), None)
        assert cons is not None
        # so1 is linked to consultant, non-courtesy, revenue=500
        assert cons["revenue"] == 500.0
        assert cons["dealership_name"] == test_dealership.name
