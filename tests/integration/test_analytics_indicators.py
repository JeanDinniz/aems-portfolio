"""
Integration tests for "Indicadores de Películas" endpoints.

Cobre:
1. Permissão via perfil de acesso ("indicadores") — 403 sem permissão, 200 com.
2. Rentabilidade: agrupamento por (tipo, tonalidade), margem, bucket "Não classificado".
3. Regra C8: cortesia/retorno contam R$0 de receita; cancelada fica de fora;
   errada-mas-conferida conta o valor cheio.
4. Saúde do estoque: bucket alerta (<=limiar amarelo) vs em_estoque (>limiar).
5. KPIs financeiros: receita, custo proporcional, lucro e margem.
"""

from datetime import UTC, date, datetime

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.access_profiles.models import (
    AccessProfile,
    AccessProfileModulePermission,
    access_profile_users,
)
from app.modules.analytics import service as analytics_service
from app.modules.auth.models import User
from app.modules.inventory.models import FilmConsumption, FilmRoll, FilmType
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem
from app.modules.services.models import Service
from app.modules.stores.models import Store

START = "2026-01-01T00:00:00Z"
END = "2026-01-31T23:59:59Z"
PARAMS = f"start_date={START}&end_date={END}"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def indicadores_client(
    client: AsyncClient, test_user: User, db_session: AsyncSession
) -> AsyncClient:
    """Cliente autenticado com perfil de acesso concedendo indicadores:can_view."""
    profile = AccessProfile(name="Indicadores Profile", is_active=True)
    db_session.add(profile)
    await db_session.flush()

    permission = AccessProfileModulePermission(
        profile_id=profile.id,
        module_group="OPERACIONAL",
        sub_module="indicadores",
        can_view=True,
        can_edit=False,
        can_delete=False,
    )
    db_session.add(permission)
    await db_session.flush()

    await db_session.execute(
        access_profile_users.insert().values(profile_id=profile.id, user_id=test_user.id)
    )
    await db_session.commit()

    response = await client.post(
        "/api/v1/auth/login",
        data={"username": "user@test.com", "password": "TestPass123!@"},
    )
    token = response.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"
    return client


@pytest_asyncio.fixture
async def test_service_film(db_session: AsyncSession, test_brand) -> Service:
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
async def film_type_a(db_session: AsyncSession) -> FilmType:
    ft = FilmType(
        name="Fumê G20",
        yellow_threshold_meters=10.0,
        red_threshold_meters=3.0,
        is_active=True,
        department="film",
        available_tonalities=["G20"],
    )
    db_session.add(ft)
    await db_session.commit()
    await db_session.refresh(ft)
    return ft


@pytest_asyncio.fixture
async def film_roll_a(
    db_session: AsyncSession, test_store: Store, film_type_a: FilmType
) -> FilmRoll:
    """Bobina de 100m, custo R$1000 (R$10/m), 80m restantes."""
    roll = FilmRoll(
        store_id=test_store.id,
        film_type_id=film_type_a.id,
        tonality="G20",
        cost=1000.00,
        total_meters=100.0,
        remaining_meters=80.0,
        receipt_date=date(2026, 1, 3),
        status="em_estoque",
    )
    db_session.add(roll)
    await db_session.commit()
    await db_session.refresh(roll)
    return roll


@pytest_asyncio.fixture
async def film_type_b(db_session: AsyncSession) -> FilmType:
    ft = FilmType(
        name="Nano G35",
        yellow_threshold_meters=10.0,
        red_threshold_meters=3.0,
        is_active=True,
        department="film",
        available_tonalities=["G35"],
    )
    db_session.add(ft)
    await db_session.commit()
    await db_session.refresh(ft)
    return ft


@pytest_asyncio.fixture
async def film_roll_b(
    db_session: AsyncSession, test_store: Store, film_type_b: FilmType
) -> FilmRoll:
    """Bobina de 50m, custo R$500 (R$10/m), 40m restantes."""
    roll = FilmRoll(
        store_id=test_store.id,
        film_type_id=film_type_b.id,
        tonality="G35",
        cost=500.00,
        total_meters=50.0,
        remaining_meters=40.0,
        receipt_date=date(2026, 1, 3),
        status="em_estoque",
    )
    db_session.add(roll)
    await db_session.commit()
    await db_session.refresh(roll)
    return roll


def _make_so(
    *,
    store_id: int,
    plate: str,
    status: str,
    is_courtesy: bool = False,
    is_return: bool = False,
    is_verified: bool = False,
    is_galpon: bool = False,
    created_by_id: int,
    entry_day: int = 10,
) -> ServiceOrder:
    return ServiceOrder(
        store_id=store_id,
        vehicle_plate=plate,
        department="film",
        status=status,
        is_courtesy=is_courtesy,
        is_galpon=is_galpon,
        is_return=is_return,
        is_verified=is_verified,
        entry_time=datetime(2026, 1, entry_day, 8, 0, tzinfo=UTC),
        service_date=date(2026, 1, entry_day),
        completion_time=datetime(2026, 1, entry_day, 10, 0, tzinfo=UTC),
        created_by_id=created_by_id,
    )


# ===========================================================================
# Permissão via perfil de acesso
# ===========================================================================


class TestIndicadoresPermission:
    @pytest.mark.asyncio
    async def test_forbidden_without_indicadores_permission(
        self, authenticated_client: AsyncClient
    ):
        """authenticated_client só tem service_orders — sem indicadores:can_view."""
        response = await authenticated_client.get(
            f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}"
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_ok_with_indicadores_permission(self, indicadores_client: AsyncClient):
        response = await indicadores_client.get(
            f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}"
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_ok_for_owner(self, owner_client: AsyncClient):
        response = await owner_client.get(f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}")
        assert response.status_code == 200


# ===========================================================================
# Rentabilidade (E2)
# ===========================================================================


class TestProfitability:
    @pytest.mark.asyncio
    async def test_grouping_and_margin_item_without_bobina_excluded(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service_film: Service,
        film_type_a: FilmType,
        film_roll_a: FilmRoll,
    ):
        """
        Item classificado (film_type_a/G20): receita 500, consumo 10m,
        custo proporcional 10m * (1000/100) = 100 -> margem 80%, R$/m = 50.

        Item SEM bobina vinculada (sem film_type_id, sem film_roll_id, sem
        consumo) e NÃO retalho: não há como atribuir a nenhum tipo -> fica de
        FORA do resultado (nem linha, nem Total) — não existe mais o bucket
        "Não classificado" pra esse caso.
        """
        so = _make_so(
            store_id=test_store.id,
            plate="PRF1A01",
            status="completed",
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.flush()

        item_classified = ServiceOrderItem(
            service_order_id=so.id,
            service_id=test_service_film.id,
            unit_price=500.00,
            quantity=1,
            film_type_id=film_type_a.id,
            tonality="G20",
        )
        item_without_bobina = ServiceOrderItem(
            service_order_id=so.id,
            service_id=test_service_film.id,
            unit_price=200.00,
            quantity=1,
        )
        db_session.add_all([item_classified, item_without_bobina])
        await db_session.flush()

        consumption = FilmConsumption(
            film_roll_id=film_roll_a.id,
            service_order_item_id=item_classified.id,
            meters_consumed=10.0,
            kind="consumo",
            created_at=datetime(2026, 1, 10, 9, 0, tzinfo=UTC),
        )
        db_session.add(consumption)
        await db_session.commit()

        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
        )
        assert response.status_code == 200
        data = response.json()
        items = {(i["film_type_id"], i["tonality"]): i for i in data["items"]}

        classified = items[(film_type_a.id, "G20")]
        assert classified["revenue"] == 500.0
        assert classified["consumption_meters"] == 10.0
        assert classified["cost"] == 100.0
        assert classified["margin_pct"] == 80.0
        assert classified["revenue_per_meter"] == 50.0

        # R$200 do item sem bobina NÃO aparecem em lugar nenhum — nem linha
        # própria, nem somados na linha classificada, nem no Total.
        assert (None, None) not in items
        assert len(data["items"]) == 1
        assert data["total"]["revenue"] == 500.0
        assert data["total"]["cost"] == 100.0

    @pytest.mark.asyncio
    async def test_empty_db_returns_empty_items(self, owner_client: AsyncClient):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total"]["revenue"] == 0.0
        assert data["total"]["margin_pct"] is None


# ===========================================================================
# Rentabilidade — atribuição de receita PELA BOBINA consumida (não pelo
# item.film_type_id, quase sempre nulo no lançamento real da O.S.)
# ===========================================================================


