"""Testes do vínculo de O.S. de origem e da aba Retornos."""

import json
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.brands.models import Brand
from app.modules.employees.models import Employee
from app.modules.service_orders.models import ServiceOrder
from app.modules.services.models import Service
from app.modules.stores.models import Store

# importa fixtures e helper do módulo de performance
from tests.integration.test_installer_performance import (  # noqa: F401,F811
    REPORT_DAY,
    _completed_os,
    perf_installers,
    perf_services,
)


class TestOriginLink:
    """Testa que original_service_order_id vincula uma O.S. de retorno à sua origem."""

    @pytest.mark.asyncio
    async def test_create_return_with_origin(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_brand: Brand,
        test_user: User,
    ):
        """O.S. B de retorno deve persistir o vínculo para a O.S. A de origem."""
        # Fixture de serviço local (não depende de test_service do módulo service_orders)
        service = Service(
            name="Película Fumê 35%",
            department="film",
            base_price=150.00,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(service)
        await db_session.flush()

        # Cria O.S. de origem (A)
        origin = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="ORI1A23",
            department="film",
            status="completed",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://example.com/photo1.jpg"]),
            created_by_id=test_user.id,
        )
        db_session.add(origin)
        await db_session.flush()

        # Cria O.S. de retorno (B) apontando para origem A
        return_os = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="ORI1A23",
            department="film",
            status="waiting",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://example.com/photo2.jpg"]),
            is_return=True,
            original_service_order_id=origin.id,
            created_by_id=test_user.id,
        )
        db_session.add(return_os)
        await db_session.commit()

        # Recarrega do banco para garantir persistência
        await db_session.refresh(return_os)

        assert return_os.is_return is True
        assert return_os.original_service_order_id == origin.id

    @pytest.mark.asyncio
    async def test_api_accepts_and_returns_original_link(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_brand: Brand,
        test_user: User,
    ):
        """POST /service-orders deve aceitar original_service_order_id e serializá-lo na resposta."""
        from app.modules.dealerships.models import Dealership

        # Cria concessionária local (necessária para O.S. de filme via API)
        dealership = Dealership(
            name="Toyota Retorno",
            store_id=test_store.id,
            brand="Toyota",
            address="Av. Retorno, 1",
            is_active=True,
        )
        db_session.add(dealership)

        # Cria serviço local (não depende do fixture test_service do módulo service_orders)
        service = Service(
            name="Película Fumê 35% (return)",
            department="film",
            base_price=150.00,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(service)
        await db_session.flush()

        # Cria O.S. de origem (A) diretamente no banco — evita duplicar fixtures pesadas
        origin = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="ORI2B34",
            department="film",
            status="completed",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://example.com/a1.jpg"]),
            created_by_id=test_user.id,
        )
        db_session.add(origin)
        await db_session.commit()
        await db_session.refresh(origin)

        # Cria O.S. de retorno (B) via API com original_service_order_id
        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": dealership.id,
                "vehicle_plate": "ORI2B34",
                "vehicle_brand": "Toyota",
                "vehicle_model": "Corolla",
                "vehicle_color": "Prata",
                "vehicle_year": 2023,
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/r1.jpg"],
                "items": [{"service_id": service.id, "quantity": 1}],
                "is_return": True,
                "original_service_order_id": origin.id,
            },
        )

        assert response.status_code == 201, response.text
        data = response.json()
        assert data["is_return"] is True
        assert data["original_service_order_id"] == origin.id

    @pytest.mark.asyncio
    async def test_fallback_resolve_origem_estrita_por_departamento(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_brand: Brand,
        test_user: User,
    ):
        """Sem original_service_order_id, o fallback do create_service_order resolve
        a origem ESTRITA pelo departamento da O.S. — o mesmo veículo tem duas O.S.
        finalizadas (film + security_film) e o retorno é de security_film."""
        from app.modules.dealerships.models import Dealership

        dealership = Dealership(
            name="Toyota Depto",
            store_id=test_store.id,
            brand="Toyota",
            address="Av. Depto, 1",
            is_active=True,
        )
        db_session.add(dealership)
        service_sec = Service(
            name="Película Segurança PS4",
            department="security_film",
            base_price=650.00,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(service_sec)
        await db_session.flush()

        # Duas origens finalizadas do MESMO veículo, em departamentos distintos.
        origin_film = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="DEP1A23",
            department="film",
            status="completed",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://example.com/f.jpg"]),
            created_by_id=test_user.id,
        )
        origin_sec = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="DEP1A23",
            department="security_film",
            status="completed",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://example.com/s.jpg"]),
            created_by_id=test_user.id,
        )
        db_session.add_all([origin_film, origin_sec])
        await db_session.commit()
        await db_session.refresh(origin_sec)

        response = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": dealership.id,
                "vehicle_plate": "DEP1A23",
                "vehicle_brand": "Toyota",
                "vehicle_model": "Corolla",
                "vehicle_color": "Prata",
                "vehicle_year": 2023,
                "department": "security_film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/r2.jpg"],
                "items": [{"service_id": service_sec.id, "quantity": 1}],
                "is_return": True,
            },
        )

        assert response.status_code == 201, response.text
        data = response.json()
        assert data["is_return"] is True
        # Deve vincular à origem de security_film (não à de film).
        assert data["original_service_order_id"] == origin_sec.id


