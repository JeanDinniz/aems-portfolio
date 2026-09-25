"""
Testes do relato técnico do instalador (`execution_notes`) na finalização de O.S.

`execution_notes` é distinto de `notes` (briefing do consultor, copiado do
agendamento): é preenchido pelo instalador ao finalizar, texto livre (até 2000
caracteres), normalizado (strip + vazio vira None) e só sobrescrito quando o
campo é explicitamente enviado no request — um finalize sem o campo (clientes
antigos, retry) não pode apagar um relato já gravado.
"""

from datetime import UTC, datetime

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.modules.auth.models import User
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem
from app.modules.services.models import Service
from app.modules.stores.models import Store


@pytest_asyncio.fixture
async def workshop_service(db_session: AsyncSession, test_brand) -> Service:
    svc = Service(
        name="Polimento Técnico",
        code="POLX1",
        department="workshop",
        base_price=150.00,
        is_active=True,
        brand_id=test_brand.id,
    )
    db_session.add(svc)
    await db_session.commit()
    await db_session.refresh(svc)
    return svc


@pytest_asyncio.fixture
async def workshop_os(
    db_session: AsyncSession,
    test_store: Store,
    test_user: User,
    workshop_service: Service,
) -> ServiceOrder:
    """O.S. de oficina em andamento — departamento sem exigência de bobina/instalador
    por serviço, simplifica o cenário de finalize para estes testes."""
    so = ServiceOrder(
        store_id=test_store.id,
        vehicle_plate="EXN1A23",
        department="workshop",
        status="in_progress",
        is_courtesy=False,
        is_galpon=False,
        is_return=False,
        entry_time=datetime(2026, 7, 10, 8, 0, tzinfo=UTC),
        start_time=datetime(2026, 7, 10, 8, 30, tzinfo=UTC),
        created_by_id=test_user.id,
    )
    db_session.add(so)
    await db_session.flush()
    db_session.add(
        ServiceOrderItem(
            service_order_id=so.id,
            service_id=workshop_service.id,
            unit_price=workshop_service.base_price,
            quantity=1,
        )
    )
    await db_session.commit()
    await db_session.refresh(so)
    return so


class TestFinalizeExecutionNotes:
    @pytest.mark.asyncio
    async def test_finalize_salva_execution_notes(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        workshop_os: ServiceOrder,
    ):
        response = await owner_client.post(
            f"/api/v1/service-orders/{workshop_os.id}/finalize",
            json={
                "completion_photos": [],
                "execution_notes": "Aplicado polimento em 2 etapas, sem retrabalho.",
            },
        )
        assert response.status_code == 200, response.text
        assert (
            response.json()["execution_notes"] == "Aplicado polimento em 2 etapas, sem retrabalho."
        )

        await db_session.refresh(workshop_os)
        assert workshop_os.execution_notes == "Aplicado polimento em 2 etapas, sem retrabalho."

    @pytest.mark.asyncio
    async def test_string_vazia_ou_so_espacos_vira_none(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        workshop_os: ServiceOrder,
    ):
        response = await owner_client.post(
            f"/api/v1/service-orders/{workshop_os.id}/finalize",
            json={"completion_photos": [], "execution_notes": "   "},
        )
        assert response.status_code == 200, response.text
        assert response.json()["execution_notes"] is None

        await db_session.refresh(workshop_os)
        assert workshop_os.execution_notes is None

    @pytest.mark.asyncio
    async def test_texto_acima_de_2000_caracteres_falha(
        self,
        owner_client: AsyncClient,
        workshop_os: ServiceOrder,
    ):
        response = await owner_client.post(
            f"/api/v1/service-orders/{workshop_os.id}/finalize",
            json={"completion_photos": [], "execution_notes": "x" * 2001},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_finalize_sem_o_campo_nao_apaga_valor_existente(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        workshop_os: ServiceOrder,
    ):
        """Um finalize disparado sem `execution_notes` (cliente antigo, retry) não
        pode apagar um relato já gravado."""
        workshop_os.execution_notes = "Relato original do instalador"
        db_session.add(workshop_os)
        await db_session.commit()

        response = await owner_client.post(
            f"/api/v1/service-orders/{workshop_os.id}/finalize",
            json={"completion_photos": []},
        )
        assert response.status_code == 200, response.text
        assert response.json()["execution_notes"] == "Relato original do instalador"

        await db_session.refresh(workshop_os)
        assert workshop_os.execution_notes == "Relato original do instalador"


class TestUpdateExecutionNotes:
    @pytest.mark.asyncio
    async def test_patch_grava_e_audita_valor_anterior(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        workshop_os: ServiceOrder,
    ):
        """Edição do relato pelo gestor fica rastreável no AuditLog (old/new)."""
        workshop_os.execution_notes = "Relato original"
        db_session.add(workshop_os)
        await db_session.commit()
        so_id = workshop_os.id

        response = await owner_client.patch(
            f"/api/v1/service-orders/{so_id}",
            json={"execution_notes": "  Relato corrigido  "},
        )
        assert response.status_code == 200, response.text
        assert response.json()["execution_notes"] == "Relato corrigido"

        await db_session.rollback()
        log = (
            (
                await db_session.execute(
                    select(AuditLog)
                    .where(
                        AuditLog.action == "update",
                        AuditLog.resource_type == "service_order",
                        AuditLog.resource_id == so_id,
                    )
                    .order_by(AuditLog.id.desc())
                )
            )
            .scalars()
            .first()
        )
        assert log is not None
        assert log.old_value["execution_notes"] == "Relato original"
        assert log.new_value["execution_notes"] == "Relato corrigido"

    @pytest.mark.asyncio
    async def test_patch_string_vazia_limpa_relato(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        workshop_os: ServiceOrder,
    ):
        workshop_os.execution_notes = "Relato a limpar"
        db_session.add(workshop_os)
        await db_session.commit()

        response = await owner_client.patch(
            f"/api/v1/service-orders/{workshop_os.id}",
            json={"execution_notes": ""},
        )
        assert response.status_code == 200, response.text
        assert response.json()["execution_notes"] is None

    @pytest.mark.asyncio
    async def test_tipo_invalido_retorna_422_nao_500(
        self,
        owner_client: AsyncClient,
        workshop_os: ServiceOrder,
    ):
        response = await owner_client.post(
            f"/api/v1/service-orders/{workshop_os.id}/finalize",
            json={"completion_photos": [], "execution_notes": 123},
        )
        assert response.status_code == 422
