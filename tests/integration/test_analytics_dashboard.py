"""
Integration tests for Dashboard Executivo endpoints.

Tests:
1. 200 OK as Owner for each of the 9 new endpoints
2. 403 Forbidden for non-owner users
3. delta_pct calculated correctly, including None when previous == 0
4. pct_courtesy/galpon/return calculated correctly
5. overdue counts correctly (in_progress AND start_time > 3h ago)
"""

from datetime import UTC, datetime

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
    async def test_sla_forbidden(self, authenticated_client: AsyncClient):
        response = await authenticated_client.get(f"/api/v1/analytics/dashboard/sla?{PARAMS}")
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
    async def test_sla_ok(self, owner_client: AsyncClient):
        response = await owner_client.get(f"/api/v1/analytics/dashboard/sla?{PARAMS}")
        assert response.status_code == 200
        data = response.json()
        assert data["avg_wait_minutes"] == 0.0
        assert data["avg_execution_minutes"] == 0.0

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
        Revenue Jan = 500 (só so1; so2 cortesia e so4 retorno excluídos da receita).
        """
        response = await owner_client.get(f"/api/v1/analytics/dashboard/overview?{PARAMS}")
        assert response.status_code == 200
        data = response.json()

        # 4 orders in Jan 2026, 0 in previous period → delta_pct is None
        assert data["total_orders"]["current"] == 4
        assert data["total_orders"]["previous"] == 0
        assert data["total_orders"]["delta_pct"] is None

        # Revenue: exclui cortesia (so2) E retorno (so4) — não são cobrados
        # so1=500 → revenue=500
        assert data["revenue"]["current"] == 500.0
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
        Revenue for the store must exclude courtesy AND return O.S.
        so1=500 → store revenue=500 (so2 cortesia e so4 retorno excluídos).
        """
        response = await owner_client.get(f"/api/v1/analytics/dashboard/stores?{PARAMS}")
        assert response.status_code == 200
        items = response.json()
        assert len(items) >= 1

        store_item = next((i for i in items if i["store_id"] == test_store.id), None)
        assert store_item is not None
        assert store_item["revenue"] == 500.0
        assert store_item["orders_count"] == 4  # includes all, even courtesy/return


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
        Timeseries revenue must exclude courtesy AND return O.S.
        so1=500 → total=500 (so2 cortesia e so4 retorno excluídos; so3 sem itens).
        """
        response = await owner_client.get(
            f"/api/v1/analytics/dashboard/timeseries?{PARAMS}&granularity=month"
        )
        points = response.json()
        assert len(points) == 1
        assert points[0]["revenue"] == 500.0

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

    @pytest.mark.asyncio
    async def test_employees_ranking_only_counts_completed(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service: Service,
        test_employee: Employee,
    ):
        """
        Ranking segue a régua do Desempenho: O.S. NÃO finalizada com instalador
        vinculado não entra. Antes o Dashboard contava waiting/in_progress e
        inflava serviços/receita frente à tela de Desempenho.
        """
        # O.S. finalizada em Jan/2026 com o instalador → conta
        done = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="CMP1A01",
            department="film",
            status="completed",
            is_courtesy=False,
            is_galpon=False,
            is_return=False,
            entry_time=datetime(2026, 1, 8, 8, 0, tzinfo=UTC),
            start_time=datetime(2026, 1, 8, 8, 30, tzinfo=UTC),
            completion_time=datetime(2026, 1, 8, 10, 0, tzinfo=UTC),
            created_by_id=test_user.id,
        )
        db_session.add(done)
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=done.id, service_id=test_service.id, unit_price=500.00, quantity=1
            )
        )
        db_session.add(
            ServiceOrderWorker(service_order_id=done.id, employee_id=test_employee.id)
        )

        # O.S. em andamento (entrou no período) com o MESMO instalador → NÃO conta
        wip = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="CMP1A02",
            department="film",
            status="in_progress",
            is_courtesy=False,
            is_galpon=False,
            is_return=False,
            entry_time=datetime(2026, 1, 9, 8, 0, tzinfo=UTC),
            start_time=datetime(2026, 1, 9, 8, 30, tzinfo=UTC),
            created_by_id=test_user.id,
        )
        db_session.add(wip)
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=wip.id, service_id=test_service.id, unit_price=900.00, quantity=1
            )
        )
        db_session.add(
            ServiceOrderWorker(service_order_id=wip.id, employee_id=test_employee.id)
        )
        await db_session.commit()

        response = await owner_client.get(f"/api/v1/analytics/dashboard/employees?{PARAMS}")
        assert response.status_code == 200
        emp = next(
            (i for i in response.json() if i["employee_id"] == test_employee.id), None
        )
        assert emp is not None
        # Só a O.S. finalizada conta: 1 serviço, R$ 500 (a in_progress de R$ 900 fica fora)
        assert emp["orders_count"] == 1
        assert emp["services_count"] == 1.0
        assert emp["revenue"] == 500.0


# ===========================================================================
# Tests — Excluded statuses (cancelled/wrong/duplicate fora das métricas)
# ===========================================================================


@pytest_asyncio.fixture
async def invalid_status_orders(
    db_session: AsyncSession,
    test_store: Store,
    test_user: User,
    test_service: Service,
) -> list[ServiceOrder]:
    """O.S. cancelada, lançada errada e duplicada em Jan 2026, todas com item."""
    orders: list[ServiceOrder] = []
    for i, status in enumerate(("cancelled", "wrong", "duplicate")):
        so = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate=f"INV{i}A0{i}",
            department="film",
            status=status,
            is_courtesy=False,
            is_galpon=False,
            is_return=False,
            entry_time=datetime(2026, 1, 5 + i, 8, 0, tzinfo=UTC),
            start_time=datetime(2026, 1, 5 + i, 9, 0, tzinfo=UTC),
            completion_time=datetime(2026, 1, 5 + i, 19, 0, tzinfo=UTC),
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=so.id,
                service_id=test_service.id,
                unit_price=1000.00,
                quantity=1,
            )
        )
        orders.append(so)
    await db_session.commit()
    return orders


class TestExcludedStatuses:
    """O.S. cancelada/errada/duplicada não conta em receita, totais nem séries."""

    @pytest.mark.asyncio
    async def test_overview_excludes_invalid_statuses(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
        invalid_status_orders: list[ServiceOrder],
    ):
        response = await owner_client.get(f"/api/v1/analytics/dashboard/overview?{PARAMS}")
        assert response.status_code == 200
        data = response.json()
        # Apenas as 4 O.S. válidas contam; R$ 3000 das inválidas fica fora.
        # Receita = só so1 (500); so2 cortesia e so4 retorno fora da receita.
        assert data["total_orders"]["current"] == 4
        assert data["revenue"]["current"] == 500.0

    @pytest.mark.asyncio
    async def test_stores_ranking_excludes_invalid_statuses(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
        invalid_status_orders: list[ServiceOrder],
        test_store: Store,
    ):
        response = await owner_client.get(f"/api/v1/analytics/dashboard/stores?{PARAMS}")
        items = response.json()
        store_item = next((i for i in items if i["store_id"] == test_store.id), None)
        assert store_item is not None
        assert store_item["orders_count"] == 4
        assert store_item["revenue"] == 500.0

    @pytest.mark.asyncio
    async def test_timeseries_excludes_invalid_statuses(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
        invalid_status_orders: list[ServiceOrder],
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/dashboard/timeseries?{PARAMS}&granularity=month"
        )
        points = response.json()
        assert sum(p["orders_count"] for p in points) == 4
        assert sum(p["revenue"] for p in points) == 500.0


# ===========================================================================
# Tests — Normalização de período (último dia inteiro conta)
# ===========================================================================


class TestPeriodEndOfDay:
    """end_date enviado como data pura (meia-noite) deve cobrir o dia inteiro."""

    @pytest.mark.asyncio
    async def test_last_day_orders_are_included(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service: Service,
    ):
        # O.S. às 18h do último dia do período
        so = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="EOD1A01",
            department="film",
            status="completed",
            is_courtesy=False,
            is_galpon=False,
            is_return=False,
            entry_time=datetime(2026, 1, 31, 18, 0, tzinfo=UTC),
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=so.id,
                service_id=test_service.id,
                unit_price=400.00,
                quantity=1,
            )
        )
        await db_session.commit()

        # end_date como o frontend envia: data pura → meia-noite
        response = await owner_client.get(
            "/api/v1/analytics/dashboard/overview"
            "?start_date=2026-01-01T00:00:00Z&end_date=2026-01-31T00:00:00Z"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total_orders"]["current"] == 1
        assert data["revenue"]["current"] == 400.0


# ===========================================================================
# Tests — SLA considera execução apenas de O.S. concluídas
# ===========================================================================


class TestSlaOnlyCompleted:
    """O.S. não concluída com completion_time residual não entra na execução."""

    @pytest.mark.asyncio
    async def test_execution_ignores_non_completed(
        self,
        owner_client: AsyncClient,
        dashboard_orders: list[ServiceOrder],
        invalid_status_orders: list[ServiceOrder],
    ):
        """
        Execução válida: so1 = 90 min (8:30→10:00), so2 = 100 min (9:20→11:00).
        As inválidas têm 10h de "execução" e devem ficar fora.
        avg_execution = (90 + 100) / 2 = 95.0
        """
        response = await owner_client.get(f"/api/v1/analytics/dashboard/sla?{PARAMS}")
        assert response.status_code == 200
        data = response.json()
        assert data["avg_execution_minutes"] == 95.0


# ===========================================================================
# Tests — Dealerships ranking
# ===========================================================================


class TestDealershipsRanking:
    """Ranking de concessionárias parceiras."""

    @pytest.mark.asyncio
    async def test_dealerships_forbidden_for_user(self, authenticated_client: AsyncClient):
        response = await authenticated_client.get(
            f"/api/v1/analytics/dashboard/dealerships?{PARAMS}"
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_dealerships_empty_ok(self, owner_client: AsyncClient):
        response = await owner_client.get(f"/api/v1/analytics/dashboard/dealerships?{PARAMS}")
        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    async def test_dealerships_ranking_revenue(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service: Service,
        test_dealership: Dealership,
    ):
        """O.S. vinculada à concessionária soma receita; cortesia fica fora."""
        so = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="DLR1A01",
            department="film",
            status="completed",
            is_courtesy=False,
            is_galpon=False,
            is_return=False,
            entry_time=datetime(2026, 1, 12, 8, 0, tzinfo=UTC),
            dealership_id=test_dealership.id,
            created_by_id=test_user.id,
        )
        so_courtesy = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="DLR2C02",
            department="film",
            status="completed",
            is_courtesy=True,
            is_galpon=False,
            is_return=False,
            entry_time=datetime(2026, 1, 13, 8, 0, tzinfo=UTC),
            dealership_id=test_dealership.id,
            created_by_id=test_user.id,
        )
        db_session.add_all([so, so_courtesy])
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=so.id,
                service_id=test_service.id,
                unit_price=800.00,
                quantity=1,
            )
        )
        db_session.add(
            ServiceOrderItem(
                service_order_id=so_courtesy.id,
                service_id=test_service.id,
                unit_price=999.00,
                quantity=1,
            )
        )
        await db_session.commit()

        response = await owner_client.get(f"/api/v1/analytics/dashboard/dealerships?{PARAMS}")
        assert response.status_code == 200
        items = response.json()
        item = next((i for i in items if i["dealership_id"] == test_dealership.id), None)
        assert item is not None
        assert item["orders_count"] == 1
        assert item["revenue"] == 800.0
        assert item["avg_ticket"] == 800.0


# ===========================================================================
# Tests — timeseries-by-type com receita por tipo (Valor Bruto)
# ===========================================================================


class TestTimeseriesByTypeRevenue:
    """Receita por tipo acompanha a contagem (regra: itens, sem cortesia)."""

    @pytest.mark.asyncio
    async def test_counts_and_revenue_per_type(
        self, owner_client: AsyncClient, dashboard_orders: list[ServiceOrder]
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/dashboard/timeseries-by-type?{PARAMS}&granularity=month"
        )
        assert response.status_code == 200
        points = response.json()
        assert len(points) == 1
        p = points[0]
        # film: so1 (500, ok) + so2 (300, CORTESIA) + so4 (200, RETORNO); estética: so3 (sem itens)
        assert p["film_count"] == 3
        assert p["estetica_count"] == 1
        assert p["ppf_count"] == 0
        # cortesia (so2) e retorno (so4) fora da receita, dentro da contagem → só so1
        assert p["film_revenue"] == 500.0
        assert p["estetica_revenue"] == 0.0
        assert p["ppf_revenue"] == 0.0


# ===========================================================================
# Tests — previsão de faturamento (run-rate por dias úteis)
# ===========================================================================


class TestRevenueForecast:
    @pytest.mark.asyncio
    async def test_forbidden_for_user(self, authenticated_client: AsyncClient):
        response = await authenticated_client.get("/api/v1/analytics/dashboard/revenue-forecast")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_empty_month_returns_zero(self, owner_client: AsyncClient):
        response = await owner_client.get("/api/v1/analytics/dashboard/revenue-forecast")
        assert response.status_code == 200
        data = response.json()
        assert data["revenue_so_far"] == 0.0
        assert data["forecast"] == 0.0
        assert data["business_days_total"] >= data["business_days_elapsed"] > 0

    @pytest.mark.asyncio
    async def test_run_rate_projection(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service: Service,
    ):
        """Receita de hoje projetada para o mês inteiro por dias úteis."""
        from datetime import date as date_type, time as time_type

        # Meio-dia da DATA LOCAL: a janela do forecast usa date.today() local;
        # now(UTC) à noite já seria o dia seguinte e cairia fora da janela.
        entry = datetime.combine(date_type.today(), time_type(12, 0), tzinfo=UTC)
        so = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="FRC1A23",
            department="film",
            status="completed",
            is_courtesy=False,
            is_galpon=False,
            is_return=False,
            entry_time=entry,
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=so.id,
                service_id=test_service.id,
                unit_price=1000.00,
                quantity=1,
            )
        )
        await db_session.commit()

        response = await owner_client.get("/api/v1/analytics/dashboard/revenue-forecast")
        assert response.status_code == 200
        data = response.json()
        assert data["revenue_so_far"] == 1000.0
        expected = round(
            1000.0 / data["business_days_elapsed"] * data["business_days_total"], 2
        )
        assert data["forecast"] == pytest.approx(expected)
        assert data["forecast"] >= 1000.0


# ===========================================================================
# Tests — ranking de funcionários: valor + filtro por departamento da O.S.
# ===========================================================================


class TestEmployeesRankingRevenueAndFilter:
    @pytest.mark.asyncio
    async def test_legacy_worker_gets_order_total(
        self, owner_client: AsyncClient, dashboard_orders: list[ServiceOrder]
    ):
        """Worker legado (sem vínculo de item) soma o total da O.S."""
        response = await owner_client.get(f"/api/v1/analytics/dashboard/employees?{PARAMS}")
        assert response.status_code == 200
        items = response.json()
        assert len(items) == 1  # só so1 tem worker
        assert items[0]["revenue"] == 500.0
        assert items[0]["services_count"] == 1

    @pytest.mark.asyncio
    async def test_item_worker_gets_item_value(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service: Service,
        test_employee: Employee,
        dashboard_orders: list[ServiceOrder],
    ):
        """Instalador por serviço soma só o valor do SEU item."""
        so = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="RNK1A11",
            department="security_film",
            status="completed",
            is_courtesy=False,
            is_galpon=False,
            is_return=False,
            entry_time=datetime(2026, 1, 18, 9, 0, tzinfo=UTC),
            completion_time=datetime(2026, 1, 18, 11, 0, tzinfo=UTC),
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.flush()
        item1 = ServiceOrderItem(
            service_order_id=so.id, service_id=test_service.id, unit_price=400.00, quantity=1
        )
        item2 = ServiceOrderItem(
            service_order_id=so.id, service_id=test_service.id, unit_price=150.00, quantity=1
        )
        db_session.add_all([item1, item2])
        await db_session.flush()
        db_session.add(
            ServiceOrderWorker(
                service_order_id=so.id,
                employee_id=test_employee.id,
                service_order_item_id=item1.id,
            )
        )
        await db_session.commit()

        # Filtro multi: só security_film → aparece com o valor do item vinculado
        response = await owner_client.get(
            f"/api/v1/analytics/dashboard/employees?{PARAMS}&departments=security_film"
        )
        assert response.status_code == 200
        items = response.json()
        assert len(items) == 1
        assert items[0]["revenue"] == 400.0
        assert items[0]["services_count"] == 1

        # Multi combinado film + security_film → soma legado (500) + item (400)
        response = await owner_client.get(
            f"/api/v1/analytics/dashboard/employees?{PARAMS}"
            "&departments=film&departments=security_film"
        )
        items = response.json()
        assert items[0]["revenue"] == 900.0
        assert items[0]["services_count"] == 2

    @pytest.mark.asyncio
    async def test_filter_by_os_department_not_employee_registry(
        self, owner_client: AsyncClient, dashboard_orders: list[ServiceOrder]
    ):
        """Funcionário é 'film' no cadastro; sem trabalho em ppf, filtro ppf vazio."""
        response = await owner_client.get(
            f"/api/v1/analytics/dashboard/employees?{PARAMS}&departments=ppf"
        )
        assert response.status_code == 200
        assert response.json() == []


# ===========================================================================
# Tests — ranking Película × PPF: coluna Serviços
# ===========================================================================


class TestFilmPpfRankingServicesCount:
    @pytest.mark.asyncio
    async def test_services_count_counts_items(
        self, owner_client: AsyncClient, dashboard_orders: list[ServiceOrder], test_store: Store
    ):
        """so1 + so2 + so4 (film): 3 O.S., 3 itens, receita sem cortesia nem retorno = 500 (só so1)."""
        response = await owner_client.get(
            f"/api/v1/analytics/dashboard/film-ppf-ranking?{PARAMS}"
        )
        assert response.status_code == 200
        items = response.json()
        row = next(i for i in items if i["store_id"] == test_store.id)
        assert row["orders_count"] == 3
        assert row["services_count"] == 3
        assert row["revenue"] == 500.0