class TestProfitabilityRollAttribution:
    """
    Cenário único com 1 O.S. e 3 itens, todos com film_type_id=NULL (o caso
    real do lançamento):

    - item_a (R$600): consumiu só a bobina A (tipo A/G20, 6m) -> receita cai
      inteira em (tipo A, G20).
    - item_b (R$1000): consumiu a bobina A (6m) E a bobina B (tipo B/G35,
      4m) -> receita rateada por metros: 600 pra (A,G20) e 400 pra (B,G35).
    - item_c (R$300): sem nenhum consumo vinculado, sem film_roll_id e NÃO
      retalho -> não há como atribuir a nenhum tipo, EXCLUÍDO do resultado
      (nem linha, nem Total) — critério único de "item qualificado" do
      módulo (``_qualifying_film_item_filter``).

    Esperado por chave:
    - (A, G20): revenue=600(item_a)+600(item_b)=1200, consumo=6+6=12m
    - (B, G35): revenue=400(item_b), consumo=4m
    - item_c (R$300): fora do resultado inteiramente.

    Soma = 1600 = receita de item_a+item_b (item_c excluído de propósito).
    """

    @pytest_asyncio.fixture
    async def scenario(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service_film: Service,
        film_type_a: FilmType,
        film_roll_a: FilmRoll,
        film_type_b: FilmType,
        film_roll_b: FilmRoll,
    ) -> dict:
        so = _make_so(
            store_id=test_store.id,
            plate="ATR1B01",
            status="completed",
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.flush()

        item_a = ServiceOrderItem(
            service_order_id=so.id, service_id=test_service_film.id, unit_price=600.00, quantity=1
        )
        item_b = ServiceOrderItem(
            service_order_id=so.id, service_id=test_service_film.id, unit_price=1000.00, quantity=1
        )
        item_c = ServiceOrderItem(
            service_order_id=so.id, service_id=test_service_film.id, unit_price=300.00, quantity=1
        )
        db_session.add_all([item_a, item_b, item_c])
        await db_session.flush()

        db_session.add_all(
            [
                FilmConsumption(
                    film_roll_id=film_roll_a.id,
                    service_order_item_id=item_a.id,
                    meters_consumed=6.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 10, 9, 0, tzinfo=UTC),
                ),
                FilmConsumption(
                    film_roll_id=film_roll_a.id,
                    service_order_item_id=item_b.id,
                    meters_consumed=6.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 10, 9, 5, tzinfo=UTC),
                ),
                FilmConsumption(
                    film_roll_id=film_roll_b.id,
                    service_order_item_id=item_b.id,
                    meters_consumed=4.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 10, 9, 10, tzinfo=UTC),
                ),
            ]
        )
        await db_session.commit()
        return {"so": so, "item_a": item_a, "item_b": item_b, "item_c": item_c}

    @pytest.mark.asyncio
    async def test_item_without_film_type_id_attributes_via_consumed_roll(
        self, owner_client: AsyncClient, scenario: dict, film_type_a: FilmType
    ):
        """item_a não tem film_type_id — mas consumiu a bobina A -> cai em (A,G20)."""
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
        )
        assert response.status_code == 200
        items = {(i["film_type_id"], i["tonality"]): i for i in response.json()["items"]}

        a_g20 = items[(film_type_a.id, "G20")]
        assert a_g20["revenue"] == 1200.0  # 600 (item_a) + 600 (rateio de item_b)
        assert a_g20["consumption_meters"] == 12.0  # 6 (item_a) + 6 (item_b)

        # item_c (sem bobina, não retalho) não vaza pra lugar nenhum — nem
        # pro bucket (A,G20), nem existe um bucket "Não classificado" mais.
        assert (None, None) not in items

    @pytest.mark.asyncio
    async def test_item_consuming_two_rolls_splits_revenue_proportionally(
        self,
        owner_client: AsyncClient,
        scenario: dict,
        film_type_a: FilmType,
        film_type_b: FilmType,
    ):
        """
        item_b (R$1000) consumiu 6m da bobina A + 4m da bobina B -> rateio
        proporcional aos metros: 600 pra (A,G20) e 400 pra (B,G35).

        (B,G35) só recebe fatia de item_b (nenhum outro item tocou a bobina
        B), então dá pra isolar exatamente a fatia: deve ser 400 (=1000*4/10).
        (A,G20) recebe a fatia de item_b (600) + a receita inteira de item_a
        (600, que só consumiu a bobina A) = 1200.
        """
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
        )
        items = {(i["film_type_id"], i["tonality"]): i for i in response.json()["items"]}

        b_g35 = items[(film_type_b.id, "G35")]
        assert b_g35["revenue"] == 400.0  # fatia isolada de item_b (1000 * 4/10)
        assert b_g35["consumption_meters"] == 4.0

        a_g20 = items[(film_type_a.id, "G20")]
        assert a_g20["revenue"] == 1200.0  # item_a (600) + fatia de item_b (1000 * 6/10 = 600)

        # As duas fatias de item_b (rateadas por metros) somam de volta a receita cheia do item.
        item_b_slice_in_a = 1000.0 * 6 / 10
        item_b_slice_in_b = b_g35["revenue"]
        assert item_b_slice_in_a + item_b_slice_in_b == 1000.0

    @pytest.mark.asyncio
    async def test_item_without_bobina_and_not_scrap_is_excluded(
        self, owner_client: AsyncClient, scenario: dict
    ):
        """item_c: receita mas sem consumo/film_roll_id/used_scrap -> excluído do resultado."""
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
        )
        data = response.json()
        items = {(i["film_type_id"], i["tonality"]): i for i in data["items"]}

        assert (None, None) not in items
        assert (
            sum(i["revenue"] for i in data["items"]) == 1600.0
        )  # 1200 + 400, sem os 300 de item_c

    @pytest.mark.asyncio
    async def test_no_revenue_created_or_lost_in_the_split(
        self, owner_client: AsyncClient, scenario: dict
    ):
        """Soma da receita das linhas VISÍVEIS do E2 == item_a+item_b (1600; item_c excluído)."""
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
        )
        data = response.json()
        assert data["total"]["revenue"] == 1600.0
        assert sum(i["revenue"] for i in data["items"]) == 1600.0

    @pytest.mark.asyncio
    async def test_e2_total_revenue_matches_e5_financial_kpis_revenue(
        self, owner_client: AsyncClient, scenario: dict
    ):
        """Sanidade: o rateio não cria nem destrói receita — E2 total == E5 revenue."""
        profitability = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
        )
        financial = await owner_client.get(f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}")
        assert profitability.status_code == 200
        assert financial.status_code == 200
        assert profitability.json()["total"]["revenue"] == financial.json()["revenue"]["current"]


# ===========================================================================
# Rentabilidade — grupo "Retalho" + item com bobina sem consumo + exclusão
# ===========================================================================


class TestProfitabilityRetalhoAndExclusion:
    @pytest.mark.asyncio
    async def test_used_scrap_item_groups_under_retalho_label(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service_film: Service,
    ):
        """
        Item com used_scrap=True, sem film_type_id/film_roll_id/consumo, mas
        com receita -> agrupa sob o rótulo fixo "Retalho" (por tonalidade),
        consumo/custo = 0 (retalho não debita bobina de novo).
        """
        so = _make_so(
            store_id=test_store.id, plate="SCR1A01", status="completed", created_by_id=test_user.id
        )
        db_session.add(so)
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=so.id,
                service_id=test_service_film.id,
                unit_price=300.00,
                quantity=1,
                used_scrap=True,
                tonality="G50",
            )
        )
        await db_session.commit()

        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1
        retalho = data["items"][0]
        assert retalho["type_name"] == "Retalho"
        assert retalho["tonality"] == "G50"
        assert retalho["revenue"] == 300.0
        assert retalho["consumption_meters"] == 0.0
        assert retalho["cost"] == 0.0
        assert data["total"]["revenue"] == 300.0

    @pytest.mark.asyncio
    async def test_item_with_film_roll_id_but_no_consumption_shows_under_real_type(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service_film: Service,
        film_type_a: FilmType,
        film_roll_a: FilmRoll,
    ):
        """
        Item com film_roll_id vinculado mas SEM nenhuma FilmConsumption (ex.:
        registro legado) -> ainda cai no tipo/tonalidade real da bobina
        (fallback via item.film_roll_id -> FilmType), não em Retalho nem
        excluído.
        """
        so = _make_so(
            store_id=test_store.id, plate="RLL1A01", status="completed", created_by_id=test_user.id
        )
        db_session.add(so)
        await db_session.flush()
        db_session.add(
            ServiceOrderItem(
                service_order_id=so.id,
                service_id=test_service_film.id,
                unit_price=500.00,
                quantity=1,
                film_roll_id=film_roll_a.id,
            )
        )
        await db_session.commit()

        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
        )
        assert response.status_code == 200
        data = response.json()
        items = {(i["film_type_id"], i["tonality"]): i for i in data["items"]}

        real_type = items[(film_type_a.id, "G20")]
        assert real_type["type_name"] == "Fumê G20"
        assert real_type["revenue"] == 500.0
        assert real_type["consumption_meters"] == 0.0  # sem FilmConsumption vinculada


# ===========================================================================
# Critério único de "item qualificado" aplicado a TODO o módulo (E1/E2/E5/E6/E8)
# ===========================================================================


class TestQualifyingItemAcrossIndicatorsModule:
    """
    1 O.S. com 3 itens:
    - item_real (R$500): film_roll_id vinculado, sem consumo -> QUALIFICA
      (condição 2), aparece no tipo real (film_type_a/G20).
    - item_retalho (R$300): used_scrap=True -> QUALIFICA (condição 3),
      aparece como "Retalho".
    - item_excluded (R$150): sem bobina, sem consumo, não retalho -> NÃO
      qualifica, fica de fora de TODOS os endpoints do módulo.

    Receita qualificada total = 500 + 300 = 800 (exclui os R$150). Mesma
    régua em E1 (applications_count), E2 (tabela), E5 (KPIs), E6 (por loja)
    e E8 (evolução) — por isso o total bate em todos.
    """

    @pytest_asyncio.fixture
    async def scenario(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service_film: Service,
        film_type_a: FilmType,
        film_roll_a: FilmRoll,
    ) -> ServiceOrder:
        so = _make_so(
            store_id=test_store.id, plate="QLF1A01", status="completed", created_by_id=test_user.id
        )
        db_session.add(so)
        await db_session.flush()
        db_session.add_all(
            [
                ServiceOrderItem(
                    service_order_id=so.id,
                    service_id=test_service_film.id,
                    unit_price=500.00,
                    quantity=1,
                    film_roll_id=film_roll_a.id,
                ),
                ServiceOrderItem(
                    service_order_id=so.id,
                    service_id=test_service_film.id,
                    unit_price=300.00,
                    quantity=1,
                    used_scrap=True,
                    tonality="G50",
                ),
                ServiceOrderItem(
                    service_order_id=so.id,
                    service_id=test_service_film.id,
                    unit_price=150.00,
                    quantity=1,
                ),
            ]
        )
        await db_session.commit()
        return so

    @pytest.mark.asyncio
    async def test_e2_profitability_excludes_the_150_and_shows_retalho(
        self, owner_client: AsyncClient, scenario: ServiceOrder, film_type_a: FilmType
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
        )
        data = response.json()
        items = {(i["film_type_id"], i["tonality"]): i for i in data["items"]}

        assert items[(film_type_a.id, "G20")]["revenue"] == 500.0
        retalho = next(i for i in data["items"] if i["type_name"] == "Retalho")
        assert retalho["revenue"] == 300.0
        assert data["total"]["revenue"] == 800.0  # 500 + 300, sem os 150 excluídos

    @pytest.mark.asyncio
    async def test_e5_financial_kpis_revenue_and_applications_exclude_the_150(
        self, owner_client: AsyncClient, scenario: ServiceOrder
    ):
        """
        Receita = 500 (item_real) + 300 (retalho) = 800; applications_count=1
        (uma única O.S., que tem >=1 item qualificado — não conta por item).
        """
        response = await owner_client.get(f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}")
        assert response.status_code == 200
        data = response.json()
        assert data["revenue"]["current"] == 800.0
        assert data["applications_count"]["current"] == 1.0
        assert data["avg_ticket"]["current"] == 800.0

    @pytest.mark.asyncio
    async def test_e6_commercial_performance_revenue_excludes_the_150(
        self, owner_client: AsyncClient, scenario: ServiceOrder, test_store: Store
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/financial/commercial-performance?{PARAMS}"
        )
        assert response.status_code == 200
        items = response.json()
        store_row = next(i for i in items if i["store_id"] == test_store.id)
        assert store_row["revenue"] == 800.0
        assert store_row["applications"] == 1

    @pytest.mark.asyncio
    async def test_e8_financial_evolution_revenue_excludes_the_150(
        self, owner_client: AsyncClient, scenario: ServiceOrder
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/financial/evolution?{PARAMS}&granularity=month"
        )
        assert response.status_code == 200
        points = response.json()
        jan = next(p for p in points if p["period"] == "2026-01")
        assert jan["revenue"] == 800.0

    @pytest.mark.asyncio
    async def test_e2_total_matches_e5_revenue_with_mixed_scenario(
        self, owner_client: AsyncClient, scenario: ServiceOrder
    ):
        """Sanidade: mesmo critério de item qualificado em E2 e E5 -> totais batem."""
        profitability = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
        )
        financial = await owner_client.get(f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}")
        assert profitability.json()["total"]["revenue"] == financial.json()["revenue"]["current"]
        assert profitability.json()["total"]["revenue"] == 800.0