class TestOriginSuggestion:
    """Testa o endpoint de sugestão de O.S. de origem por placa."""

    @pytest.mark.asyncio
    async def test_suggests_null_for_unknown_plate(
        self,
        owner_client: AsyncClient,
        test_store: Store,
    ):
        """Placa sem histórico → suggestion None."""
        resp = await owner_client.get(
            "/api/v1/service-orders/return-origin-suggestion",
            params={"plate": "SUG1A23"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["suggestion"] is None

    @pytest.mark.asyncio
    async def test_suggests_last_completed_non_return(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
    ):
        """Placa com O.S. completed não-retorno → suggestion retorna essa O.S."""
        completed = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="SUG2B34",
            department="film",
            status="completed",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://example.com/sug1.jpg"]),
            is_return=False,
            created_by_id=test_user.id,
        )
        db_session.add(completed)
        await db_session.commit()
        await db_session.refresh(completed)

        resp = await owner_client.get(
            "/api/v1/service-orders/return-origin-suggestion",
            params={"plate": "SUG2B34"},
        )
        assert resp.status_code == 200, resp.text
        suggestion = resp.json()["suggestion"]
        assert suggestion is not None
        assert suggestion["id"] == completed.id
        assert suggestion["order_number"] == completed.order_number

    @pytest.mark.asyncio
    async def test_skips_is_return_os(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
    ):
        """O.S. completed mas is_return=True deve ser ignorada → suggestion None."""
        return_os = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="SUG3C45",
            department="film",
            status="completed",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://example.com/sug2.jpg"]),
            is_return=True,
            created_by_id=test_user.id,
        )
        db_session.add(return_os)
        await db_session.commit()

        resp = await owner_client.get(
            "/api/v1/service-orders/return-origin-suggestion",
            params={"plate": "SUG3C45"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["suggestion"] is None


class TestReturnsReport:
    @pytest.mark.asyncio
    async def test_return_row_includes_origin(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_user: User,
        perf_services: list[Service],  # noqa: F811
        perf_installers: list[Employee],  # noqa: F811
    ):
        from app.modules.installer_performance.service import get_returns_report
        from app.modules.service_orders.models import ServiceOrderWorker

        origin, _ = await _completed_os(
            db_session, test_store, test_user, perf_services[:1], [400], plate="RET1A23"
        )
        db_session.add(
            ServiceOrderWorker(service_order_id=origin.id, employee_id=perf_installers[0].id)
        )
        ret, _ = await _completed_os(
            db_session,
            test_store,
            test_user,
            perf_services[:1],
            [0],
            plate="RET1A23",
            is_return=True,
        )
        ret.original_service_order_id = origin.id
        db_session.add(
            ServiceOrderWorker(service_order_id=ret.id, employee_id=perf_installers[1].id)
        )
        await db_session.commit()

        rep = await get_returns_report(db_session, test_owner, REPORT_DAY.date(), REPORT_DAY.date())
        assert len(rep.rows) == 1
        row = rep.rows[0]
        assert perf_installers[1].name in row.return_workers
        assert perf_installers[0].name in row.origin_workers
        assert row.origin_date is not None
        # vehicle mapping: chassis (plate), model, color são copiados da O.S. de retorno
        assert row.chassis == "RET1A23"

    @pytest.mark.asyncio
    async def test_fallback_origin_by_plate_same_department(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_user: User,
        perf_services: list[Service],  # noqa: F811
        perf_installers: list[Employee],  # noqa: F811
    ):
        """Sem original_service_order_id, o 'anterior' é resolvido pela placa + mesmo depto."""
        from decimal import Decimal

        from app.modules.installer_performance.service import get_returns_report
        from app.modules.service_orders.models import ServiceOrderItem, ServiceOrderWorker

        # Origem: film, não-retorno, mesma placa, data anterior, SEM link manual
        origin = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="FALL1A23",
            department="film",
            status="completed",
            entry_time=datetime(2026, 7, 1, 8, tzinfo=UTC),
            completion_time=datetime(2026, 7, 1, 10, tzinfo=UTC),
            photos=json.dumps(["http://example.com/f1.jpg"]),
            created_by_id=test_user.id,
        )
        db_session.add(origin)
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=origin.id,
                service_id=perf_services[0].id,
                unit_price=Decimal("400"),
                quantity=1,
            )
        )
        db_session.add(
            ServiceOrderWorker(service_order_id=origin.id, employee_id=perf_installers[0].id)
        )

        # Retorno no período, mesma placa, SEM original_service_order_id
        ret, _ = await _completed_os(
            db_session,
            test_store,
            test_user,
            perf_services[:1],
            [0],
            plate="FALL1A23",
            is_return=True,
        )
        db_session.add(
            ServiceOrderWorker(service_order_id=ret.id, employee_id=perf_installers[1].id)
        )
        await db_session.commit()

        rep = await get_returns_report(db_session, test_owner, REPORT_DAY.date(), REPORT_DAY.date())
        row = next(r for r in rep.rows if r.return_os_id == ret.id)
        assert row.origin_os_id == origin.id
        assert perf_installers[0].name in row.origin_workers
        assert row.origin_date is not None

    @pytest.mark.asyncio
    async def test_fallback_ignores_other_department(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_user: User,
        perf_services: list[Service],  # noqa: F811
        perf_installers: list[Employee],  # noqa: F811
    ):
        """Origem de OUTRO departamento (mesma placa) não é puxada como 'anterior'."""
        from app.modules.installer_performance.service import get_returns_report
        from app.modules.service_orders.models import ServiceOrderWorker

        # Origem em depto diferente (ppf) — não deve casar com o retorno de film
        origin_other = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="FALL2B34",
            department="ppf",
            status="completed",
            entry_time=datetime(2026, 7, 1, 8, tzinfo=UTC),
            completion_time=datetime(2026, 7, 1, 10, tzinfo=UTC),
            photos=json.dumps(["http://example.com/f2.jpg"]),
            created_by_id=test_user.id,
        )
        db_session.add(origin_other)
        await db_session.flush()
        db_session.add(
            ServiceOrderWorker(service_order_id=origin_other.id, employee_id=perf_installers[0].id)
        )

        ret, _ = await _completed_os(
            db_session,
            test_store,
            test_user,
            perf_services[:1],
            [0],
            plate="FALL2B34",
            is_return=True,  # department="film"
        )
        await db_session.commit()

        rep = await get_returns_report(db_session, test_owner, REPORT_DAY.date(), REPORT_DAY.date())
        row = next(r for r in rep.rows if r.return_os_id == ret.id)
        assert row.origin_os_id is None
        assert row.origin_workers == []

    @pytest.mark.asyncio
    async def test_cross_store_origin_not_visible(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_user: User,
        perf_services: list[Service],  # noqa: F811
        perf_installers: list[Employee],  # noqa: F811
    ):
        """
        Escopo cross-store: retorno na loja do usuário com origem numa loja diferente.

        Um usuário restrito à loja do retorno NÃO deve conseguir ler workers/notes/services
        da O.S. de origem (que está em outra loja). O campo origin_* deve ficar vazio.
        O owner (que enxerga todas as lojas) SIM deve ver a origem preenchida.
        """
        from app.modules.brands.models import Brand
        from app.modules.installer_performance.service import get_returns_report
        from app.modules.service_orders.models import ServiceOrderWorker

        # Cria uma segunda loja para hospedar a O.S. de origem
        other_brand = Brand(name="CrossBrand", code="crossbrand", is_active=True)
        db_session.add(other_brand)
        await db_session.flush()
        other_store = Store(
            name="Loja Outra Cross", code="CRS9", is_active=True, brand_id=other_brand.id
        )
        db_session.add(other_store)
        await db_session.flush()

        # Cria usuário restrito APENAS à loja test_store (não-owner, store_id=test_store)
        restricted_user = User(
            full_name="Restricted User",
            email="restricted_cross@test.com",
            hashed_password="x",
            is_active=True,
            must_change_password=False,
            store_id=test_store.id,
            role="user",
        )
        db_session.add(restricted_user)
        await db_session.flush()

        # Recarrega com access_profiles eager para evitar lazy-load em contexto async
        from sqlalchemy.orm import selectinload as _sil

        restricted_user = (
            await db_session.execute(
                select(User)
                .options(_sil(User.access_profiles))
                .where(User.email == "restricted_cross@test.com")
            )
        ).scalar_one()

        # O.S. de origem na outra loja (não acessível ao restricted_user)
        origin, _ = await _completed_os(
            db_session, other_store, test_user, perf_services[:1], [500], plate="CRS1A23"
        )
        db_session.add(
            ServiceOrderWorker(service_order_id=origin.id, employee_id=perf_installers[0].id)
        )

        # O.S. de retorno na loja do usuário restrito
        ret, _ = await _completed_os(
            db_session,
            test_store,
            test_user,
            perf_services[:1],
            [0],
            plate="CRS1A23",
            is_return=True,
        )
        ret.original_service_order_id = origin.id
        db_session.add(
            ServiceOrderWorker(service_order_id=ret.id, employee_id=perf_installers[1].id)
        )
        await db_session.commit()

        # Usuário restrito não deve enxergar a origem (outra loja)
        rep_restricted = await get_returns_report(
            db_session, restricted_user, REPORT_DAY.date(), REPORT_DAY.date()
        )
        assert len(rep_restricted.rows) == 1
        row_restricted = rep_restricted.rows[0]
        assert row_restricted.origin_os_id is None
        assert row_restricted.origin_workers == []
        assert row_restricted.origin_services == []

        # Owner vê tudo: origem deve aparecer preenchida
        rep_owner = await get_returns_report(
            db_session, test_owner, REPORT_DAY.date(), REPORT_DAY.date()
        )
        # O owner enxerga O.S. de ambas as lojas; filtra o retorno correto
        owner_row = next((r for r in rep_owner.rows if r.return_os_id == ret.id), None)
        assert owner_row is not None
        assert owner_row.origin_os_id == origin.id
        assert perf_installers[0].name in owner_row.origin_workers


