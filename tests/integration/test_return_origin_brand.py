"""Retorno cross-loja pela mesma MARCA: a O.S. de origem pode ter sido aberta em
outra concessionária da mesma marca (ex.: original na BYD Unidade 05, retorno na BYDUnidade 07). A busca de origem é ampliada à marca quando `store_id` é informado.
"""

import json
from datetime import UTC, date, datetime, time

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.modules.auth.models import User
from app.modules.brands.models import Brand
from app.modules.scheduling.schemas import AppointmentCreate, AppointmentUpdate
from app.modules.scheduling.service import (
    _resolve_return_origin_id,
    create_appointment,
    update_appointment,
)
from app.modules.service_orders.models import ServiceOrder
from app.modules.service_orders.service import (
    get_same_brand_store_ids,
    suggest_return_origin,
)
from app.modules.stores.models import Store

PLATE = "RET1B23"


async def _make_os(
    db: AsyncSession,
    *,
    store_id: int,
    user_id: int,
    status: str = "completed",
    is_return: bool = False,
    plate: str = PLATE,
    department: str = "film",
) -> ServiceOrder:
    os_obj = ServiceOrder(
        store_id=store_id,
        vehicle_plate=plate,
        department=department,
        status=status,
        is_return=is_return,
        entry_time=datetime.now(UTC),
        photos=json.dumps(["http://example.com/photo.jpg"]),
        created_by_id=user_id,
    )
    db.add(os_obj)
    await db.commit()
    await db.refresh(os_obj)
    return os_obj


class TestBrandScopedSuggestion:
    @pytest.mark.asyncio
    async def test_same_brand_store_ids_agrupa_por_marca(
        self, db_session: AsyncSession, test_store: Store, second_store: Store
    ):
        ids = await get_same_brand_store_ids(db_session, test_store.id)
        assert ids is not None
        assert set(ids) == {test_store.id, second_store.id}

    @pytest.mark.asyncio
    async def test_same_brand_store_ids_none_sem_loja(self, db_session: AsyncSession):
        assert await get_same_brand_store_ids(db_session, None) is None

    @pytest.mark.asyncio
    async def test_sugere_origem_de_outra_loja_da_marca(
        self,
        db_session: AsyncSession,
        test_store: Store,
        second_store: Store,
        test_user: User,
    ):
        """Origem na second_store (mesma marca); usuário só acessa test_store.
        Com store_id da loja do retorno, a sugestão encontra a origem cross-loja."""
        origin = await _make_os(db_session, store_id=second_store.id, user_id=test_user.id)
        sug = await suggest_return_origin(db_session, PLATE, test_user, store_id=test_store.id)
        assert sug is not None
        assert sug.id == origin.id

    @pytest.mark.asyncio
    async def test_sem_store_id_mantem_escopo_do_usuario(
        self,
        db_session: AsyncSession,
        test_store: Store,
        second_store: Store,
        test_user: User,
    ):
        """Sem store_id (comportamento padrão), a origem de outra loja fora do
        escopo do usuário NÃO aparece (preserva installer_performance)."""
        await _make_os(db_session, store_id=second_store.id, user_id=test_user.id)
        sug = await suggest_return_origin(db_session, PLATE, test_user)
        assert sug is None

    @pytest.mark.asyncio
    async def test_nao_vaza_origem_de_outra_marca(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
    ):
        """Origem numa loja de OUTRA marca não é sugerida mesmo com store_id."""
        other_brand = Brand(name="BYD", code="byd", is_active=True)
        db_session.add(other_brand)
        await db_session.flush()
        other_store = Store(
            name="BYD Unidade 05",
            code="LJBYD",
            is_active=True,
            brand_id=other_brand.id,
        )
        db_session.add(other_store)
        await db_session.commit()
        await _make_os(db_session, store_id=other_store.id, user_id=test_user.id)

        sug = await suggest_return_origin(db_session, PLATE, test_user, store_id=test_store.id)
        assert sug is None

    @pytest.mark.asyncio
    async def test_origem_em_andamento_nao_e_sugerida(
        self,
        db_session: AsyncSession,
        test_store: Store,
        second_store: Store,
        test_user: User,
    ):
        """Só finalizadas: O.S. em andamento na loja da marca não é sugerida."""
        await _make_os(
            db_session,
            store_id=second_store.id,
            user_id=test_user.id,
            status="in_progress",
        )
        sug = await suggest_return_origin(db_session, PLATE, test_user, store_id=test_store.id)
        assert sug is None