# ===========================================================================
# Regra C8 — cortesia/retorno R$0, cancelada fora, errada-conferida conta
# ===========================================================================


class TestC8RevenueRule:
    @pytest.mark.asyncio
    async def test_courtesy_return_zero_revenue_cancelled_excluded_wrong_verified_counts(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service_film: Service,
    ):
        """
        so_courtesy=300 (R$0 na receita, MAS conta em applications_count),
        so_return=250 (R$0 na receita, MAS conta em applications_count),
        so_cancelled=999 (fora de tudo — nem receita nem applications_count),
        so_wrong_verified=400 (conta cheio, pois conferida).

        Todos os itens usam used_scrap=True só pra QUALIFICAR
        (``_qualifying_film_item_filter()`` — item sem bobina/consumo/retalho
        não conta em nada) — o foco do teste é a regra C8, não o tipo.

        Receita esperada = 400. applications_count esperado = 3
        (courtesy + return + wrong_verified; cancelada fica de fora).
        """
        so_courtesy = _make_so(
            store_id=test_store.id,
            plate="CTS1A01",
            status="completed",
            is_courtesy=True,
            created_by_id=test_user.id,
            entry_day=5,
        )
        so_return = _make_so(
            store_id=test_store.id,
            plate="RET1A02",
            status="completed",
            is_return=True,
            created_by_id=test_user.id,
            entry_day=6,
        )
        so_cancelled = _make_so(
            store_id=test_store.id,
            plate="CNC1A03",
            status="cancelled",
            created_by_id=test_user.id,
            entry_day=7,
        )
        so_wrong_verified = _make_so(
            store_id=test_store.id,
            plate="WRG1A04",
            status="wrong",
            is_verified=True,
            created_by_id=test_user.id,
            entry_day=8,
        )
        db_session.add_all([so_courtesy, so_return, so_cancelled, so_wrong_verified])
        await db_session.flush()

        for so, price in (
            (so_courtesy, 300.00),
            (so_return, 250.00),
            (so_cancelled, 999.00),
            (so_wrong_verified, 400.00),
        ):
            db_session.add(
                ServiceOrderItem(
                    service_order_id=so.id,
                    service_id=test_service_film.id,
                    unit_price=price,
                    quantity=1,
                    used_scrap=True,
                )
            )
        await db_session.commit()

        response = await owner_client.get(f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}")
        assert response.status_code == 200
        data = response.json()
        assert data["revenue"]["current"] == 400.0
        assert data["applications_count"]["current"] == 3.0


# ===========================================================================
# Saúde do estoque (E3)
# ===========================================================================


class TestStockHealth:
    @pytest.mark.asyncio
    async def test_bucket_classification_alerta_vs_em_uso(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        film_type_a: FilmType,
    ):
        """
        Classificação alinhada ao semáforo canônico de estoque (get_color em
        app/modules/inventory/service.py): ALERTA é a bobina ABERTA (em_uso)
        abaixo do limiar amarelo — uma bobina lacrada (em_estoque) não está
        em uso, então cai sempre no bucket em_estoque, independente do saldo.

        yellow_threshold_meters=10 (film_type_a).
        roll_sealed_low: em_estoque, 5m restantes (<=10) -> bucket em_estoque
            (lacrada, saldo baixo não é alerta — ela nem está em uso ainda).
        roll_use_ok: em_uso, 50m restantes (>10) -> bucket em_uso.
        roll_use_low: em_uso, 5m restantes (<=10) -> bucket alerta.
        roll_out: esgotada, 0m -> bucket esgotada.
        """
        rolls = [
            FilmRoll(
                store_id=test_store.id,
                film_type_id=film_type_a.id,
                tonality="G20",
                total_meters=100.0,
                remaining_meters=5.0,
                receipt_date=date(2026, 1, 2),
                status="em_estoque",
            ),
            FilmRoll(
                store_id=test_store.id,
                film_type_id=film_type_a.id,
                tonality="G20",
                total_meters=100.0,
                remaining_meters=50.0,
                receipt_date=date(2026, 1, 2),
                status="em_uso",
            ),
            FilmRoll(
                store_id=test_store.id,
                film_type_id=film_type_a.id,
                tonality="G20",
                total_meters=100.0,
                remaining_meters=5.0,
                receipt_date=date(2026, 1, 2),
                status="em_uso",
            ),
            FilmRoll(
                store_id=test_store.id,
                film_type_id=film_type_a.id,
                tonality="G20",
                total_meters=100.0,
                remaining_meters=0.0,
                receipt_date=date(2026, 1, 2),
                status="esgotada",
            ),
        ]
        db_session.add_all(rolls)
        await db_session.commit()

        response = await owner_client.get(f"/api/v1/analytics/indicators/inventory/health?{PARAMS}")
        assert response.status_code == 200
        data = response.json()
        assert data["total_bobinas"] == 4
        breakdown = {b["status"]: b for b in data["breakdown"]}
        assert breakdown["em_estoque"]["count"] == 1
        assert breakdown["alerta"]["count"] == 1
        assert breakdown["em_uso"]["count"] == 1
        assert breakdown["esgotada"]["count"] == 1
        assert breakdown["em_estoque"]["percentage"] == 25.0


# ===========================================================================
# KPIs financeiros (E5)
# ===========================================================================


class TestFinancialKpis:
    @pytest.mark.asyncio
    async def test_revenue_cost_profit_margin(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service_film: Service,
        film_type_a: FilmType,
        film_roll_a: FilmRoll,
    ):
        """
        Receita = 500 (1 O.S., 1 item).
        Consumo no período = 10m; custo/m = 1000/100 = 10 -> custo = 100.
        Lucro = 400. Margem = 400/500*100 = 80%.
        avg_ticket = 500/1 = 500. revenue_per_meter = 500/10 = 50.
        """
        so = _make_so(
            store_id=test_store.id,
            plate="FIN1A01",
            status="completed",
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.flush()
        item = ServiceOrderItem(
            service_order_id=so.id,
            service_id=test_service_film.id,
            unit_price=500.00,
            quantity=1,
            film_type_id=film_type_a.id,
            film_roll_id=film_roll_a.id,  # qualifica o item (_qualifying_film_item_filter)
            tonality="G20",
        )
        db_session.add(item)
        await db_session.flush()
        db_session.add(
            FilmConsumption(
                film_roll_id=film_roll_a.id,
                # Vinculada ao item da O.S. (como o create_service_order real faz):
                # o custo consumido dos KPIs financeiros é ancorado na O.S. do
                # período, mesma população da receita/da tabela de Rentabilidade.
                service_order_item_id=item.id,
                meters_consumed=10.0,
                kind="consumo",
                created_at=datetime(2026, 1, 10, 9, 0, tzinfo=UTC),
            )
        )
        await db_session.commit()

        response = await owner_client.get(f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}")
        assert response.status_code == 200
        data = response.json()
        assert data["revenue"]["current"] == 500.0
        assert data["profit"]["current"] == 400.0
        assert data["margin_pct"]["current"] == 80.0
        assert data["avg_ticket"]["current"] == 500.0
        assert data["revenue_per_meter"]["current"] == 50.0
        assert data["applications_count"]["current"] == 1.0

    @pytest.mark.asyncio
    async def test_empty_db_returns_zeroes(self, owner_client: AsyncClient):
        response = await owner_client.get(f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}")
        assert response.status_code == 200
        data = response.json()
        assert data["revenue"]["current"] == 0.0
        assert data["margin_pct"]["current"] == 0.0
        assert data["applications_count"]["current"] == 0.0


# ===========================================================================
# Regressão: O.S. retroativa — serviço no período, baixa da bobina em OUTRO mês.
# Antes, receita (âncora service_date) e consumo/custo (âncora
# FilmConsumption.created_at) caíam em meses diferentes, então a linha da
# Rentabilidade mostrava faturamento com consumo/custo ZERADOS (e os KPIs
# financeiros idem). Agora consumo/custo são ancorados na O.S. do período.
# ===========================================================================


class TestRetroactiveConsumptionAnchor:
    @pytest_asyncio.fixture
    async def retro_scenario(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service_film: Service,
        film_type_a: FilmType,
        film_roll_a: FilmRoll,
    ) -> None:
        """
        O.S. com service_date em JANEIRO (dentro do período consultado), mas a
        FilmConsumption vinculada foi criada em DEZEMBRO (fora do período) —
        exatamente o padrão de lançamento retroativo do sistema.
        """
        so = _make_so(
            store_id=test_store.id,
            plate="RET1A01",
            status="completed",
            created_by_id=test_user.id,
            entry_day=15,  # service_date = 2026-01-15, dentro de PARAMS
        )
        db_session.add(so)
        await db_session.flush()
        item = ServiceOrderItem(
            service_order_id=so.id,
            service_id=test_service_film.id,
            unit_price=500.00,
            quantity=1,
            film_type_id=film_type_a.id,
            film_roll_id=film_roll_a.id,
            tonality="G20",
        )
        db_session.add(item)
        await db_session.flush()
        db_session.add(
            FilmConsumption(
                film_roll_id=film_roll_a.id,
                service_order_item_id=item.id,
                meters_consumed=10.0,
                kind="consumo",
                # created_at em DEZEMBRO/2025 — FORA da janela consultada (jan/2026).
                created_at=datetime(2025, 12, 28, 9, 0, tzinfo=UTC),
            )
        )
        await db_session.commit()

    @pytest.mark.asyncio
    async def test_profitability_row_reconciles_revenue_and_consumption(
        self, owner_client: AsyncClient, retro_scenario: None, film_type_a: FilmType
    ):
        """A linha da Rentabilidade fecha: receita 500, consumo 10m, custo 100."""
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
        )
        assert response.status_code == 200
        data = response.json()
        items = {(i["film_type_id"], i["tonality"]): i for i in data["items"]}
        row = items[(film_type_a.id, "G20")]
        assert row["revenue"] == 500.0
        assert row["consumption_meters"] == 10.0  # antes do fix: 0.0
        assert row["cost"] == 100.0  # antes do fix: 0.0
        assert row["margin_pct"] == 80.0
        assert data["total"]["cost"] == 100.0

    @pytest.mark.asyncio
    async def test_financial_kpis_count_retroactive_consumption(
        self, owner_client: AsyncClient, retro_scenario: None
    ):
        """KPIs financeiros também: custo/lucro/margem batem com a Rentabilidade."""
        response = await owner_client.get(f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}")
        assert response.status_code == 200
        data = response.json()
        assert data["revenue"]["current"] == 500.0
        assert data["profit"]["current"] == 400.0  # antes do fix: 500 (custo 0)
        assert data["margin_pct"]["current"] == 80.0  # antes do fix: 100
        assert data["revenue_per_meter"]["current"] == 50.0  # antes do fix: 0

    @pytest.mark.asyncio
    async def test_financial_health_roi_reconciles(
        self, owner_client: AsyncClient, retro_scenario: None
    ):
        """Saúde financeira: custo consumido 100, margem 400, ROI 5."""
        response = await owner_client.get(f"/api/v1/analytics/indicators/financial/health?{PARAMS}")
        assert response.status_code == 200
        data = response.json()
        assert data["cost_consumed"] == 100.0  # antes do fix: 0.0
        assert data["revenue"] == 500.0
        assert data["margin"] == 400.0
        assert data["roi"] == 5.0