class TestReturnOriginBackendFallback:
    """Ao criar retorno sem original_service_order_id, o backend resolve pela placa."""

    @pytest.mark.asyncio
    async def test_create_return_without_origin_resolves_by_plate(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_brand: Brand,
        test_user: User,
    ):
        from app.modules.dealerships.models import Dealership

        dealership = Dealership(
            name="Toyota Fallback",
            store_id=test_store.id,
            brand="Toyota",
            address="Av. FB, 1",
            is_active=True,
        )
        db_session.add(dealership)
        service = Service(
            name="Película Fallback",
            department="film",
            base_price=150.00,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(service)
        origin = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="RSLV1A23",
            department="film",
            status="completed",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://example.com/o.jpg"]),
            created_by_id=test_user.id,
        )
        db_session.add(origin)
        await db_session.commit()
        await db_session.refresh(origin)

        # Retorno SEM original_service_order_id → backend resolve por placa
        resp = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": dealership.id,
                "vehicle_plate": "RSLV1A23",
                "vehicle_brand": "Toyota",
                "vehicle_model": "Corolla",
                "vehicle_color": "Prata",
                "vehicle_year": 2023,
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/r.jpg"],
                "items": [{"service_id": service.id, "quantity": 1}],
                "is_return": True,
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["original_service_order_id"] == origin.id


