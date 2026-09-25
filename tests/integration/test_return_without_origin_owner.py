"""Retorno (`is_return=True`) SEM O.S. de origem vinculada, após a resolução
automática por placa/marca: só o Owner pode lançar/editar, e mesmo assim
precisa preencher a observação (motivo). Retornos COM origem (explícita ou
resolvida por placa), cortesias e O.S. normais não são afetados.

Cobre:
- o helper puro `validate_return_without_origin` (sem DB);
- `create_service_order` / `update_service_order`;
- `create_appointment` / `update_appointment` / `generate_service_order`.
"""

import json
from dataclasses import dataclass
from datetime import UTC, date, datetime, time

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AuthorizationError, ValidationError
from app.modules.auth.models import User
from app.modules.brands.models import Brand
from app.modules.dealerships.models import Dealership
from app.modules.scheduling.schemas import AppointmentCreate, AppointmentUpdate, GenerateOSRequest
from app.modules.scheduling.service import (
    create_appointment,
    generate_service_order,
    update_appointment,
)
from app.modules.service_orders.models import ServiceOrder
from app.modules.service_orders.schemas import ServiceOrderUpdate
from app.modules.service_orders.service import (
    update_service_order,
    validate_return_without_origin,
)
from app.modules.services.models import Service
from app.modules.stores.models import Store


@dataclass
class _FakeUser:
    """Stub mínimo — `is_owner`/`validate_return_without_origin` só leem `.role`."""

    role: str


async def _make_dealership(db_session: AsyncSession, store_id: int) -> Dealership:
    dealership = Dealership(
        name="Concessionária Teste Retorno",
        store_id=store_id,
        brand="Marca Teste",
        address="Rua Teste, 1",
        is_active=True,
    )
    db_session.add(dealership)
    await db_session.flush()
    return dealership


async def _make_os(
    db_session: AsyncSession,
    *,
    store_id: int,
    user_id: int,
    plate: str,
    status: str = "waiting",
    is_return: bool = False,
) -> ServiceOrder:
    os_obj = ServiceOrder(
        store_id=store_id,
        vehicle_plate=plate,
        department="film",
        status=status,
        is_return=is_return,
        entry_time=datetime.now(UTC),
        photos=json.dumps(["http://localhost:8000/uploads/x.jpg"]),
        created_by_id=user_id,
    )
    db_session.add(os_obj)
    await db_session.commit()
    await db_session.refresh(os_obj)
    return os_obj


# =============================================================================
# Helper puro (sem DB) — a fonte única da regra
# =============================================================================


class TestValidateReturnWithoutOriginHelper:
    def test_nao_dispara_quando_nao_e_retorno(self):
        """O.S./agendamento normal (is_return=False) nunca passa pela trava."""
        validate_return_without_origin(
            is_return=False,
            original_service_order_id=None,
            user=_FakeUser("user"),
            notes=None,
        )

    def test_nao_dispara_quando_tem_origem(self):
        """Retorno COM origem (já resolvida) não exige owner nem observação."""
        validate_return_without_origin(
            is_return=True,
            original_service_order_id=42,
            user=_FakeUser("user"),
            notes=None,
        )

    def test_nao_owner_e_bloqueado_mesmo_com_observacao_preenchida(self):
        with pytest.raises(AuthorizationError) as exc_info:
            validate_return_without_origin(
                is_return=True,
                original_service_order_id=None,
                user=_FakeUser("user"),
                notes="Motivo do retorno",
            )
        assert (
            exc_info.value.detail
            == "Somente o Proprietário pode lançar um retorno sem O.S. de origem vinculada."
        )

    def test_owner_sem_observacao_e_bloqueado(self):
        with pytest.raises(ValidationError) as exc_info:
            validate_return_without_origin(
                is_return=True,
                original_service_order_id=None,
                user=_FakeUser("owner"),
                notes=None,
            )
        assert (
            exc_info.value.detail
            == "Informe a observação (motivo) ao lançar um retorno sem O.S. de origem."
        )

    def test_owner_com_observacao_so_espacos_e_bloqueado(self):
        """Observação em branco (whitespace) conta como não preenchida."""
        with pytest.raises(ValidationError):
            validate_return_without_origin(
                is_return=True,
                original_service_order_id=None,
                user=_FakeUser("owner"),
                notes="   ",
            )

    def test_owner_com_observacao_passa(self):
        validate_return_without_origin(
            is_return=True,
            original_service_order_id=None,
            user=_FakeUser("owner"),
            notes="Retrabalho autorizado pelo proprietário",
        )