# ===========================================================================
# Filtros multi-escolha (Marca / Loja / Departamento) + "Comparar com" mês livre
# ===========================================================================


def _qualifying_item(so_id: int, service_id: int, roll_id: int, ft_id: int, price: float):
    """Item de O.S. qualificado (film_roll_id preenchido) — conta em receita."""
    return ServiceOrderItem(
        service_order_id=so_id,
        service_id=service_id,
        unit_price=price,
        quantity=1,
        film_type_id=ft_id,
        film_roll_id=roll_id,
        tonality="G20",
    )


class TestFilterScopeAndCompare:
    async def _revenue(self, client: AsyncClient, extra: str = "") -> float:
        resp = await client.get(f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}{extra}")
        assert resp.status_code == 200
        return resp.json()["revenue"]["current"]

    @pytest.mark.asyncio
    async def test_store_ids_multi_and_brand_ids_scope(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        second_store: Store,
        test_user: User,
        test_service_film: Service,
        film_type_a: FilmType,
        film_roll_a: FilmRoll,
    ):
        """
        test_store e second_store são ambas da MESMA marca (test_brand). Uma
        terceira loja de OUTRA marca fica de fora do filtro por marca.
        """
        from app.modules.brands.models import Brand

        other_brand = Brand(name="Honda", code="honda", is_active=True)
        db_session.add(other_brand)
        await db_session.flush()
        other_store = Store(name="Honda Loja", code="HND1", is_active=True, brand_id=other_brand.id)
        db_session.add(other_store)
        await db_session.flush()

        # 3 O.S. (uma por loja): test_store=500, second_store=300, other_store=999
        for store_id, plate, price in [
            (test_store.id, "FSC1A01", 500.0),
            (second_store.id, "FSC1B01", 300.0),
            (other_store.id, "FSC1C01", 999.0),
        ]:
            so = _make_so(
                store_id=store_id, plate=plate, status="completed", created_by_id=test_user.id
            )
            db_session.add(so)
            await db_session.flush()
            db_session.add(
                _qualifying_item(so.id, test_service_film.id, film_roll_a.id, film_type_a.id, price)
            )
        await db_session.commit()

        # Sem filtro: soma tudo.
        assert await self._revenue(owner_client) == 1799.0
        # Uma loja só.
        assert await self._revenue(owner_client, f"&store_ids={test_store.id}") == 500.0
        # Duas lojas (multi).
        assert (
            await self._revenue(
                owner_client, f"&store_ids={test_store.id}&store_ids={second_store.id}"
            )
            == 800.0
        )
        # Marca test_brand = test_store + second_store (800), exclui Honda (999).
        assert await self._revenue(owner_client, f"&brand_ids={test_store.brand_id}") == 800.0
        # Marca Honda só.
        assert await self._revenue(owner_client, f"&brand_ids={other_brand.id}") == 999.0
        # Marca test_brand ∩ loja Honda = vazio (filtros contraditórios) -> 0.
        assert (
            await self._revenue(
                owner_client, f"&brand_ids={test_store.brand_id}&store_ids={other_store.id}"
            )
            == 0.0
        )

    @pytest.mark.asyncio
    async def test_compare_with_free_month(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service_film: Service,
        film_type_a: FilmType,
        film_roll_a: FilmRoll,
    ):
        """
        O.S. de 500 em jan/2026 (período) e O.S. de 200 em nov/2025.
        Sem 'compare': previous = dez/2025 (mês anterior) = 0.
        Com compare_start/end = nov/2025: previous = 200.
        """
        so_jan = _make_so(
            store_id=test_store.id, plate="CMP1A01", status="completed", created_by_id=test_user.id
        )
        db_session.add(so_jan)
        await db_session.flush()
        db_session.add(
            _qualifying_item(so_jan.id, test_service_film.id, film_roll_a.id, film_type_a.id, 500.0)
        )

        so_nov = ServiceOrder(
            store_id=test_store.id,
            vehicle_plate="CMP1B01",
            department="film",
            status="completed",
            is_courtesy=False,
            is_galpon=False,
            is_return=False,
            entry_time=datetime(2025, 11, 20, 8, 0, tzinfo=UTC),
            service_date=date(2025, 11, 20),
            completion_time=datetime(2025, 11, 20, 10, 0, tzinfo=UTC),
            created_by_id=test_user.id,
        )
        db_session.add(so_nov)
        await db_session.flush()
        db_session.add(
            _qualifying_item(so_nov.id, test_service_film.id, film_roll_a.id, film_type_a.id, 200.0)
        )
        await db_session.commit()

        default = await owner_client.get(f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}")
        assert default.status_code == 200
        d = default.json()
        assert d["revenue"]["current"] == 500.0
        assert d["revenue"]["previous"] == 0.0  # dez/2025 vazio

        compared = await owner_client.get(
            f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}"
            "&compare_start_date=2025-11-01T00:00:00Z&compare_end_date=2025-11-30T23:59:59Z"
        )
        assert compared.status_code == 200
        c = compared.json()
        assert c["revenue"]["current"] == 500.0
        assert c["revenue"]["previous"] == 200.0  # mês livre escolhido

    @pytest.mark.asyncio
    async def test_departments_multi_filters_family(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service_film: Service,
        film_type_a: FilmType,
        film_roll_a: FilmRoll,
    ):
        """
        Uma O.S. film (500) e uma ppf (800). `departments` (list[Literal], chave
        repetida no querystring) corta a família: vazio=1300, film=500, ppf=800.
        Cobre o único binding lista+Literal do módulo end-to-end.
        """
        svc_ppf = Service(
            name="PPF capô",
            department="ppf",
            base_price=800.0,
            is_active=True,
            brand_id=test_store.brand_id,
        )
        db_session.add(svc_ppf)
        await db_session.flush()

        for dept, svc_id, price, plate in (
            ("film", test_service_film.id, 500.0, "DPT1F01"),
            ("ppf", svc_ppf.id, 800.0, "DPT1P01"),
        ):
            so = _make_so(
                store_id=test_store.id, plate=plate, status="completed", created_by_id=test_user.id
            )
            so.department = dept
            db_session.add(so)
            await db_session.flush()
            db_session.add(_qualifying_item(so.id, svc_id, film_roll_a.id, film_type_a.id, price))
        await db_session.commit()

        assert await self._revenue(owner_client) == 1300.0  # família inteira
        assert await self._revenue(owner_client, "&departments=film") == 500.0
        assert await self._revenue(owner_client, "&departments=ppf") == 800.0
        # Multi (film + ppf) volta a somar os dois.
        assert await self._revenue(owner_client, "&departments=film&departments=ppf") == 1300.0


# ===========================================================================
# Atribuição de loja: O.S. de galpão contam para a LOJA-GALPÃO, não para a
# loja de destino (ADR 0026)
# ===========================================================================