class TestAppointmentReturnOrigin:
    """O agendamento de retorno persiste o vínculo da O.S. de origem (explícito e por placa)."""

    @pytest.mark.asyncio
    async def test_create_appointment_persists_explicit_origin(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_brand: Brand,
        test_user: User,
    ):
        from datetime import date as _date
        from datetime import time as _time

        from app.modules.scheduling.schemas import AppointmentCreate
        from app.modules.scheduling.service import create_appointment

        svc = Service(
            name="Funilaria Retorno",
            department="bodywork",
            base_price=200.00,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(svc)
        origin = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="APPT1A23",
            department="bodywork",
            status="completed",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://example.com/o.jpg"]),
            created_by_id=test_user.id,
        )
        db_session.add(origin)
        await db_session.commit()
        await db_session.refresh(origin)

        data = AppointmentCreate(
            store_id=test_store.id,
            department="bodywork",
            delivery_date=_date(2030, 6, 15),
            delivery_time=_time(10, 0),
            vehicle_plate="APPT1A23",
            service_ids=[svc.id],
            is_return=True,
            original_service_order_id=origin.id,
        )
        resp = await create_appointment(db_session, data, test_owner)
        assert resp.is_return is True
        assert resp.original_service_order_id == origin.id

    @pytest.mark.asyncio
    async def test_create_appointment_resolves_origin_by_plate(
        self,
        db_session: AsyncSession,
        test_owner: User,
        test_store: Store,
        test_brand: Brand,
        test_user: User,
    ):
        from datetime import date as _date
        from datetime import time as _time

        from app.modules.scheduling.schemas import AppointmentCreate
        from app.modules.scheduling.service import create_appointment

        svc = Service(
            name="Funilaria Fallback",
            department="bodywork",
            base_price=200.00,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(svc)
        origin = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="APPT2B34",
            department="bodywork",
            status="completed",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://example.com/o2.jpg"]),
            created_by_id=test_user.id,
        )
        db_session.add(origin)
        await db_session.commit()
        await db_session.refresh(origin)

        data = AppointmentCreate(
            store_id=test_store.id,
            department="bodywork",
            delivery_date=_date(2030, 6, 15),
            delivery_time=_time(10, 0),
            vehicle_plate="APPT2B34",
            service_ids=[svc.id],
            is_return=True,  # SEM original_service_order_id → resolve por placa
        )
        resp = await create_appointment(db_session, data, test_owner)
        assert resp.original_service_order_id == origin.id


