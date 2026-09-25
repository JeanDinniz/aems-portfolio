"""Testes da aba Resumo do Desempenho de Instaladores."""

from datetime import datetime  # noqa: F401
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.employees.models import Employee
from app.modules.installer_performance.service import get_summary_report
from app.modules.service_orders.models import ServiceOrderWorker
from app.modules.services.models import Service
from app.modules.stores.models import Store

# importa fixtures e helper do módulo de performance
from tests.integration.test_installer_performance import (  # noqa: F401,F811
    REPORT_DAY,
    _completed_os,
    perf_installers,
    perf_services,
)


class TestSummaryReport:
    @pytest.mark.asyncio
    async def test_totals_and_ranking_sorted_by_points(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_user: User,
        perf_services: list[Service],  # noqa: F811
        perf_installers: list[Employee],  # noqa: F811
    ):
        perf_services[0].points = Decimal("1.00")
        perf_services[1].points = Decimal("5.00")
        await db_session.commit()
        so, items = await _completed_os(
            db_session, test_store, test_user, perf_services, [400, 600]
        )
        db_session.add_all(
            [
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[0].id,
                    service_order_item_id=items[0].id,
                ),
                ServiceOrderWorker(
                    service_order_id=so.id,
                    employee_id=perf_installers[1].id,
                    service_order_item_id=items[1].id,
                ),
            ]
        )
        await db_session.commit()

        rep = await get_summary_report(
            db_session, test_owner, REPORT_DAY.date(), REPORT_DAY.date()
        )
        # ordenado por pontos desc → instalador[1] (5,0) antes de instalador[0] (1,0)
        assert rep.rows[0].points >= rep.rows[1].points
        assert rep.totals.total_points == pytest.approx(6.0)
        assert rep.totals.total_revenue == pytest.approx(1000.0)
        # cada instalador fez 1 carro; total de carros = 1 (mesma placa)
        assert rep.totals.total_cars == 1
        by_id = {r.employee_id: r for r in rep.rows}
        assert by_id[perf_installers[0].id].cars_count == 1

    @pytest.mark.asyncio
    async def test_summary_endpoint_owner(
        self,
        owner_client: AsyncClient,
    ):
        resp = await owner_client.get(
            "/api/v1/installer-performance/summary",
            params={"start": "2026-07-01", "end": "2026-07-31"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "totals" in body and "rows" in body
        assert "film_cost" in body["totals"]