class TestDepartmentStrictSuggestion:
    """A O.S. de origem é ESTRITA por departamento: o mesmo veículo pode ter O.S.
    finalizadas em departamentos distintos (mesmo nº concessionária). O retorno
    deve vincular à O.S. do MESMO departamento escolhido, ou a nenhuma.
    """

    @pytest.mark.asyncio
    async def test_sugere_a_os_do_departamento_escolhido(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
    ):
        film = await _make_os(
            db_session, store_id=test_store.id, user_id=test_user.id, department="film"
        )
        security = await _make_os(
            db_session,
            store_id=test_store.id,
            user_id=test_user.id,
            department="security_film",
        )

        sug_sec = await suggest_return_origin(
            db_session, PLATE, test_user, store_id=test_store.id, department="security_film"
        )
        assert sug_sec is not None
        assert sug_sec.id == security.id

        sug_film = await suggest_return_origin(
            db_session, PLATE, test_user, store_id=test_store.id, department="film"
        )
        assert sug_film is not None
        assert sug_film.id == film.id

    @pytest.mark.asyncio
    async def test_sem_origem_no_departamento_retorna_none(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
    ):
        """Estrito: sem O.S. de origem no departamento escolhido, não sugere nada
        (não cai para outro departamento)."""
        await _make_os(db_session, store_id=test_store.id, user_id=test_user.id, department="film")
        sug = await suggest_return_origin(
            db_session, PLATE, test_user, store_id=test_store.id, department="ppf"
        )
        assert sug is None

    @pytest.mark.asyncio
    async def test_sem_department_mantem_compat(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
    ):
        """Sem `department` (compat), volta ao comportamento antigo: sugere a
        finalizada não-retorno mais recente, independentemente do departamento."""
        await _make_os(db_session, store_id=test_store.id, user_id=test_user.id, department="film")
        sug = await suggest_return_origin(db_session, PLATE, test_user, store_id=test_store.id)
        assert sug is not None

    @pytest.mark.asyncio
    async def test_endpoint_filtra_por_departamento(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
    ):
        await _make_os(db_session, store_id=test_store.id, user_id=test_user.id, department="film")
        security = await _make_os(
            db_session,
            store_id=test_store.id,
            user_id=test_user.id,
            department="security_film",
        )
        resp = await authenticated_client.get(
            "/api/v1/service-orders/return-origin-suggestion",
            params={"plate": PLATE, "store_id": test_store.id, "department": "security_film"},
        )
        assert resp.status_code == 200
        assert resp.json()["suggestion"]["id"] == security.id