class TestGalponStoreAttribution:
    """
    Uma O.S. de galpão (``is_galpon=True``) é gravada com ``store_id`` = loja de
    DESTINO. Nos Indicadores ela deve contar para a loja-galpão (resolvida pelo
    nome "…Galpão"), não para a loja de destino: filtrar a loja real mostra só
    as O.S. reais dela; filtrar a loja-galpão mostra as de galpão.
    """

    @pytest_asyncio.fixture
    async def galpon_store(self, db_session: AsyncSession, test_brand) -> Store:
        store = Store(
            name="Galpão Central",
            code="GALP01",
            is_active=True,
            brand_id=test_brand.id,
        )
        db_session.add(store)
        await db_session.commit()
        await db_session.refresh(store)
        return store

    @pytest_asyncio.fixture
    async def scenario(
        self,
        db_session: AsyncSession,
        test_store: Store,
        galpon_store: Store,
        test_user: User,
        test_service_film: Service,
        film_type_a: FilmType,
        film_roll_a: FilmRoll,
        film_type_b: FilmType,
        film_roll_b: FilmRoll,
    ) -> dict:
        # O.S. REAL da loja (is_galpon=False): 500 de receita, consome 10m da
        # bobina A (tipo A/G20) -> custo 10 * (1000/100) = 100.
        so_real = _make_so(
            store_id=test_store.id,
            plate="GLP0R01",
            status="completed",
            created_by_id=test_user.id,
        )
        # O.S. de GALPÃO com destino a MESMA loja (is_galpon=True): 700 de
        # receita, consome 5m da bobina B (tipo B/G35) -> custo 5 * (500/50) = 50.
        so_galpon = _make_so(
            store_id=test_store.id,
            plate="GLP0G01",
            status="completed",
            is_galpon=True,
            created_by_id=test_user.id,
        )
        db_session.add_all([so_real, so_galpon])
        await db_session.flush()

        item_real = ServiceOrderItem(
            service_order_id=so_real.id,
            service_id=test_service_film.id,
            unit_price=500.00,
            quantity=1,
        )
        item_galpon = ServiceOrderItem(
            service_order_id=so_galpon.id,
            service_id=test_service_film.id,
            unit_price=700.00,
            quantity=1,
        )
        db_session.add_all([item_real, item_galpon])
        await db_session.flush()

        db_session.add_all(
            [
                FilmConsumption(
                    film_roll_id=film_roll_a.id,
                    service_order_item_id=item_real.id,
                    meters_consumed=10.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 10, 9, 0, tzinfo=UTC),
                ),
                FilmConsumption(
                    film_roll_id=film_roll_b.id,
                    service_order_item_id=item_galpon.id,
                    meters_consumed=5.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 10, 9, 5, tzinfo=UTC),
                ),
            ]
        )
        await db_session.commit()
        return {"so_real": so_real, "so_galpon": so_galpon}

    @pytest.mark.asyncio
    async def test_profitability_store_filter_excludes_galpon_os(
        self,
        owner_client: AsyncClient,
        scenario: dict,
        test_store: Store,
        film_type_a: FilmType,
        film_type_b: FilmType,
    ):
        """Filtrando a loja REAL: só a linha da O.S. real (A/G20); galpão fora."""
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
            f"&store_ids={test_store.id}"
        )
        assert response.status_code == 200
        data = response.json()
        items = {(i["film_type_id"], i["tonality"]): i for i in data["items"]}
        assert (film_type_a.id, "G20") in items
        assert (film_type_b.id, "G35") not in items  # O.S. de galpão não vaza
        assert data["total"]["revenue"] == 500.0

    @pytest.mark.asyncio
    async def test_profitability_galpon_store_filter_shows_only_galpon_os(
        self,
        owner_client: AsyncClient,
        scenario: dict,
        galpon_store: Store,
        film_type_a: FilmType,
        film_type_b: FilmType,
    ):
        """Filtrando a LOJA-GALPÃO: só a linha da O.S. de galpão (B/G35)."""
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
            f"&store_ids={galpon_store.id}"
        )
        assert response.status_code == 200
        data = response.json()
        items = {(i["film_type_id"], i["tonality"]): i for i in data["items"]}
        assert (film_type_b.id, "G35") in items
        assert (film_type_a.id, "G20") not in items
        assert data["total"]["revenue"] == 700.0

    @pytest.mark.asyncio
    async def test_commercial_performance_attributes_galpon_to_galpon_store(
        self,
        owner_client: AsyncClient,
        scenario: dict,
        test_store: Store,
        galpon_store: Store,
    ):
        """
        Desempenho por loja: a receita da O.S. real fica na loja real; a receita
        da O.S. de galpão fica na loja-galpão (não na loja de destino).
        """
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/financial/commercial-performance?{PARAMS}"
        )
        assert response.status_code == 200
        by_store = {i["store_id"]: i for i in response.json()}
        assert by_store[test_store.id]["revenue"] == 500.0
        assert by_store[galpon_store.id]["revenue"] == 700.0


# ===========================================================================
# Filtros Tipo/Tonalidade — múltipla escolha (film_type_ids / tonalities)
# ===========================================================================


class TestProfitabilityMultiFilter:
    """Uma O.S. real com 2 itens (A/G20 e B/G35); valida os filtros multi."""

    @pytest_asyncio.fixture
    async def scenario(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service_film: Service,
        film_type_a: FilmType,
        film_roll_a: FilmRoll,
        film_type_b: FilmType,
        film_roll_b: FilmRoll,
    ) -> dict:
        so = _make_so(
            store_id=test_store.id,
            plate="MLT0A01",
            status="completed",
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.flush()

        item_a = ServiceOrderItem(
            service_order_id=so.id, service_id=test_service_film.id, unit_price=600.00, quantity=1
        )
        item_b = ServiceOrderItem(
            service_order_id=so.id, service_id=test_service_film.id, unit_price=400.00, quantity=1
        )
        db_session.add_all([item_a, item_b])
        await db_session.flush()

        db_session.add_all(
            [
                FilmConsumption(
                    film_roll_id=film_roll_a.id,
                    service_order_item_id=item_a.id,
                    meters_consumed=6.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 10, 9, 0, tzinfo=UTC),
                ),
                FilmConsumption(
                    film_roll_id=film_roll_b.id,
                    service_order_item_id=item_b.id,
                    meters_consumed=4.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 10, 9, 5, tzinfo=UTC),
                ),
            ]
        )
        await db_session.commit()
        return {"so": so}

    @pytest.mark.asyncio
    async def test_no_filter_returns_both_types(
        self,
        owner_client: AsyncClient,
        scenario: dict,
        film_type_a: FilmType,
        film_type_b: FilmType,
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
        )
        keys = {(i["film_type_id"], i["tonality"]) for i in response.json()["items"]}
        assert (film_type_a.id, "G20") in keys
        assert (film_type_b.id, "G35") in keys

    @pytest.mark.asyncio
    async def test_single_type_filter(
        self,
        owner_client: AsyncClient,
        scenario: dict,
        film_type_a: FilmType,
        film_type_b: FilmType,
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
            f"&film_type_ids={film_type_a.id}"
        )
        keys = {(i["film_type_id"], i["tonality"]) for i in response.json()["items"]}
        assert keys == {(film_type_a.id, "G20")}

    @pytest.mark.asyncio
    async def test_multiple_types_filter(
        self,
        owner_client: AsyncClient,
        scenario: dict,
        film_type_a: FilmType,
        film_type_b: FilmType,
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
            f"&film_type_ids={film_type_a.id}&film_type_ids={film_type_b.id}"
        )
        keys = {(i["film_type_id"], i["tonality"]) for i in response.json()["items"]}
        assert keys == {(film_type_a.id, "G20"), (film_type_b.id, "G35")}

    @pytest.mark.asyncio
    async def test_tonality_filter(
        self,
        owner_client: AsyncClient,
        scenario: dict,
        film_type_a: FilmType,
        film_type_b: FilmType,
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}&tonalities=G35"
        )
        keys = {(i["film_type_id"], i["tonality"]) for i in response.json()["items"]}
        assert keys == {(film_type_b.id, "G35")}


# ===========================================================================
# Filtros Tipo/Tonalidade — múltipla escolha, nos 4 endpoints que ainda não
# tinham (E3 Saúde do estoque, E4 Entradas x Consumo, E7 Saúde financeira,
# E8 Evolução financeira) — mesmo padrão de TestProfitabilityMultiFilter.
# ===========================================================================


class TestStockHealthMultiFilter:
    """2 bobinas de tipos diferentes (A/G20, B/G35); valida os filtros multi."""

    @pytest.mark.asyncio
    async def test_no_filter_counts_both_rolls(
        self,
        owner_client: AsyncClient,
        film_roll_a: FilmRoll,
        film_roll_b: FilmRoll,
    ):
        response = await owner_client.get(f"/api/v1/analytics/indicators/inventory/health?{PARAMS}")
        assert response.status_code == 200
        assert response.json()["total_bobinas"] == 2

    @pytest.mark.asyncio
    async def test_film_type_filter_restricts_to_one_roll(
        self,
        owner_client: AsyncClient,
        film_type_a: FilmType,
        film_roll_a: FilmRoll,
        film_roll_b: FilmRoll,
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/health?{PARAMS}&film_type_ids={film_type_a.id}"
        )
        assert response.status_code == 200
        assert response.json()["total_bobinas"] == 1

    @pytest.mark.asyncio
    async def test_tonality_filter_restricts_to_one_roll(
        self,
        owner_client: AsyncClient,
        film_roll_a: FilmRoll,
        film_roll_b: FilmRoll,
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/health?{PARAMS}&tonalities=G35"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total_bobinas"] == 1
        breakdown = {b["status"]: b["count"] for b in data["breakdown"]}
        assert breakdown["em_estoque"] == 1  # só a bobina B (G35), status em_estoque