# =============================================================================
# create_service_order / update_service_order (via API, mesma trilha do router)
# =============================================================================


class TestCreateServiceOrderAPI:
    async def _payload(
        self,
        *,
        store_id: int,
        dealership_id: int,
        service_id: int,
        plate: str,
        is_return: bool = False,
        notes: str | None = None,
        original_service_order_id: int | None = None,
    ) -> dict:
        payload = {
            "store_id": store_id,
            "dealership_id": dealership_id,
            "vehicle_plate": plate,
            "vehicle_brand": "Marca Teste",
            "vehicle_model": "Modelo Teste",
            "vehicle_color": "Prata",
            "vehicle_year": 2023,
            "department": "film",
            "entry_time": datetime.now(UTC).isoformat(),
            "photos": ["http://localhost:8000/uploads/r1.jpg"],
            "items": [{"service_id": service_id, "quantity": 1}],
            "is_return": is_return,
        }
        if notes is not None:
            payload["notes"] = notes
        if original_service_order_id is not None:
            payload["original_service_order_id"] = original_service_order_id
        return payload

    @pytest.mark.asyncio
    async def test_owner_cria_retorno_sem_origem_com_observacao_sucesso(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_brand: Brand,
        test_owner: User,
    ):
        dealership = await _make_dealership(db_session, test_store.id)
        service = Service(
            name="Película Fumê 35% (owner-ok)",
            department="film",
            base_price=150.0,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(service)
        await db_session.commit()
        await db_session.refresh(service)

        payload = await self._payload(
            store_id=test_store.id,
            dealership_id=dealership.id,
            service_id=service.id,
            plate="OWN1A23",
            is_return=True,
            notes="Retorno sem O.S. anterior no sistema (motivo verificado)",
        )
        resp = await owner_client.post("/api/v1/service-orders", json=payload)

        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["is_return"] is True
        assert data["original_service_order_id"] is None

    @pytest.mark.asyncio
    async def test_owner_cria_retorno_sem_origem_sem_observacao_422(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_brand: Brand,
    ):
        dealership = await _make_dealership(db_session, test_store.id)
        service = Service(
            name="Película Fumê 35% (owner-422)",
            department="film",
            base_price=150.0,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(service)
        await db_session.commit()
        await db_session.refresh(service)

        payload = await self._payload(
            store_id=test_store.id,
            dealership_id=dealership.id,
            service_id=service.id,
            plate="OWN2B34",
            is_return=True,
        )
        resp = await owner_client.post("/api/v1/service-orders", json=payload)

        assert resp.status_code == 422, resp.text
        assert (
            resp.json()["detail"]
            == "Informe a observação (motivo) ao lançar um retorno sem O.S. de origem."
        )

    @pytest.mark.asyncio
    async def test_owner_cria_retorno_sem_origem_observacao_so_espacos_422(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_brand: Brand,
    ):
        dealership = await _make_dealership(db_session, test_store.id)
        service = Service(
            name="Película Fumê 35% (owner-whitespace)",
            department="film",
            base_price=150.0,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(service)
        await db_session.commit()
        await db_session.refresh(service)

        payload = await self._payload(
            store_id=test_store.id,
            dealership_id=dealership.id,
            service_id=service.id,
            plate="OWN3C45",
            is_return=True,
            notes="   ",
        )
        resp = await owner_client.post("/api/v1/service-orders", json=payload)

        assert resp.status_code == 422, resp.text

    @pytest.mark.asyncio
    async def test_nao_owner_cria_retorno_sem_origem_com_observacao_403(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_brand: Brand,
    ):
        dealership = await _make_dealership(db_session, test_store.id)
        service = Service(
            name="Película Fumê 35% (nao-owner-403)",
            department="film",
            base_price=150.0,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(service)
        await db_session.commit()
        await db_session.refresh(service)

        payload = await self._payload(
            store_id=test_store.id,
            dealership_id=dealership.id,
            service_id=service.id,
            plate="OWN4D56",
            is_return=True,
            notes="Motivo até preenchido, mas quem lança não é Owner",
        )
        resp = await authenticated_client.post("/api/v1/service-orders", json=payload)

        assert resp.status_code == 403, resp.text
        assert (
            resp.json()["detail"]
            == "Somente o Proprietário pode lançar um retorno sem O.S. de origem vinculada."
        )

    @pytest.mark.asyncio
    async def test_nao_owner_cria_retorno_sem_origem_sem_observacao_ainda_e_403(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_brand: Brand,
    ):
        """A checagem de Owner vem antes da observação — 403, nunca 422, para quem não é Owner."""
        dealership = await _make_dealership(db_session, test_store.id)
        service = Service(
            name="Película Fumê 35% (nao-owner-403-b)",
            department="film",
            base_price=150.0,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(service)
        await db_session.commit()
        await db_session.refresh(service)

        payload = await self._payload(
            store_id=test_store.id,
            dealership_id=dealership.id,
            service_id=service.id,
            plate="OWN5E67",
            is_return=True,
        )
        resp = await authenticated_client.post("/api/v1/service-orders", json=payload)

        assert resp.status_code == 403, resp.text

    @pytest.mark.asyncio
    async def test_retorno_com_origem_resolvida_por_placa_nao_exige_owner_nem_observacao(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_brand: Brand,
        test_user: User,
    ):
        """Com origem encontrada automaticamente pela placa, a regra não dispara —
        nem para quem não é Owner, nem sem observação (fluxo feliz preservado)."""
        plate = "OWN6F78"
        await _make_os(
            db_session,
            store_id=test_store.id,
            user_id=test_user.id,
            plate=plate,
            status="completed",
        )

        dealership = await _make_dealership(db_session, test_store.id)
        service = Service(
            name="Película Fumê 35% (com-origem)",
            department="film",
            base_price=150.0,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(service)
        await db_session.commit()
        await db_session.refresh(service)

        payload = await self._payload(
            store_id=test_store.id,
            dealership_id=dealership.id,
            service_id=service.id,
            plate=plate,
            is_return=True,
        )
        resp = await authenticated_client.post("/api/v1/service-orders", json=payload)

        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["is_return"] is True
        assert data["original_service_order_id"] is not None

    @pytest.mark.asyncio
    async def test_os_normal_nao_afetada(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_brand: Brand,
    ):
        """Lançamento normal (is_return=False) segue livre de observação obrigatória."""
        dealership = await _make_dealership(db_session, test_store.id)
        service = Service(
            name="Película Fumê 35% (normal)",
            department="film",
            base_price=150.0,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(service)
        await db_session.commit()
        await db_session.refresh(service)

        payload = await self._payload(
            store_id=test_store.id,
            dealership_id=dealership.id,
            service_id=service.id,
            plate="OWN7G89",
            is_return=False,
        )
        resp = await authenticated_client.post("/api/v1/service-orders", json=payload)

        assert resp.status_code == 201, resp.text


class TestUpdateServiceOrder:
    @pytest.mark.asyncio
    async def test_nao_owner_editar_para_retorno_sem_origem_403(
        self, db_session: AsyncSession, test_store: Store, test_user: User
    ):
        os_obj = await _make_os(
            db_session, store_id=test_store.id, user_id=test_user.id, plate="UPD1A23"
        )
        with pytest.raises(AuthorizationError):
            await update_service_order(
                db_session,
                os_obj.id,
                ServiceOrderUpdate(is_return=True, notes="Motivo"),
                test_user,
            )

    @pytest.mark.asyncio
    async def test_owner_editar_para_retorno_sem_observacao_422(
        self, db_session: AsyncSession, test_store: Store, test_owner: User, test_user: User
    ):
        os_obj = await _make_os(
            db_session, store_id=test_store.id, user_id=test_user.id, plate="UPD2B34"
        )
        with pytest.raises(ValidationError):
            await update_service_order(
                db_session,
                os_obj.id,
                ServiceOrderUpdate(is_return=True),
                test_owner,
            )

    @pytest.mark.asyncio
    async def test_owner_editar_para_retorno_com_observacao_sucesso(
        self, db_session: AsyncSession, test_store: Store, test_owner: User, test_user: User
    ):
        os_obj = await _make_os(
            db_session, store_id=test_store.id, user_id=test_user.id, plate="UPD3C45"
        )
        updated = await update_service_order(
            db_session,
            os_obj.id,
            ServiceOrderUpdate(is_return=True, notes="Motivo do retorno registrado pelo owner"),
            test_owner,
        )
        assert updated.is_return is True
        assert updated.original_service_order_id is None

    @pytest.mark.asyncio
    async def test_retorno_com_origem_explicita_nao_exige_owner(
        self, db_session: AsyncSession, test_store: Store, test_user: User
    ):
        origin = await _make_os(
            db_session,
            store_id=test_store.id,
            user_id=test_user.id,
            plate="UPD4D56",
            status="completed",
        )
        os_obj = await _make_os(
            db_session, store_id=test_store.id, user_id=test_user.id, plate="UPD5E67"
        )
        updated = await update_service_order(
            db_session,
            os_obj.id,
            ServiceOrderUpdate(is_return=True, original_service_order_id=origin.id),
            test_user,
        )
        assert updated.is_return is True
        assert updated.original_service_order_id == origin.id


# =============================================================================
# Agendamento: create_appointment / update_appointment / generate_service_order
# =============================================================================


class TestCreateAppointment:
    @pytest.mark.asyncio
    async def test_nao_owner_sem_origem_403(
        self, db_session: AsyncSession, test_store: Store, test_user: User
    ):
        with pytest.raises(AuthorizationError):
            await create_appointment(
                db_session,
                AppointmentCreate(
                    store_id=test_store.id,
                    department="film",
                    delivery_date=date(2026, 9, 20),
                    delivery_time=time(10, 0),
                    vehicle_plate="AGN1A23",
                    is_return=True,
                    notes="Motivo preenchido",
                ),
                test_user,
            )

    @pytest.mark.asyncio
    async def test_owner_sem_observacao_422(
        self, db_session: AsyncSession, test_store: Store, test_owner: User
    ):
        with pytest.raises(ValidationError):
            await create_appointment(
                db_session,
                AppointmentCreate(
                    store_id=test_store.id,
                    department="film",
                    delivery_date=date(2026, 9, 20),
                    delivery_time=time(10, 0),
                    vehicle_plate="AGN2B34",
                    is_return=True,
                ),
                test_owner,
            )

    @pytest.mark.asyncio
    async def test_owner_com_observacao_sucesso(
        self, db_session: AsyncSession, test_store: Store, test_owner: User
    ):
        appt = await create_appointment(
            db_session,
            AppointmentCreate(
                store_id=test_store.id,
                department="film",
                delivery_date=date(2026, 9, 20),
                delivery_time=time(10, 0),
                vehicle_plate="AGN3C45",
                is_return=True,
                notes="Retrabalho autorizado pelo proprietário",
            ),
            test_owner,
        )
        assert appt.is_return is True
        assert appt.original_service_order_id is None

    @pytest.mark.asyncio
    async def test_retorno_com_origem_resolvida_por_placa_nao_exige_owner_nem_observacao(
        self, db_session: AsyncSession, test_store: Store, test_user: User
    ):
        plate = "AGN4D56"
        await _make_os(
            db_session,
            store_id=test_store.id,
            user_id=test_user.id,
            plate=plate,
            status="completed",
        )

        appt = await create_appointment(
            db_session,
            AppointmentCreate(
                store_id=test_store.id,
                department="film",
                delivery_date=date(2026, 9, 20),
                delivery_time=time(10, 0),
                vehicle_plate=plate,
                is_return=True,
            ),
            test_user,
        )
        assert appt.original_service_order_id is not None

    @pytest.mark.asyncio
    async def test_agendamento_normal_nao_afetado(
        self, db_session: AsyncSession, test_store: Store, test_user: User
    ):
        appt = await create_appointment(
            db_session,
            AppointmentCreate(
                store_id=test_store.id,
                department="film",
                delivery_date=date(2026, 9, 20),
                delivery_time=time(10, 0),
                vehicle_plate="AGN5E67",
            ),
            test_user,
        )
        assert appt.is_return is False


class TestUpdateAppointment:
    """A trava também vale na edição — sem ela, `linked_os.is_return` é
    reatribuído por setattr direto (fora de `update_service_order`), burlando a
    regra inteira para um agendamento já existente."""

    @pytest.mark.asyncio
    async def test_nao_owner_editar_para_retorno_sem_origem_403(
        self, db_session: AsyncSession, test_store: Store, test_user: User
    ):
        appt = await create_appointment(
            db_session,
            AppointmentCreate(
                store_id=test_store.id,
                department="film",
                delivery_date=date(2026, 9, 21),
                delivery_time=time(9, 0),
                vehicle_plate="AGN6F78",
            ),
            test_user,
        )
        with pytest.raises(AuthorizationError):
            await update_appointment(
                db_session,
                appt.id,
                AppointmentUpdate(is_return=True, notes="Motivo"),
                test_user,
            )

    @pytest.mark.asyncio
    async def test_owner_editar_para_retorno_sem_observacao_422(
        self, db_session: AsyncSession, test_store: Store, test_owner: User, test_user: User
    ):
        appt = await create_appointment(
            db_session,
            AppointmentCreate(
                store_id=test_store.id,
                department="film",
                delivery_date=date(2026, 9, 21),
                delivery_time=time(9, 0),
                vehicle_plate="AGN7G89",
            ),
            test_user,
        )
        with pytest.raises(ValidationError):
            await update_appointment(
                db_session,
                appt.id,
                AppointmentUpdate(is_return=True),
                test_owner,
            )

    @pytest.mark.asyncio
    async def test_owner_editar_para_retorno_com_observacao_sucesso(
        self, db_session: AsyncSession, test_store: Store, test_owner: User, test_user: User
    ):
        appt = await create_appointment(
            db_session,
            AppointmentCreate(
                store_id=test_store.id,
                department="film",
                delivery_date=date(2026, 9, 21),
                delivery_time=time(9, 0),
                vehicle_plate="AGN8H90",
            ),
            test_user,
        )
        updated = await update_appointment(
            db_session,
            appt.id,
            AppointmentUpdate(is_return=True, notes="Motivo do retorno registrado pelo owner"),
            test_owner,
        )
        assert updated.is_return is True
        assert updated.original_service_order_id is None


class TestGenerateServiceOrder:
    @pytest.mark.asyncio
    async def test_gera_os_de_agendamento_retorno_sem_origem_ja_validado_na_criacao(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_brand: Brand,
        test_owner: User,
    ):
        """O agendamento já foi validado (Owner + observação) na criação; gerar a
        O.S. propaga is_return/notes. `generate_service_order` chama
        `create_service_order` com `skip_return_origin_guard=True` — a trava não
        é reaberta (o Owner que gera é o mesmo que autorizou)."""
        service = Service(
            name="Película Fumê 35% (generate-os)",
            department="film",
            base_price=150.0,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(service)
        await _make_dealership(db_session, test_store.id)
        await db_session.commit()
        await db_session.refresh(service)

        appt = await create_appointment(
            db_session,
            AppointmentCreate(
                store_id=test_store.id,
                department="film",
                delivery_date=date(2026, 9, 22),
                delivery_time=time(11, 0),
                vehicle_plate="AGN9I01",
                service_ids=[service.id],
                is_return=True,
                notes="Retorno sem O.S. anterior no sistema (owner)",
            ),
            test_owner,
        )

        service_order = await generate_service_order(
            db_session,
            appt.id,
            GenerateOSRequest(photos=["http://localhost:8000/uploads/g.jpg"]),
            test_owner,
        )

        assert service_order.is_return is True
        assert service_order.original_service_order_id is None
        assert service_order.notes == "Retorno sem O.S. anterior no sistema (owner)"

    @pytest.mark.asyncio
    async def test_nao_owner_gera_os_de_agendamento_retorno_ja_autorizado_pelo_owner(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_brand: Brand,
        test_owner: User,
        test_user: User,
    ):
        """🟠 Ajuste de revisão: o Owner cria o agendamento de retorno SEM origem
        (com observação) — a trava já rodou e aprovou ali. Quando um agendador
        NÃO-Owner clica em "Gerar O.S.", `generate_service_order` deve CONFIAR
        nessa autorização prévia (skip_return_origin_guard=True) em vez de
        reexigir Owner sobre quem materializa a O.S. — não pode dar 403."""
        service = Service(
            name="Película Fumê 35% (generate-os-nao-owner)",
            department="film",
            base_price=150.0,
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(service)
        await _make_dealership(db_session, test_store.id)
        await db_session.commit()
        await db_session.refresh(service)

        appt = await create_appointment(
            db_session,
            AppointmentCreate(
                store_id=test_store.id,
                department="film",
                delivery_date=date(2026, 9, 23),
                delivery_time=time(11, 0),
                vehicle_plate="AGN0J12",
                service_ids=[service.id],
                is_return=True,
                notes="Retorno sem O.S. anterior no sistema (autorizado pelo owner)",
            ),
            test_owner,
        )

        # Quem gera a O.S. é um agendador comum (não-Owner) — não deve ser bloqueado.
        service_order = await generate_service_order(
            db_session,
            appt.id,
            GenerateOSRequest(photos=["http://localhost:8000/uploads/g2.jpg"]),
            test_user,
        )

        assert service_order.is_return is True
        assert service_order.original_service_order_id is None
        assert service_order.notes == "Retorno sem O.S. anterior no sistema (autorizado pelo owner)"