class TestSchedulingResolve:
    @pytest.mark.asyncio
    async def test_resolve_aceita_origem_cross_loja_da_marca(
        self,
        db_session: AsyncSession,
        test_store: Store,
        second_store: Store,
        test_user: User,
    ):
        """_resolve_return_origin_id valida o id explícito contra a marca."""
        origin = await _make_os(db_session, store_id=second_store.id, user_id=test_user.id)
        resolved = await _resolve_return_origin_id(
            db_session,
            is_return=True,
            original_id=origin.id,
            plate=PLATE,
            user=test_user,
            store_id=test_store.id,
        )
        assert resolved == origin.id

    @pytest.mark.asyncio
    async def test_resolve_descarta_origem_de_outra_marca(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
    ):
        other_brand = Brand(name="Fiat", code="fiat", is_active=True)
        db_session.add(other_brand)
        await db_session.flush()
        other_store = Store(
            name="Fiat Centro", code="LJFIAT", is_active=True, brand_id=other_brand.id
        )
        db_session.add(other_store)
        await db_session.commit()
        origin = await _make_os(db_session, store_id=other_store.id, user_id=test_user.id)
        resolved = await _resolve_return_origin_id(
            db_session,
            is_return=True,
            original_id=origin.id,
            plate=PLATE,
            user=test_user,
            store_id=test_store.id,
        )
        assert resolved is None

    @pytest.mark.asyncio
    async def test_resolve_fallback_estrito_por_departamento(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
    ):
        """Fallback por placa (sem id explícito) resolve ESTRITO por departamento:
        vincula à O.S. de origem do mesmo depto, ou a nenhuma."""
        await _make_os(db_session, store_id=test_store.id, user_id=test_user.id, department="film")
        security = await _make_os(
            db_session,
            store_id=test_store.id,
            user_id=test_user.id,
            department="security_film",
        )

        resolved_sec = await _resolve_return_origin_id(
            db_session,
            is_return=True,
            original_id=None,
            plate=PLATE,
            user=test_user,
            store_id=test_store.id,
            department="security_film",
        )
        assert resolved_sec == security.id

        resolved_ppf = await _resolve_return_origin_id(
            db_session,
            is_return=True,
            original_id=None,
            plate=PLATE,
            user=test_user,
            store_id=test_store.id,
            department="ppf",
        )
        assert resolved_ppf is None


class TestEndpoint:
    @pytest.mark.asyncio
    async def test_endpoint_sugere_cross_loja_da_marca(
        self,
        authenticated_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        second_store: Store,
        test_user: User,
    ):
        origin = await _make_os(db_session, store_id=second_store.id, user_id=test_user.id)
        resp = await authenticated_client.get(
            "/api/v1/service-orders/return-origin-suggestion",
            params={"plate": PLATE, "store_id": test_store.id},
        )
        assert resp.status_code == 200
        assert resp.json()["suggestion"]["id"] == origin.id

    @pytest.mark.asyncio
    async def test_endpoint_bloqueia_store_sem_acesso(
        self,
        authenticated_client: AsyncClient,
        second_store: Store,
    ):
        """require_resource_access nega a loja-base sem acesso. Usa NotFoundError
        (404) por segurança-por-obscuridade — não revela a existência do recurso."""
        resp = await authenticated_client.get(
            "/api/v1/service-orders/return-origin-suggestion",
            params={"plate": PLATE, "store_id": second_store.id},
        )
        assert resp.status_code == 404


class TestUpdateAppointmentStoreScope:
    @pytest.mark.asyncio
    async def test_update_rejeita_store_de_outra_marca_sem_acesso(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
    ):
        """Editar o agendamento movendo-o para uma loja de OUTRA marca à qual o
        usuário não tem acesso deve ser rejeitado (require_resource_access) — o
        `store_id` do payload é a base da marca da origem e não pode ser burlado."""
        appt = await create_appointment(
            db_session,
            AppointmentCreate(
                store_id=test_store.id,
                department="film",
                delivery_date=date(2026, 9, 1),
                delivery_time=time(12, 0),
                vehicle_plate=PLATE,
            ),
            test_user,
        )

        other_brand = Brand(name="BYD", code="byd", is_active=True)
        db_session.add(other_brand)
        await db_session.flush()
        other_store = Store(name="BYD Unidade 05", code="LJBYD", is_active=True, brand_id=other_brand.id)
        db_session.add(other_store)
        await db_session.commit()

        with pytest.raises(NotFoundError):
            await update_appointment(
                db_session,
                appt.id,
                AppointmentUpdate(store_id=other_store.id),
                test_user,
            )