class TestEntriesVsConsumptionMultiFilter:
    """2 bobinas de tipos diferentes (A/G20, B/G35), cada uma com consumo próprio."""

    @pytest_asyncio.fixture
    async def scenario(
        self, db_session: AsyncSession, film_roll_a: FilmRoll, film_roll_b: FilmRoll
    ) -> dict:
        db_session.add_all(
            [
                FilmConsumption(
                    film_roll_id=film_roll_a.id,
                    meters_consumed=6.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 10, 9, 0, tzinfo=UTC),
                ),
                FilmConsumption(
                    film_roll_id=film_roll_b.id,
                    meters_consumed=4.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 10, 9, 5, tzinfo=UTC),
                ),
            ]
        )
        await db_session.commit()
        return {"roll_a": film_roll_a, "roll_b": film_roll_b}

    @pytest.mark.asyncio
    async def test_no_filter_sums_both_types(self, owner_client: AsyncClient, scenario: dict):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/entries-vs-consumption?{PARAMS}"
        )
        assert response.status_code == 200
        jan = next(p for p in response.json() if p["period"] == "2026-01")
        assert jan["entries_meters"] == 150.0  # 100m (bobina A) + 50m (bobina B)
        assert jan["consumption_meters"] == 10.0  # 6m + 4m

    @pytest.mark.asyncio
    async def test_film_type_filter_restricts_to_one_type(
        self, owner_client: AsyncClient, scenario: dict, film_type_a: FilmType
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/entries-vs-consumption?{PARAMS}"
            f"&film_type_ids={film_type_a.id}"
        )
        assert response.status_code == 200
        jan = next(p for p in response.json() if p["period"] == "2026-01")
        assert jan["entries_meters"] == 100.0
        assert jan["consumption_meters"] == 6.0

    @pytest.mark.asyncio
    async def test_tonality_filter_restricts_to_one_type(
        self, owner_client: AsyncClient, scenario: dict
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/entries-vs-consumption?{PARAMS}&tonalities=G35"
        )
        assert response.status_code == 200
        jan = next(p for p in response.json() if p["period"] == "2026-01")
        assert jan["entries_meters"] == 50.0
        assert jan["consumption_meters"] == 4.0


