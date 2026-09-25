"""
Testes da validação de departamento dos serviços em agendamentos.

Regra: todos os serviços de um agendamento (service_ids + film_entries) devem
pertencer ao departamento do agendamento. Sem isso, trocar o departamento na
edição mantendo películas antigas cria agendamentos mistos — e a finalização
passa a tratar bobinas de película como opcionais quando o departamento do
agendamento não é film. A validação roda em create/update (estado final do
agendamento); generate-os não bloqueia legados mistos.
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.services.models import Service
from app.modules.stores.models import Store

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def film_service(db_session: AsyncSession, test_brand) -> Service:
    service = Service(
        name="Película lateral e traseira",
        code="WP 1",
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
async def ppf_service(db_session: AsyncSession, test_brand) -> Service:
    service = Service(
        name="Parachoque inteiro",
        code="PPF KIT7",
        department="ppf",
        base_price=900.00,
        is_active=True,
        brand_id=test_brand.id,
    )
    db_session.add(service)
    await db_session.commit()
    await db_session.refresh(service)
    return service


@pytest_asyncio.fixture
async def workshop_service(db_session: AsyncSession, test_brand) -> Service:
    service = Service(
        name="Lavagem completa",
        department="workshop",
        base_price=100.00,
        is_active=True,
        brand_id=test_brand.id,
    )
    db_session.add(service)
    await db_session.commit()
    await db_session.refresh(service)
    return service


def _payload(store_id: int, department: str, **overrides) -> dict:
    base = {
        "store_id": store_id,
        "department": department,
        "delivery_date": "2030-01-15",
        "delivery_time": "10:00:00",
        "vehicle_plate": "ABC1D23",
        "vehicle_model": "Corolla",
        "vehicle_color": "Preto",
    }
    base.update(overrides)
    return base


async def _create_appointment(
    owner_client: AsyncClient, store: Store, department: str, **overrides
) -> dict:
    response = await owner_client.post(
        "/api/v1/scheduling/", json=_payload(store.id, department, **overrides)
    )
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


class TestCreateValidaDepartamento:
    @pytest.mark.asyncio
    async def test_film_entry_de_outro_departamento_rejeita(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        film_service: Service,
        ppf_service: Service,
    ):
        """Agendamento PPF com película comum misturada é bloqueado."""
        response = await owner_client.post(
            "/api/v1/scheduling/",
            json=_payload(
                test_store.id,
                "ppf",
                service_ids=[ppf_service.id, film_service.id],
                film_entries=[
                    {"service_id": ppf_service.id},
                    {"service_id": film_service.id, "tonality": "G20"},
                ],
            ),
        )
        assert response.status_code == 422
        assert "não pertencem ao departamento" in response.text

    @pytest.mark.asyncio
    async def test_service_ids_de_outro_departamento_rejeita(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        film_service: Service,
    ):
        response = await owner_client.post(
            "/api/v1/scheduling/",
            json=_payload(test_store.id, "workshop", service_ids=[film_service.id]),
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_service_id_inexistente_rejeita(
        self, owner_client: AsyncClient, test_store: Store
    ):
        response = await owner_client.post(
            "/api/v1/scheduling/",
            json=_payload(test_store.id, "workshop", service_ids=[999999]),
        )
        assert response.status_code == 422
        assert "inexistentes" in response.text

    @pytest.mark.asyncio
    async def test_servicos_do_departamento_correto_passa(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        film_service: Service,
    ):
        data = await _create_appointment(
            owner_client,
            test_store,
            "film",
            service_ids=[film_service.id],
            film_entries=[{"service_id": film_service.id, "tonality": "G20"}],
        )
        assert data["department"] == "film"

    @pytest.mark.asyncio
    async def test_sem_servicos_passa(self, owner_client: AsyncClient, test_store: Store):
        """Agendamento sem serviços não dispara a validação."""
        await _create_appointment(owner_client, test_store, "workshop")


# ---------------------------------------------------------------------------
# Update — valida o estado FINAL do agendamento
# ---------------------------------------------------------------------------


class TestUpdateValidaDepartamento:
    @pytest.mark.asyncio
    async def test_trocar_departamento_mantendo_servicos_rejeita(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        film_service: Service,
    ):
        """Cenário do bug: trocar o departamento sem trocar as películas."""
        appt = await _create_appointment(
            owner_client,
            test_store,
            "film",
            service_ids=[film_service.id],
            film_entries=[{"service_id": film_service.id, "tonality": "G20"}],
        )
        response = await owner_client.patch(
            f"/api/v1/scheduling/{appt['id']}", json={"department": "ppf"}
        )
        assert response.status_code == 422
        assert "não pertencem ao departamento" in response.text

    @pytest.mark.asyncio
    async def test_adicionar_servico_de_outro_departamento_rejeita(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        ppf_service: Service,
        film_service: Service,
    ):
        appt = await _create_appointment(
            owner_client,
            test_store,
            "ppf",
            service_ids=[ppf_service.id],
            film_entries=[{"service_id": ppf_service.id}],
        )
        response = await owner_client.patch(
            f"/api/v1/scheduling/{appt['id']}",
            json={
                "service_ids": [ppf_service.id, film_service.id],
                "film_entries": [
                    {"service_id": ppf_service.id},
                    {"service_id": film_service.id, "tonality": "G20"},
                ],
            },
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_trocar_departamento_e_servicos_juntos_passa(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        film_service: Service,
        ppf_service: Service,
    ):
        appt = await _create_appointment(
            owner_client,
            test_store,
            "film",
            service_ids=[film_service.id],
            film_entries=[{"service_id": film_service.id, "tonality": "G20"}],
        )
        response = await owner_client.patch(
            f"/api/v1/scheduling/{appt['id']}",
            json={
                "department": "ppf",
                "service_ids": [ppf_service.id],
                "film_entries": [{"service_id": ppf_service.id}],
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["department"] == "ppf"

    @pytest.mark.asyncio
    async def test_editar_outros_campos_com_servicos_consistentes_passa(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        workshop_service: Service,
    ):
        appt = await _create_appointment(
            owner_client, test_store, "workshop", service_ids=[workshop_service.id]
        )
        response = await owner_client.patch(
            f"/api/v1/scheduling/{appt['id']}", json={"notes": "Cliente busca 16h"}
        )
        assert response.status_code == 200, response.text