class TestReturnsExportPdf:
    @pytest.mark.asyncio
    async def test_export_returns_pdf(self, owner_client: AsyncClient):
        resp = await owner_client.get(
            "/api/v1/installer-performance/export/returns",
            params={"start": "2026-07-01", "end": "2026-07-31"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == "application/pdf"
        assert len(resp.content) > 0


class TestOriginLinkScopeWrite:
    """
    Valida a escrita de original_service_order_id: a origem é ACEITA quando está em
    outra loja da MESMA MARCA (retorno cross-loja) e DESCARTADA silenciosamente
    quando não existe ou pertence a uma loja de OUTRA marca — previne FK
    IntegrityError e vazamento de ids cross-marca.
    """

    @pytest.mark.asyncio
    async def test_create_keeps_origin_cross_store_same_brand(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        second_store: Store,
        test_user: User,
        test_brand: Brand,
    ):
        """
        Usuário restrito à loja test_store cria uma O.S. de retorno com
        original_service_order_id apontando para uma O.S. em second_store — outra
        loja da MESMA MARCA. O backend deve MANTER o vínculo (retorno cross-loja).
        """
        from app.modules.dealerships.models import Dealership

        # Serviço na marca do test_store
        service = Service(
            name="Película Scope Write",
            department="film",
            base_price=100.00,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(service)

        # Concessionária para poder abrir O.S. film via API
        dealership = Dealership(
            name="Toyota Scope",
            store_id=test_store.id,
            brand="Toyota",
            address="Av. Scope, 1",
            is_active=True,
        )
        db_session.add(dealership)

        # O.S. de "origem" na second_store — outra loja da MESMA MARCA
        out_of_scope_origin = ServiceOrder(
            store_id=second_store.id,
            vehicle_plate="OUT1A23",
            department="film",
            status="completed",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://example.com/out1.jpg"]),
            created_by_id=test_user.id,
        )
        db_session.add(out_of_scope_origin)
        await db_session.commit()
        await db_session.refresh(out_of_scope_origin)

        resp = await authenticated_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": dealership.id,
                "vehicle_plate": "RET1B23",
                "vehicle_brand": "Toyota",
                "vehicle_model": "Corolla",
                "vehicle_color": "Preto",
                "vehicle_year": 2024,
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/p1.jpg"],
                "items": [{"service_id": service.id, "quantity": 1}],
                "is_return": True,
                "original_service_order_id": out_of_scope_origin.id,
            },
        )

        assert resp.status_code == 201, resp.text
        data = resp.json()
        # Origem em outra loja da mesma marca → vínculo MANTIDO (retorno cross-loja)
        assert data["original_service_order_id"] == out_of_scope_origin.id

    @pytest.mark.asyncio
    async def test_create_drops_origin_cross_brand(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_brand: Brand,
    ):
        """Origem numa loja de OUTRA marca → vínculo descartado (sem vazamento cross-marca).

        Retorno sem origem definitiva exige Owner + observação (regra nova) — usa
        owner_client e preenche `notes` para isolar o teste na trava de escopo/marca.
        """
        from app.modules.dealerships.models import Dealership

        service = Service(
            name="Película Cross Brand",
            department="film",
            base_price=100.00,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(service)

        dealership = Dealership(
            name="Toyota Cross Brand",
            store_id=test_store.id,
            brand="Toyota",
            address="Av. Cross, 1",
            is_active=True,
        )
        db_session.add(dealership)

        # Loja de OUTRA marca com a O.S. de origem
        other_brand = Brand(name="BYD", code="byd", is_active=True)
        db_session.add(other_brand)
        await db_session.flush()
        other_brand_store = Store(
            name="BYD Unidade 05", code="LJBYD", is_active=True, brand_id=other_brand.id
        )
        db_session.add(other_brand_store)
        await db_session.flush()

        cross_brand_origin = ServiceOrder(
            store_id=other_brand_store.id,
            vehicle_plate="XBR1A23",
            department="film",
            status="completed",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://example.com/xbr.jpg"]),
            created_by_id=test_user.id,
        )
        db_session.add(cross_brand_origin)
        await db_session.commit()
        await db_session.refresh(cross_brand_origin)

        resp = await owner_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": dealership.id,
                "vehicle_plate": "XBR1A23",
                "vehicle_brand": "Toyota",
                "vehicle_model": "Corolla",
                "vehicle_color": "Preto",
                "vehicle_year": 2024,
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/xbr.jpg"],
                "items": [{"service_id": service.id, "quantity": 1}],
                "is_return": True,
                "original_service_order_id": cross_brand_origin.id,
                "notes": "Origem de outra marca — vínculo esperado descartado",
            },
        )

        assert resp.status_code == 201, resp.text
        # Origem em loja de outra marca → descartado
        assert resp.json()["original_service_order_id"] is None

    @pytest.mark.asyncio
    async def test_create_drops_origin_when_nonexistent(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_brand: Brand,
    ):
        """original_service_order_id apontando para um id que não existe → link descartado.

        Retorno sem origem definitiva exige Owner + observação (regra nova) — usa
        owner_client e preenche `notes` para isolar o teste na trava de escopo.
        """
        from app.modules.dealerships.models import Dealership

        service2 = Service(
            name="Película Nonexistent Origin",
            department="film",
            base_price=100.00,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(service2)

        dealership2 = Dealership(
            name="Toyota Nonexistent",
            store_id=test_store.id,
            brand="Toyota",
            address="Av. None, 2",
            is_active=True,
        )
        db_session.add(dealership2)
        await db_session.commit()

        resp = await owner_client.post(
            "/api/v1/service-orders",
            json={
                "store_id": test_store.id,
                "dealership_id": dealership2.id,
                "vehicle_plate": "NON1C34",
                "vehicle_brand": "Toyota",
                "vehicle_model": "Yaris",
                "vehicle_color": "Branco",
                "vehicle_year": 2024,
                "department": "film",
                "entry_time": datetime.now(UTC).isoformat(),
                "photos": ["http://localhost:8000/uploads/p2.jpg"],
                "items": [{"service_id": service2.id, "quantity": 1}],
                "is_return": True,
                "original_service_order_id": 9999999,
                "notes": "Origem inexistente — vínculo esperado descartado",
            },
        )

        assert resp.status_code == 201, resp.text
        assert resp.json()["original_service_order_id"] is None

    @pytest.mark.asyncio
    async def test_update_keeps_origin_cross_store_same_brand(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        second_store: Store,
        test_user: User,
        test_brand: Brand,
    ):
        """
        Editar uma O.S. de retorno enviando original_service_order_id de outra loja
        da MESMA MARCA → o vínculo deve ser MANTIDO na persistência.
        """
        # O.S. de retorno na loja acessível ao usuário
        return_os = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="UPD1D45",
            department="film",
            status="waiting",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://example.com/upd1.jpg"]),
            is_return=True,
            created_by_id=test_user.id,
        )
        db_session.add(return_os)

        # "Origem" em outra loja da MESMA MARCA
        other_origin = ServiceOrder(
            store_id=second_store.id,
            vehicle_plate="UPD1D45",
            department="film",
            status="completed",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://example.com/upd2.jpg"]),
            created_by_id=test_user.id,
        )
        db_session.add(other_origin)
        await db_session.commit()
        await db_session.refresh(return_os)
        await db_session.refresh(other_origin)

        resp = await authenticated_client.patch(
            f"/api/v1/service-orders/{return_os.id}",
            json={"original_service_order_id": other_origin.id},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["original_service_order_id"] == other_origin.id

    @pytest.mark.asyncio
    async def test_update_drops_origin_cross_brand(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_brand: Brand,
    ):
        """Editar enviando origem de loja de OUTRA marca → vínculo descartado (None).

        Retorno sem origem definitiva exige Owner + observação (regra nova) — usa
        owner_client e preenche `notes` no PATCH para isolar o teste na trava de
        escopo/marca.
        """
        return_os = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="UPX1D45",
            department="film",
            status="waiting",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://example.com/upx1.jpg"]),
            is_return=True,
            created_by_id=test_user.id,
        )
        db_session.add(return_os)

        other_brand = Brand(name="Hyundai", code="hyundai", is_active=True)
        db_session.add(other_brand)
        await db_session.flush()
        other_brand_store = Store(
            name="Hyundai Centro", code="LJHYU", is_active=True, brand_id=other_brand.id
        )
        db_session.add(other_brand_store)
        await db_session.flush()

        cross_brand_origin = ServiceOrder(
            store_id=other_brand_store.id,
            vehicle_plate="UPX1D45",
            department="film",
            status="completed",
            entry_time=datetime.now(UTC),
            photos=json.dumps(["http://example.com/upx2.jpg"]),
            created_by_id=test_user.id,
        )
        db_session.add(cross_brand_origin)
        await db_session.commit()
        await db_session.refresh(return_os)
        await db_session.refresh(cross_brand_origin)

        resp = await owner_client.patch(
            f"/api/v1/service-orders/{return_os.id}",
            json={
                "original_service_order_id": cross_brand_origin.id,
                "notes": "Origem de outra marca — vínculo esperado descartado",
            },
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["original_service_order_id"] is None