class TestFinancialHealthAndEvolutionMultiFilter:
    """
    1 O.S. real com 2 itens qualificados, cada um consumindo uma bobina de tipo
    diferente (A/G20 R$600, B/G35 R$400) — valida os filtros multi em Saúde
    financeira (E7, mistura estoque + receita) e Evolução financeira (E8).

    Sem filtro: revenue=1000, cost_consumed=60(A)+40(B)=100, stock_value=
    800(A)+400(B)=1200 (fotografia atual de TODAS as bobinas ativas).
    Filtrando por tipo A: revenue=600, cost=60, stock_value=800.
    Filtrando por tonalidade G35 (tipo B): revenue=400, cost=40, stock_value=400.
    """

    @pytest_asyncio.fixture
    async def scenario(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service_film: Service,
        film_type_a: FilmType,
        film_roll_a: FilmRoll,
        film_type_b: FilmType,
        film_roll_b: FilmRoll,
    ) -> dict:
        so = _make_so(
            store_id=test_store.id,
            plate="FHE1A01",
            status="completed",
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.flush()

        item_a = ServiceOrderItem(
            service_order_id=so.id,
            service_id=test_service_film.id,
            unit_price=600.00,
            quantity=1,
            film_type_id=film_type_a.id,
            film_roll_id=film_roll_a.id,
            tonality="G20",
        )
        item_b = ServiceOrderItem(
            service_order_id=so.id,
            service_id=test_service_film.id,
            unit_price=400.00,
            quantity=1,
            film_type_id=film_type_b.id,
            film_roll_id=film_roll_b.id,
            tonality="G35",
        )
        db_session.add_all([item_a, item_b])
        await db_session.flush()

        db_session.add_all(
            [
                FilmConsumption(
                    film_roll_id=film_roll_a.id,
                    service_order_item_id=item_a.id,
                    meters_consumed=6.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 10, 9, 0, tzinfo=UTC),
                ),
                FilmConsumption(
                    film_roll_id=film_roll_b.id,
                    service_order_item_id=item_b.id,
                    meters_consumed=4.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 10, 9, 5, tzinfo=UTC),
                ),
            ]
        )
        await db_session.commit()
        return {"so": so}

    @pytest.mark.asyncio
    async def test_financial_health_no_filter(self, owner_client: AsyncClient, scenario: dict):
        response = await owner_client.get(f"/api/v1/analytics/indicators/financial/health?{PARAMS}")
        assert response.status_code == 200
        data = response.json()
        assert data["revenue"] == 1000.0
        assert data["cost_consumed"] == 100.0
        assert data["stock_value"] == 1200.0

    @pytest.mark.asyncio
    async def test_financial_health_film_type_filter(
        self, owner_client: AsyncClient, scenario: dict, film_type_a: FilmType
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/financial/health?{PARAMS}&film_type_ids={film_type_a.id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["revenue"] == 600.0
        assert data["cost_consumed"] == 60.0
        assert data["stock_value"] == 800.0
        assert data["margin"] == 540.0
        assert data["roi"] == 10.0

    @pytest.mark.asyncio
    async def test_financial_health_tonality_filter(
        self, owner_client: AsyncClient, scenario: dict
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/financial/health?{PARAMS}&tonalities=G35"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["revenue"] == 400.0
        assert data["cost_consumed"] == 40.0
        assert data["stock_value"] == 400.0

    @pytest.mark.asyncio
    async def test_financial_evolution_no_filter(self, owner_client: AsyncClient, scenario: dict):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/financial/evolution?{PARAMS}"
        )
        assert response.status_code == 200
        jan = next(p for p in response.json() if p["period"] == "2026-01")
        assert jan["revenue"] == 1000.0
        assert jan["cost"] == 100.0

    @pytest.mark.asyncio
    async def test_financial_evolution_film_type_filter(
        self, owner_client: AsyncClient, scenario: dict, film_type_a: FilmType
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/financial/evolution?{PARAMS}"
            f"&film_type_ids={film_type_a.id}"
        )
        assert response.status_code == 200
        jan = next(p for p in response.json() if p["period"] == "2026-01")
        assert jan["revenue"] == 600.0
        assert jan["cost"] == 60.0

    @pytest.mark.asyncio
    async def test_financial_evolution_tonality_filter(
        self, owner_client: AsyncClient, scenario: dict
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/financial/evolution?{PARAMS}&tonalities=G35"
        )
        assert response.status_code == 200
        jan = next(p for p in response.json() if p["period"] == "2026-01")
        assert jan["revenue"] == 400.0
        assert jan["cost"] == 40.0


# ===========================================================================
# Filtros Tipo/Tonalidade — múltipla escolha, nos 2 endpoints de KPI (E1
# Estoque, E5 Financeiro) que faltavam (achado 🟠 da revisão): reatividade
# GLOBAL — o frontend manda film_type_ids/tonalities pros 8 endpoints.
# ===========================================================================


class TestInventoryKpisMultiFilter:
    """
    2 bobinas de tipos diferentes (A/G20, B/G35), cada uma com consumo e 1
    O.S. qualificada própria — valida os filtros multi nos KPIs de Estoque.
    """

    @pytest_asyncio.fixture
    async def scenario(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service_film: Service,
        film_type_a: FilmType,
        film_roll_a: FilmRoll,
        film_type_b: FilmType,
        film_roll_b: FilmRoll,
    ) -> dict:
        so_a = _make_so(
            store_id=test_store.id,
            plate="IKA1A01",
            status="completed",
            created_by_id=test_user.id,
            entry_day=10,
        )
        so_b = _make_so(
            store_id=test_store.id,
            plate="IKB1A02",
            status="completed",
            created_by_id=test_user.id,
            entry_day=11,
        )
        db_session.add_all([so_a, so_b])
        await db_session.flush()

        item_a = ServiceOrderItem(
            service_order_id=so_a.id,
            service_id=test_service_film.id,
            unit_price=600.00,
            quantity=1,
            film_type_id=film_type_a.id,
            film_roll_id=film_roll_a.id,
            tonality="G20",
        )
        item_b = ServiceOrderItem(
            service_order_id=so_b.id,
            service_id=test_service_film.id,
            unit_price=400.00,
            quantity=1,
            film_type_id=film_type_b.id,
            film_roll_id=film_roll_b.id,
            tonality="G35",
        )
        db_session.add_all([item_a, item_b])
        await db_session.flush()

        db_session.add_all(
            [
                FilmConsumption(
                    film_roll_id=film_roll_a.id,
                    service_order_item_id=item_a.id,
                    meters_consumed=6.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 10, 9, 0, tzinfo=UTC),
                ),
                FilmConsumption(
                    film_roll_id=film_roll_b.id,
                    service_order_item_id=item_b.id,
                    meters_consumed=4.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 11, 9, 0, tzinfo=UTC),
                ),
            ]
        )
        await db_session.commit()
        return {"so_a": so_a, "so_b": so_b}

    @pytest.mark.asyncio
    async def test_no_filter_sums_both_types(self, owner_client: AsyncClient, scenario: dict):
        response = await owner_client.get(f"/api/v1/analytics/indicators/inventory/kpis?{PARAMS}")
        assert response.status_code == 200
        data = response.json()
        assert data["stock_meters"]["current"] == 120.0  # 80m (A) + 40m (B)
        assert data["stock_value"]["current"] == 1200.0  # 800 (A) + 400 (B)
        assert data["consumption_meters"]["current"] == 10.0  # 6m + 4m
        assert data["entries_meters"]["current"] == 150.0  # 100m + 50m
        assert data["bobinas_count"]["current"] == 2.0
        assert data["applications_count"]["current"] == 2.0

    @pytest.mark.asyncio
    async def test_film_type_filter_restricts_all_components(
        self, owner_client: AsyncClient, scenario: dict, film_type_a: FilmType
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/kpis?{PARAMS}&film_type_ids={film_type_a.id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["stock_meters"]["current"] == 80.0
        assert data["stock_value"]["current"] == 800.0
        assert data["consumption_meters"]["current"] == 6.0
        assert data["entries_meters"]["current"] == 100.0
        assert data["bobinas_count"]["current"] == 1.0
        assert data["applications_count"]["current"] == 1.0

    @pytest.mark.asyncio
    async def test_tonality_filter_restricts_all_components(
        self, owner_client: AsyncClient, scenario: dict
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/kpis?{PARAMS}&tonalities=G35"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["stock_meters"]["current"] == 40.0
        assert data["stock_value"]["current"] == 400.0
        assert data["consumption_meters"]["current"] == 4.0
        assert data["entries_meters"]["current"] == 50.0
        assert data["bobinas_count"]["current"] == 1.0
        assert data["applications_count"]["current"] == 1.0


class TestFinancialKpisMultiFilter:
    """
    2 O.S. em jan/2026 (tipo A R$600, tipo B R$400) + 2 O.S. em dez/2025 —
    mês anterior default (tipo A R$300, tipo B R$200) — valida que os
    filtros multi valem TAMBÉM no período de comparação (delta coerente),
    conforme o achado 🟠 da revisão de código.
    """

    @pytest_asyncio.fixture
    async def scenario(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service_film: Service,
        film_type_a: FilmType,
        film_roll_a: FilmRoll,
        film_type_b: FilmType,
        film_roll_b: FilmRoll,
    ) -> dict:
        so_a_jan = _make_so(
            store_id=test_store.id,
            plate="FKA1A01",
            status="completed",
            created_by_id=test_user.id,
            entry_day=10,
        )
        so_b_jan = _make_so(
            store_id=test_store.id,
            plate="FKB1A02",
            status="completed",
            created_by_id=test_user.id,
            entry_day=11,
        )
        db_session.add_all([so_a_jan, so_b_jan])
        await db_session.flush()

        def _dec_so(plate: str, day: int) -> ServiceOrder:
            return ServiceOrder(
                store_id=test_store.id,
                vehicle_plate=plate,
                department="film",
                status="completed",
                is_courtesy=False,
                is_galpon=False,
                is_return=False,
                entry_time=datetime(2025, 12, day, 8, 0, tzinfo=UTC),
                service_date=date(2025, 12, day),
                completion_time=datetime(2025, 12, day, 10, 0, tzinfo=UTC),
                created_by_id=test_user.id,
            )

        so_a_dec = _dec_so("FKA1D01", 10)
        so_b_dec = _dec_so("FKB1D02", 11)
        db_session.add_all([so_a_dec, so_b_dec])
        await db_session.flush()

        item_a_jan = ServiceOrderItem(
            service_order_id=so_a_jan.id,
            service_id=test_service_film.id,
            unit_price=600.00,
            quantity=1,
            film_type_id=film_type_a.id,
            film_roll_id=film_roll_a.id,
            tonality="G20",
        )
        item_b_jan = ServiceOrderItem(
            service_order_id=so_b_jan.id,
            service_id=test_service_film.id,
            unit_price=400.00,
            quantity=1,
            film_type_id=film_type_b.id,
            film_roll_id=film_roll_b.id,
            tonality="G35",
        )
        item_a_dec = ServiceOrderItem(
            service_order_id=so_a_dec.id,
            service_id=test_service_film.id,
            unit_price=300.00,
            quantity=1,
            film_type_id=film_type_a.id,
            film_roll_id=film_roll_a.id,
            tonality="G20",
        )
        item_b_dec = ServiceOrderItem(
            service_order_id=so_b_dec.id,
            service_id=test_service_film.id,
            unit_price=200.00,
            quantity=1,
            film_type_id=film_type_b.id,
            film_roll_id=film_roll_b.id,
            tonality="G35",
        )
        db_session.add_all([item_a_jan, item_b_jan, item_a_dec, item_b_dec])
        await db_session.flush()

        db_session.add_all(
            [
                FilmConsumption(
                    film_roll_id=film_roll_a.id,
                    service_order_item_id=item_a_jan.id,
                    meters_consumed=6.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 10, 9, 0, tzinfo=UTC),
                ),
                FilmConsumption(
                    film_roll_id=film_roll_b.id,
                    service_order_item_id=item_b_jan.id,
                    meters_consumed=4.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 11, 9, 0, tzinfo=UTC),
                ),
                FilmConsumption(
                    film_roll_id=film_roll_a.id,
                    service_order_item_id=item_a_dec.id,
                    meters_consumed=3.0,
                    kind="consumo",
                    created_at=datetime(2025, 12, 10, 9, 0, tzinfo=UTC),
                ),
                FilmConsumption(
                    film_roll_id=film_roll_b.id,
                    service_order_item_id=item_b_dec.id,
                    meters_consumed=2.0,
                    kind="consumo",
                    created_at=datetime(2025, 12, 11, 9, 0, tzinfo=UTC),
                ),
            ]
        )
        await db_session.commit()
        return {"so_a_jan": so_a_jan}

    @pytest.mark.asyncio
    async def test_no_filter_sums_both_types_current_and_previous(
        self, owner_client: AsyncClient, scenario: dict
    ):
        response = await owner_client.get(f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}")
        assert response.status_code == 200
        data = response.json()
        assert data["revenue"]["current"] == 1000.0
        assert data["revenue"]["previous"] == 500.0
        assert data["applications_count"]["current"] == 2.0
        assert data["applications_count"]["previous"] == 2.0

    @pytest.mark.asyncio
    async def test_film_type_filter_applies_to_both_periods(
        self, owner_client: AsyncClient, scenario: dict, film_type_a: FilmType
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}&film_type_ids={film_type_a.id}"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["revenue"]["current"] == 600.0
        assert data["revenue"]["previous"] == 300.0
        assert data["profit"]["current"] == 540.0  # 600 - 6m*(1000/100)
        assert data["profit"]["previous"] == 270.0  # 300 - 3m*(1000/100)
        assert data["margin_pct"]["current"] == 90.0
        assert data["margin_pct"]["previous"] == 90.0
        assert data["applications_count"]["current"] == 1.0
        assert data["applications_count"]["previous"] == 1.0

    @pytest.mark.asyncio
    async def test_tonality_filter_applies_to_both_periods(
        self, owner_client: AsyncClient, scenario: dict
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}&tonalities=G35"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["revenue"]["current"] == 400.0
        assert data["revenue"]["previous"] == 200.0
        assert data["profit"]["current"] == 360.0  # 400 - 4m*(500/50)
        assert data["profit"]["previous"] == 180.0  # 200 - 2m*(500/50)
        assert data["applications_count"]["current"] == 1.0
        assert data["applications_count"]["previous"] == 1.0


# ===========================================================================
# Rework: receita do Faturamento ANCORADA NA BOBINA CONSUMIDA (não em
# ServiceOrderItem.film_type_id) — decisão do Jean. Itens abaixo têm
# film_type_id/tonality NULOS no próprio item (o caso REAL do lançamento,
# ver docstring de get_profitability) — se o filtro ainda usasse
# ServiceOrderItem.film_type_id, a receita filtrada colapsaria pra R$0.
# ===========================================================================


class TestFinancialFilterAnchoredOnConsumedRoll:
    """
    so1: 1 item de R$600 que consome SÓ a bobina A (6m) -> 100% atribuído a
    (A, G20).
    so2: 1 item de R$1000 que consome a bobina A (6m) E a bobina B (4m) ->
    RATEADO proporcional aos metros: 600 pra (A,G20), 400 pra (B,G35) —
    mesmo rateio de TestProfitabilityRollAttribution, mas agora exercitado
    através dos 3 endpoints de Faturamento (KPIs, Saúde financeira, Evolução)
    e da contagem de aplicações dos KPIs de Estoque.

    Nenhum item tem ``film_type_id``/``tonality`` preenchidos (NULL) — o caso
    real do lançamento. Sob filtro por tipo A: revenue=600(so1)+600(so2 rateado)
    =1200; tipo B: revenue=400(so2 rateado). Nenhum dos dois colapsa pra 0.
    """

    @pytest_asyncio.fixture
    async def scenario(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service_film: Service,
        film_type_a: FilmType,
        film_roll_a: FilmRoll,
        film_type_b: FilmType,
        film_roll_b: FilmRoll,
    ) -> dict:
        so1 = _make_so(
            store_id=test_store.id,
            plate="RCK1A01",
            status="completed",
            created_by_id=test_user.id,
            entry_day=10,
        )
        so2 = _make_so(
            store_id=test_store.id,
            plate="RCK1B02",
            status="completed",
            created_by_id=test_user.id,
            entry_day=11,
        )
        db_session.add_all([so1, so2])
        await db_session.flush()

        # Sem film_type_id/tonality no item — caso real do lançamento.
        item_solo_a = ServiceOrderItem(
            service_order_id=so1.id, service_id=test_service_film.id, unit_price=600.00, quantity=1
        )
        item_split = ServiceOrderItem(
            service_order_id=so2.id, service_id=test_service_film.id, unit_price=1000.00, quantity=1
        )
        db_session.add_all([item_solo_a, item_split])
        await db_session.flush()

        db_session.add_all(
            [
                FilmConsumption(
                    film_roll_id=film_roll_a.id,
                    service_order_item_id=item_solo_a.id,
                    meters_consumed=6.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 10, 9, 0, tzinfo=UTC),
                ),
                FilmConsumption(
                    film_roll_id=film_roll_a.id,
                    service_order_item_id=item_split.id,
                    meters_consumed=6.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 11, 9, 0, tzinfo=UTC),
                ),
                FilmConsumption(
                    film_roll_id=film_roll_b.id,
                    service_order_item_id=item_split.id,
                    meters_consumed=4.0,
                    kind="consumo",
                    created_at=datetime(2026, 1, 11, 9, 5, tzinfo=UTC),
                ),
            ]
        )
        await db_session.commit()
        return {"so1": so1, "so2": so2}

    @pytest.mark.asyncio
    async def test_financial_kpis_revenue_does_not_collapse_and_reconciles_with_profitability(
        self, owner_client: AsyncClient, scenario: dict, film_type_a: FilmType
    ):
        """
        Sob filtro de tipo A, o KPI Faturamento tem que dar 1200 (não R$0) e
        bater com o total da tabela de Rentabilidade (E2) pro mesmo filtro.
        """
        kpis = await owner_client.get(
            f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}&film_type_ids={film_type_a.id}"
        )
        assert kpis.status_code == 200
        kpis_data = kpis.json()
        assert kpis_data["revenue"]["current"] == 1200.0
        assert kpis_data["revenue"]["current"] > 0  # não colapsou pra ~0

        profitability = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}"
            f"&film_type_ids={film_type_a.id}"
        )
        assert profitability.status_code == 200
        assert profitability.json()["total"]["revenue"] == kpis_data["revenue"]["current"]

    @pytest.mark.asyncio
    async def test_financial_kpis_tonality_b_reconciles_with_profitability(
        self, owner_client: AsyncClient, scenario: dict
    ):
        kpis = await owner_client.get(
            f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}&tonalities=G35"
        )
        assert kpis.status_code == 200
        kpis_data = kpis.json()
        assert kpis_data["revenue"]["current"] == 400.0
        assert kpis_data["revenue"]["current"] > 0

        profitability = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/profitability?{PARAMS}&tonalities=G35"
        )
        assert profitability.status_code == 200
        assert profitability.json()["total"]["revenue"] == kpis_data["revenue"]["current"]

    @pytest.mark.asyncio
    async def test_financial_health_reconciles_with_kpis_under_filter(
        self, owner_client: AsyncClient, scenario: dict, film_type_a: FilmType
    ):
        health = await owner_client.get(
            f"/api/v1/analytics/indicators/financial/health?{PARAMS}&film_type_ids={film_type_a.id}"
        )
        assert health.status_code == 200
        data = health.json()
        assert data["revenue"] == 1200.0
        assert data["revenue"] > 0

    @pytest.mark.asyncio
    async def test_financial_evolution_bucket_sum_reconciles_with_kpis(
        self, owner_client: AsyncClient, scenario: dict, film_type_a: FilmType
    ):
        """A soma dos buckets da Evolução tem que bater com o KPI Faturamento."""
        evolution = await owner_client.get(
            f"/api/v1/analytics/indicators/financial/evolution?{PARAMS}"
            f"&film_type_ids={film_type_a.id}"
        )
        assert evolution.status_code == 200
        points = evolution.json()
        total_revenue = sum(p["revenue"] for p in points)
        assert total_revenue == 1200.0
        assert total_revenue > 0

        jan = next(p for p in points if p["period"] == "2026-01")
        assert jan["revenue"] == 1200.0

    @pytest.mark.asyncio
    async def test_inventory_kpis_applications_count_reflects_roll_attribution(
        self, owner_client: AsyncClient, scenario: dict, film_type_a: FilmType
    ):
        """
        Tipo A aparece em AMBAS as O.S. (so1 inteira, so2 via rateio) ->
        applications_count=2. Tipo B só aparece em so2 (rateio) ->
        applications_count=1. Nenhum dos dois colapsa pra 0.
        """
        by_type_a = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/kpis?{PARAMS}&film_type_ids={film_type_a.id}"
        )
        assert by_type_a.status_code == 200
        assert by_type_a.json()["applications_count"]["current"] == 2.0

        by_tonality_b = await owner_client.get(
            f"/api/v1/analytics/indicators/inventory/kpis?{PARAMS}&tonalities=G35"
        )
        assert by_tonality_b.status_code == 200
        assert by_tonality_b.json()["applications_count"]["current"] == 1.0

    @pytest.mark.asyncio
    async def test_no_filter_sums_everything(self, owner_client: AsyncClient, scenario: dict):
        """Sanidade: sem filtro, revenue = 600 + 1000 = 1600 (nada some)."""
        response = await owner_client.get(f"/api/v1/analytics/indicators/financial/kpis?{PARAMS}")
        assert response.status_code == 200
        assert response.json()["revenue"]["current"] == 1600.0

    @pytest.mark.asyncio
    async def test_inventory_kpis_applications_count_hot_path_matches_filtered_union(
        self, owner_client: AsyncClient, scenario: dict
    ):
        """
        Trava a equivalência entre os 2 ramos de ``_applications``: o caminho
        quente SEM filtro (COUNT DISTINCT agregado, achado 🟡 de performance)
        tem que dar o MESMO total que a união das O.S. contadas pelo caminho
        COM filtro (ancorado na bobina, via _film_revenue_slices) — so1
        (só tipo A) + so2 (tipo A E tipo B, rateado) = {so1, so2} = 2.
        """
        no_filter = await owner_client.get(f"/api/v1/analytics/indicators/inventory/kpis?{PARAMS}")
        assert no_filter.status_code == 200
        assert no_filter.json()["applications_count"]["current"] == 2.0


