"""
Testes do agendamento combinado multi-departamento (POST /scheduling/combined).

Um carro com serviços de N departamentos → N agendamentos vinculados por
appointment_group_id (transacional: erro em uma entry aborta o conjunto).
Cada irmão segue o fluxo normal de O.S. de forma independente.
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.scheduling.models import Appointment
from app.modules.services.models import Service
from app.modules.stores.models import Store


@pytest_asyncio.fixture
async def combo_film_service(db_session: AsyncSession, test_brand) -> Service:
    service = Service(
        name="Película lateral e traseira",
        code="WP1",
        department="film",
        base_price=400.00,
        is_active=True,
        brand_id=test_brand.id,
    )
    db_session.add(service)
    await db_session.commit()
    await db_session.refresh(service)
    return service


@pytest_asyncio.fixture
async def combo_security_service(db_session: AsyncSession, test_brand) -> Service:
    service = Service(
        name="Película segurança lateral",
        code="PS16",
        department="security_film",
        base_price=800.00,
        is_active=True,
        brand_id=test_brand.id,
    )
    db_session.add(service)
    await db_session.commit()
    await db_session.refresh(service)
    return service


def _combined_payload(store_id: int, departments: list[dict], **overrides) -> dict:
    base = {
        "store_id": store_id,
        "delivery_date": "2030-01-15",
        "delivery_time": "10:00:00",
        "vehicle_plate": "CMB1D23",
        "vehicle_model": "Fastback",
        "vehicle_color": "Azul",
        "departments": departments,
    }
    base.update(overrides)
    return base


class TestCreateCombined:
    @pytest.mark.asyncio
    async def test_two_departments_create_linked_appointments(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        combo_film_service: Service,
        combo_security_service: Service,
    ):
        """2 departamentos → 2 agendamentos com o mesmo group_id e irmãos expostos."""
        response = await owner_client.post(
            "/api/v1/scheduling/combined",
            json=_combined_payload(
                test_store.id,
                [
                    {
                        "department": "film",
                        "film_entries": [
                            {"service_id": combo_film_service.id, "tonality": "G20"}
                        ],
                    },
                    {
                        "department": "security_film",
                        "film_entries": [
                            {"service_id": combo_security_service.id, "tonality": "Incolor"}
                        ],
                    },
                ],
            ),
        )
        assert response.status_code == 201, response.text
        items = response.json()["items"]
        assert len(items) == 2

        group_ids = {item["appointment_group_id"] for item in items}
        assert len(group_ids) == 1
        assert group_ids != {None}

        departments = {item["department"] for item in items}
        assert departments == {"film", "security_film"}

        # Irmãos expostos em cada item
        for item in items:
            siblings = item["group_siblings"]
            assert siblings is not None and len(siblings) == 1
            assert siblings[0]["id"] != item["id"]

    @pytest.mark.asyncio
    async def test_error_in_one_entry_creates_nothing(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        combo_film_service: Service,
    ):
        """Serviço de departamento errado em UMA entry → rollback total."""
        response = await owner_client.post(
            "/api/v1/scheduling/combined",
            json=_combined_payload(
                test_store.id,
                [
                    {
                        "department": "film",
                        "film_entries": [
                            {"service_id": combo_film_service.id, "tonality": "G20"}
                        ],
                    },
                    {
                        # película comum lançada como security_film → 422
                        "department": "security_film",
                        "film_entries": [
                            {"service_id": combo_film_service.id, "tonality": "G05"}
                        ],
                    },
                ],
                vehicle_plate="RLB1K99",
            ),
        )
        assert response.status_code == 422

        created = list(
            (
                await db_session.execute(
                    select(Appointment).where(Appointment.vehicle_plate == "RLB1K99")
                )
            ).scalars()
        )
        assert created == []

    @pytest.mark.asyncio
    async def test_single_department_has_no_group(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        combo_film_service: Service,
    ):
        """1 departamento só → agendamento avulso, sem group_id."""
        response = await owner_client.post(
            "/api/v1/scheduling/combined",
            json=_combined_payload(
                test_store.id,
                [
                    {
                        "department": "film",
                        "film_entries": [
                            {"service_id": combo_film_service.id, "tonality": "G20"}
                        ],
                    }
                ],
            ),
        )
        assert response.status_code == 201
        items = response.json()["items"]
        assert len(items) == 1
        assert items[0]["appointment_group_id"] is None
        assert items[0]["group_siblings"] is None

    @pytest.mark.asyncio
    async def test_duplicate_departments_rejected(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        combo_film_service: Service,
    ):
        response = await owner_client.post(
            "/api/v1/scheduling/combined",
            json=_combined_payload(
                test_store.id,
                [
                    {
                        "department": "film",
                        "film_entries": [
                            {"service_id": combo_film_service.id, "tonality": "G20"}
                        ],
                    },
                    {
                        "department": "film",
                        "film_entries": [
                            {"service_id": combo_film_service.id, "tonality": "G05"}
                        ],
                    },
                ],
            ),
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_entry_without_services_rejected(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        combo_film_service: Service,
    ):
        response = await owner_client.post(
            "/api/v1/scheduling/combined",
            json=_combined_payload(
                test_store.id,
                [
                    {
                        "department": "film",
                        "film_entries": [
                            {"service_id": combo_film_service.id, "tonality": "G20"}
                        ],
                    },
                    {"department": "security_film"},
                ],
            ),
        )
        assert response.status_code == 422
        assert "ao menos um serviço" in response.text


class TestGroupBehavior:
    async def _create_group(
        self,
        owner_client: AsyncClient,
        store: Store,
        film_service: Service,
        security_service: Service,
        plate: str = "GRP1A23",
    ) -> list[dict]:
        response = await owner_client.post(
            "/api/v1/scheduling/combined",
            json=_combined_payload(
                store.id,
                [
                    {
                        "department": "film",
                        "film_entries": [{"service_id": film_service.id, "tonality": "G20"}],
                    },
                    {
                        "department": "security_film",
                        "film_entries": [
                            {"service_id": security_service.id, "tonality": "Incolor"}
                        ],
                    },
                ],
                vehicle_plate=plate,
            ),
        )
        assert response.status_code == 201, response.text
        return response.json()["items"]

    @pytest.mark.asyncio
    async def test_list_returns_group_siblings(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        combo_film_service: Service,
        combo_security_service: Service,
    ):
        items = await self._create_group(
            owner_client, test_store, combo_film_service, combo_security_service
        )
        response = await owner_client.get("/api/v1/scheduling/", params={"limit": 100})
        assert response.status_code == 200
        listed = {
            item["id"]: item
            for item in response.json()["items"]
            if item["id"] in {i["id"] for i in items}
        }
        assert len(listed) == 2
        for item in listed.values():
            assert item["group_siblings"] is not None
            assert len(item["group_siblings"]) == 1

    @pytest.mark.asyncio
    async def test_cancel_one_sibling_keeps_the_other(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        combo_film_service: Service,
        combo_security_service: Service,
    ):
        items = await self._create_group(
            owner_client,
            test_store,
            combo_film_service,
            combo_security_service,
            plate="GRP2B34",
        )
        first, second = items
        response = await owner_client.request(
            "DELETE",
            f"/api/v1/scheduling/{first['id']}",
            json={"cancellation_reason": "Cliente desistiu da película comum"},
        )
        assert response.status_code == 200, response.text

        detail = await owner_client.get(f"/api/v1/scheduling/{second['id']}")
        assert detail.status_code == 200
        body = detail.json()
        assert body["status"] == "scheduled"
        # O irmão cancelado continua visível no vínculo, com status de cancelado
        sibling = body["group_siblings"][0]
        assert sibling["id"] == first["id"]
        assert sibling["display_status"] == "cancelado"

    @pytest.mark.asyncio
    async def test_update_cannot_change_group_id(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        combo_film_service: Service,
        combo_security_service: Service,
    ):
        items = await self._create_group(
            owner_client,
            test_store,
            combo_film_service,
            combo_security_service,
            plate="GRP3C45",
        )
        appt = items[0]
        response = await owner_client.patch(
            f"/api/v1/scheduling/{appt['id']}",
            json={"notes": "Ajuste", "appointment_group_id": "hack"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["appointment_group_id"] == appt["appointment_group_id"]


class TestAddDepartments:
    """POST /scheduling/{id}/add-departments — combinar na edição."""

    async def _standalone_film(
        self, owner_client: AsyncClient, store: Store, film_service: Service, plate: str
    ) -> dict:
        """Cria um agendamento avulso de película (sem group_id)."""
        response = await owner_client.post(
            "/api/v1/scheduling/combined",
            json=_combined_payload(
                store.id,
                [
                    {
                        "department": "film",
                        "film_entries": [{"service_id": film_service.id, "tonality": "G20"}],
                    }
                ],
                vehicle_plate=plate,
            ),
        )
        assert response.status_code == 201, response.text
        item = response.json()["items"][0]
        assert item["appointment_group_id"] is None
        return item

    @pytest.mark.asyncio
    async def test_add_department_links_standalone_into_group(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        combo_film_service: Service,
        combo_security_service: Service,
    ):
        """Avulso + novo depto → ambos ganham o mesmo group_id."""
        base = await self._standalone_film(
            owner_client, test_store, combo_film_service, "ADD1D23"
        )
        response = await owner_client.post(
            f"/api/v1/scheduling/{base['id']}/add-departments",
            json={
                "departments": [
                    {
                        "department": "security_film",
                        "film_entries": [
                            {"service_id": combo_security_service.id, "tonality": "Incolor"}
                        ],
                    }
                ]
            },
        )
        assert response.status_code == 200, response.text
        items = response.json()["items"]
        assert len(items) == 1
        new_group = items[0]["appointment_group_id"]
        assert new_group is not None
        assert items[0]["department"] == "security_film"
        # O novo herda os dados do veículo do base
        assert items[0]["vehicle_plate"] == "ADD1D23"

        # O base foi vinculado ao mesmo grupo
        detail = await owner_client.get(f"/api/v1/scheduling/{base['id']}")
        assert detail.status_code == 200
        assert detail.json()["appointment_group_id"] == new_group

    @pytest.mark.asyncio
    async def test_add_existing_department_rejected(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        combo_film_service: Service,
    ):
        """Departamento já presente no agendamento → 422."""
        base = await self._standalone_film(
            owner_client, test_store, combo_film_service, "ADD2E34"
        )
        response = await owner_client.post(
            f"/api/v1/scheduling/{base['id']}/add-departments",
            json={
                "departments": [
                    {
                        "department": "film",
                        "film_entries": [{"service_id": combo_film_service.id, "tonality": "G05"}],
                    }
                ]
            },
        )
        assert response.status_code == 422
        assert "já existe" in response.text

    @pytest.mark.asyncio
    async def test_add_department_reuses_existing_group(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_brand,
        combo_film_service: Service,
        combo_security_service: Service,
    ):
        """Base já combinado → o novo depto entra no mesmo grupo existente."""
        # Serviço de funilaria (não-película, só precisa de service_ids)
        bodywork = Service(
            name="Reparo de para-choque",
            code="FUN1",
            department="bodywork",
            base_price=300.00,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(bodywork)
        await db_session.commit()
        await db_session.refresh(bodywork)

        # Cria um grupo film + security_film
        response = await owner_client.post(
            "/api/v1/scheduling/combined",
            json=_combined_payload(
                test_store.id,
                [
                    {
                        "department": "film",
                        "film_entries": [{"service_id": combo_film_service.id, "tonality": "G20"}],
                    },
                    {
                        "department": "security_film",
                        "film_entries": [
                            {"service_id": combo_security_service.id, "tonality": "Incolor"}
                        ],
                    },
                ],
                vehicle_plate="ADD3F45",
            ),
        )
        assert response.status_code == 201, response.text
        base = response.json()["items"][0]
        group = base["appointment_group_id"]
        assert group is not None

        # Adiciona funilaria — deve entrar no MESMO grupo existente
        added = await owner_client.post(
            f"/api/v1/scheduling/{base['id']}/add-departments",
            json={"departments": [{"department": "bodywork", "service_ids": [bodywork.id]}]},
        )
        assert added.status_code == 200, added.text
        item = added.json()["items"][0]
        assert item["department"] == "bodywork"
        assert item["appointment_group_id"] == group