# ===========================================================================
# Export PDF (BI) — /indicators/export/pdf
# ===========================================================================


class TestIndicatorsExportPdf:
    @pytest.mark.asyncio
    async def test_owner_downloads_pdf(
        self,
        owner_client: AsyncClient,
        db_session: AsyncSession,
        test_store: Store,
        test_user: User,
        test_service_film: Service,
        film_type_a: FilmType,
        film_roll_a: FilmRoll,
    ):
        so = _make_so(
            store_id=test_store.id,
            plate="PDF1A01",
            status="completed",
            created_by_id=test_user.id,
        )
        db_session.add(so)
        await db_session.flush()
        db_session.add(
            _qualifying_item(so.id, test_service_film.id, film_roll_a.id, film_type_a.id, 500.0)
        )
        await db_session.commit()

        response = await owner_client.get(f"/api/v1/analytics/indicators/export/pdf?{PARAMS}")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert "attachment" in response.headers["content-disposition"]
        assert "peliculas_20260101_20260131.pdf" in response.headers["content-disposition"]
        assert response.content.startswith(b"%PDF")

    @pytest.mark.asyncio
    async def test_ok_with_indicadores_profile_permission(self, indicadores_client: AsyncClient):
        response = await indicadores_client.get(f"/api/v1/analytics/indicators/export/pdf?{PARAMS}")
        assert response.status_code == 200
        assert response.content.startswith(b"%PDF")

    @pytest.mark.asyncio
    async def test_forbidden_without_indicadores_permission(
        self, authenticated_client: AsyncClient
    ):
        response = await authenticated_client.get(
            f"/api/v1/analytics/indicators/export/pdf?{PARAMS}"
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_accepts_filter_params_and_returns_pdf(
        self,
        owner_client: AsyncClient,
        test_store: Store,
        film_type_a: FilmType,
    ):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/export/pdf?{PARAMS}"
            f"&store_ids={test_store.id}"
            f"&brand_ids={test_store.brand_id}"
            f"&departments=film"
            f"&film_type_ids={film_type_a.id}"
            "&tonalities=G20"
            "&commercial_sort_by=meters"
            "&evolution_granularity=week"
        )
        assert response.status_code == 200
        assert response.content.startswith(b"%PDF")

    @pytest.mark.asyncio
    async def test_empty_db_returns_pdf_without_crashing(self, owner_client: AsyncClient):
        """Sem nenhuma O.S./bobina no período — todas as seções em estado vazio."""
        response = await owner_client.get(f"/api/v1/analytics/indicators/export/pdf?{PARAMS}")
        assert response.status_code == 200
        assert response.content.startswith(b"%PDF")

    @pytest.mark.asyncio
    async def test_compare_dates_accepted(self, owner_client: AsyncClient):
        response = await owner_client.get(
            f"/api/v1/analytics/indicators/export/pdf?{PARAMS}"
            "&compare_start_date=2025-11-01T00:00:00Z&compare_end_date=2025-11-30T23:59:59Z"
        )
        assert response.status_code == 200
        assert response.content.startswith(b"%PDF")


# ===========================================================================
# resolve_filters_label — 🟡12: nomes resolvidos por id (Marca/Loja/Tipo)
# ===========================================================================


class TestResolveFiltersLabel:
    @pytest.mark.asyncio
    async def test_resolves_brand_store_and_type_names_sorted(
        self,
        db_session: AsyncSession,
        test_store: Store,
        second_store: Store,
        film_type_a: FilmType,
        film_type_b: FilmType,
    ):
        """Ids viram nomes (ordenados); tonalidades e departamentos batem com o rótulo pt-BR."""
        label = await analytics_service.resolve_filters_label(
            db_session,
            start_date=datetime(2026, 1, 1, tzinfo=UTC),
            end_date=datetime(2026, 1, 31, 23, 59, 59, tzinfo=UTC),
            compare_start_date=None,
            compare_end_date=None,
            store_ids=[second_store.id, test_store.id],
            brand_ids=[],
            departments=["film", "ppf"],
            film_type_ids=[film_type_b.id, film_type_a.id],
            tonalities=["G35", "G20"],
        )
        assert label.period == "Janeiro/2026"
        assert label.compare == "Mês anterior"
        assert label.brand == "Todas"
        assert label.store == ", ".join(sorted([test_store.name, second_store.name]))
        assert label.department == "Película, PPF"
        assert label.film_type == ", ".join(sorted([film_type_a.name, film_type_b.name]))
        assert label.tonality == "G20, G35"

    @pytest.mark.asyncio
    async def test_empty_filters_resolve_to_todas_todos(self, db_session: AsyncSession):
        label = await analytics_service.resolve_filters_label(
            db_session,
            start_date=datetime(2026, 1, 1, tzinfo=UTC),
            end_date=datetime(2026, 1, 31, 23, 59, 59, tzinfo=UTC),
            compare_start_date=None,
            compare_end_date=None,
            store_ids=[],
            brand_ids=[],
            departments=[],
            film_type_ids=[],
            tonalities=[],
        )
        assert label.brand == "Todas"
        assert label.store == "Todas"
        assert label.department == "Todos"
        assert label.film_type == "Todos"
        assert label.tonality == "Todas"

    @pytest.mark.asyncio
    async def test_explicit_compare_range_formats_as_period_label(
        self, db_session: AsyncSession, test_store: Store
    ):
        label = await analytics_service.resolve_filters_label(
            db_session,
            start_date=datetime(2026, 1, 1, tzinfo=UTC),
            end_date=datetime(2026, 1, 31, 23, 59, 59, tzinfo=UTC),
            compare_start_date=datetime(2025, 11, 1, tzinfo=UTC),
            compare_end_date=datetime(2025, 11, 30, 23, 59, 59, tzinfo=UTC),
            store_ids=[test_store.id],
            brand_ids=[],
            departments=[],
            film_type_ids=[],
            tonalities=[],
        )
        assert label.compare == "Novembro/2025"
        assert label.store == test_store.name

    @pytest.mark.asyncio
    async def test_resolves_brand_name_by_id(self, db_session: AsyncSession, test_brand):
        label = await analytics_service.resolve_filters_label(
            db_session,
            start_date=datetime(2026, 1, 1, tzinfo=UTC),
            end_date=datetime(2026, 1, 31, 23, 59, 59, tzinfo=UTC),
            compare_start_date=None,
            compare_end_date=None,
            store_ids=[],
            brand_ids=[test_brand.id],
            departments=[],
            film_type_ids=[],
            tonalities=[],
        )
        assert label.brand == test_brand.name
