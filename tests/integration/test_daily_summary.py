"""
Testes do Resumo Diário (PDF) e do cadastro de Feriados.

Regras cobertas:
- Cortesia aparece na listagem mas não soma nos totais
- Duplicada/lançado errado/cancelada aparecem sinalizadas, fora dos totais
- Galpão fica fora do relatório das lojas; loja galpão traz só O.S. is_galpon
- Seções: Estética (não-película) e Película (film/security_film/ppf)
- Dias trabalhados/úteis seg–sex (com feriado) / equipe do dia (faltas/férias)
- Primeiro nome dos funcionários na equipe e nos workers
- Endpoint retorna PDF válido
- CRUD de feriados com permissões
"""

from datetime import date, datetime
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.brands.models import Brand
from app.modules.employees.models import Employee, EmployeeMovement
from app.modules.holidays.models import Holiday
from app.modules.service_orders.daily_summary import (
    _business_days,
    gather_daily_summary,
)
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem
from app.modules.services.models import Service
from app.modules.stores.models import Store

REPORT_DATE = date(2026, 7, 10)  # sexta-feira


@pytest.fixture
def report_date() -> date:
    return REPORT_DATE


@pytest_asyncio.fixture
async def galpon_store(db_session: AsyncSession, test_brand: Brand) -> Store:
    """Loja marcada como galpão (is_galpon_store)."""
    store = Store(
        name="Galpão Central",
        code="GAL",
        address="Rua Galpão, 1",
        phone="11777777777",
        is_active=True,
        brand_id=test_brand.id,
        is_galpon_store=True,
    )
    db_session.add(store)
    await db_session.commit()
    await db_session.refresh(store)
    return store


async def _make_service(
    db: AsyncSession,
    brand: Brand,
    name: str,
    department: str,
    price: str,
    code: str | None = None,
) -> Service:
    service = Service(
        name=name,
        department=department,
        base_price=Decimal(price),
        brand_id=brand.id,
        is_active=True,
        code=code,
    )
    db.add(service)
    await db.flush()
    return service


async def _make_order(
    db: AsyncSession,
    store: Store,
    service: Service,
    entry: datetime,
    price: str,
    status: str = "waiting",
    is_courtesy: bool = False,
    is_galpon: bool = False,
) -> ServiceOrder:
    order = ServiceOrder(
        store_id=store.id,
        vehicle_plate="ABC1D23",
        vehicle_model="Modelo Teste",
        vehicle_color="Preto",
        department=service.department,
        status=status,
        entry_time=entry,
        is_courtesy=is_courtesy,
        is_galpon=is_galpon,
    )
    db.add(order)
    await db.flush()
    db.add(
        ServiceOrderItem(
            service_order_id=order.id,
            service_id=service.id,
            quantity=1,
            unit_price=Decimal(price),
        )
    )
    await db.flush()
    return order


@pytest.mark.asyncio
class TestGatherDailySummary:
    async def test_totals_courtesy_flagged_and_galpon_rules(
        self, db_session: AsyncSession, test_store: Store, test_brand: Brand
    ):
        svc_vn = await _make_service(db_session, test_brand, "VN Lavagem", "vn", "38.00")
        svc_film = await _make_service(db_session, test_brand, "Película Lateral", "film", "395.00")

        day = datetime(2026, 7, 10, 14, 0)
        # Estética válida
        await _make_order(db_session, test_store, svc_vn, day, "38.00")
        # Cortesia: listada, fora do total
        await _make_order(db_session, test_store, svc_vn, day, "30.00", is_courtesy=True)
        # Duplicada: sinalizada, fora do total e da contagem
        await _make_order(db_session, test_store, svc_vn, day, "76.50", status="duplicate")
        # Galpão: fora do relatório
        await _make_order(db_session, test_store, svc_vn, day, "99.00", is_galpon=True)
        # Película válida
        await _make_order(db_session, test_store, svc_film, day, "395.00")
        # Dia anterior no mesmo mês: entra só no acumulado/dias trabalhados
        await _make_order(db_session, test_store, svc_vn, datetime(2026, 7, 9, 10, 0), "100.00")
        # Sábado: soma no acumulado, mas não conta como dia trabalhado (seg–sex)
        await _make_order(db_session, test_store, svc_vn, datetime(2026, 7, 4, 10, 0), "62.00")
        await db_session.commit()

        data = await gather_daily_summary(db_session, test_store.id, REPORT_DATE, "Tester")

        # Estética: 2 veículos válidos no dia (normal + cortesia), 3 linhas (com a duplicada)
        assert data.estetica.vehicles_count == 2
        assert len(data.estetica.rows) == 3
        assert data.estetica.total_day == Decimal("38.00")
        # Acumulado do mês: 38 (dia) + 100 (dia anterior) + 62 (sábado); cortesia/duplicada fora
        assert data.estetica.total_month == Decimal("200.00")

        flagged = [r for r in data.estetica.rows if r.flagged_status]
        assert len(flagged) == 1 and flagged[0].flagged_status == "DUPLICADA"
        courtesy_rows = [r for r in data.estetica.rows if r.is_courtesy]
        assert len(courtesy_rows) == 1 and courtesy_rows[0].value == Decimal("30.00")

        # Galpão não aparece em nenhuma seção
        all_values = [r.value for r in data.estetica.rows + data.pelicula.rows]
        assert Decimal("99.00") not in all_values

        # Película
        assert data.pelicula.vehicles_count == 1
        assert data.pelicula.total_day == Decimal("395.00")

        # Dias trabalhados: 09/07 (qui) e 10/07 (sex); sábado 04/07 fora
        assert data.worked_days == 2
        # Média/projeção da seção estética
        assert data.estetica.avg_daily == Decimal("200.00") / 2
        assert data.estetica.projection == data.estetica.avg_daily * data.business_days

    async def test_lav_cortesia_counts_even_in_courtesy_order(
        self, db_session: AsyncSession, test_store: Store, test_brand: Brand
    ):
        """
        LAV.CORTESIA é faturável (a concessionária paga): dentro de uma O.S.
        cortesia somam-se APENAS os itens LAV.CORTESIA; os demais serviços
        cortesia da mesma O.S. e as O.S. cortesia sem LAV.CORTESIA ficam de fora.
        """
        svc_vn = await _make_service(db_session, test_brand, "VN Lavagem", "vn", "38.00")
        svc_lav = await _make_service(
            db_session, test_brand, "Lavagem Cortesia", "vn", "30.00", code="LAV.CORTESIA"
        )
        svc_poli = await _make_service(
            db_session, test_brand, "Polimento", "vn", "50.00", code="POLI1"
        )

        day = datetime(2026, 7, 10, 14, 0)
        # O.S. normal: soma tudo
        await _make_order(db_session, test_store, svc_vn, day, "38.00")
        # O.S. cortesia com LAV.CORTESIA (30) + outro serviço cortesia (50):
        # só o LAV.CORTESIA entra no total.
        mixed = await _make_order(db_session, test_store, svc_lav, day, "30.00", is_courtesy=True)
        db_session.add(
            ServiceOrderItem(
                service_order_id=mixed.id,
                service_id=svc_poli.id,
                quantity=1,
                unit_price=Decimal("50.00"),
            )
        )
        # O.S. cortesia sem LAV.CORTESIA: nada soma
        await _make_order(db_session, test_store, svc_vn, day, "40.00", is_courtesy=True)
        await db_session.commit()

        data = await gather_daily_summary(db_session, test_store.id, REPORT_DATE, "Tester")

        # 3 O.S. válidas de estética; total = 38 (normal) + 30 (LAV.CORTESIA), sem os 50 nem os 40
        assert data.estetica.vehicles_count == 3
        assert data.estetica.total_day == Decimal("68.00")
        assert data.estetica.total_month == Decimal("68.00")

    async def test_multi_service_order_single_row_with_codes(
        self, db_session: AsyncSession, test_store: Store, test_brand: Brand
    ):
        """O.S. com 2 serviços gera UMA linha: códigos somados e valor = soma dos itens."""
        svc_a = await _make_service(
            db_session, test_brand, "Lavagem Geral", "vn", "38.00", code="8888811"
        )
        svc_b = await _make_service(
            db_session, test_brand, "Hidratação", "vn", "57.00", code="8888807"
        )

        day = datetime(2026, 7, 10, 14, 0)
        order = await _make_order(db_session, test_store, svc_a, day, "38.00")
        db_session.add(
            ServiceOrderItem(
                service_order_id=order.id,
                service_id=svc_b.id,
                quantity=1,
                unit_price=Decimal("57.00"),
            )
        )
        await db_session.commit()

        data = await gather_daily_summary(db_session, test_store.id, REPORT_DATE, "Tester")

        assert len(data.estetica.rows) == 1
        row = data.estetica.rows[0]
        assert row.service == "8888811 + 8888807"
        assert row.value == Decimal("95.00")
        # Coluna Veículo unifica modelo e cor
        assert row.vehicle == "Modelo Teste · Preto"
        # Consultor não entra mais nas observações
        assert "Consultor" not in row.observations

    async def test_completed_order_counts_on_completion_day(
        self, db_session: AsyncSession, test_store: Store, test_brand: Brand
    ):
        """
        O.S. finalizada com data de serviço no futuro (agendada p/ frente, mas feita
        adiantado) conta no dia em que foi CONCLUÍDA, não na data de serviço.
        """
        svc = await _make_service(db_session, test_brand, "Película Lateral", "film", "395.00")

        # Finalizada em 10/07 (REPORT_DATE), mas agendada/serviço p/ 11/07
        order = await _make_order(
            db_session, test_store, svc, datetime(2026, 7, 10, 13, 0), "395.00", status="completed"
        )
        order.service_date = date(2026, 7, 11)
        order.completion_time = datetime(2026, 7, 10, 15, 17)
        await db_session.commit()

        # Resumo de 10/07: a O.S. aparece (dia da finalização)
        data = await gather_daily_summary(db_session, test_store.id, REPORT_DATE, "Tester")
        assert data.pelicula.vehicles_count == 1
        assert data.pelicula.total_day == Decimal("395.00")

        # Resumo de 11/07 (data de serviço): não aparece — já contada no dia da finalização
        data_next = await gather_daily_summary(
            db_session, test_store.id, date(2026, 7, 11), "Tester"
        )
        assert data_next.pelicula.vehicles_count == 0
        assert data_next.pelicula.total_day == Decimal("0")

    async def test_completed_estetica_counts_on_service_date_not_completion(
        self, db_session: AsyncSession, test_store: Store, test_brand: Brand
    ):
        """
        Regra híbrida: só Película/PPF/Pel. Segurança contam pelo dia da
        finalização. Departamentos de ESTÉTICA (vn/vu/vd/workshop/bodywork)
        contam SEMPRE pela data de serviço, mesmo finalizadas em outro dia.
        """
        svc = await _make_service(db_session, test_brand, "VN Lavagem", "vn", "38.00")

        # Finalizada em 10/07 (REPORT_DATE), mas com data de serviço 11/07
        order = await _make_order(
            db_session, test_store, svc, datetime(2026, 7, 10, 13, 0), "38.00", status="completed"
        )
        order.service_date = date(2026, 7, 11)
        order.completion_time = datetime(2026, 7, 10, 15, 17)
        await db_session.commit()

        # Resumo de 10/07 (dia da finalização): NÃO aparece — estética conta por service_date
        data = await gather_daily_summary(db_session, test_store.id, REPORT_DATE, "Tester")
        assert data.estetica.vehicles_count == 0
        assert data.estetica.total_day == Decimal("0")

        # Resumo de 11/07 (data de serviço): aparece
        data_next = await gather_daily_summary(
            db_session, test_store.id, date(2026, 7, 11), "Tester"
        )
        assert data_next.estetica.vehicles_count == 1
        assert data_next.estetica.total_day == Decimal("38.00")

    async def test_business_days_with_holiday(self, db_session: AsyncSession, test_store: Store):
        # Julho/2026: 23 dias seg-sex
        assert _business_days(2026, 7, set()) == 23

        db_session.add(Holiday(date=date(2026, 7, 9), name="Feriado Global", store_id=None))
        db_session.add(
            Holiday(date=date(2026, 7, 15), name="Feriado da Loja", store_id=test_store.id)
        )
        # Feriado de outra data caindo no domingo não desconta
        db_session.add(Holiday(date=date(2026, 7, 12), name="Feriado Domingo", store_id=None))
        await db_session.commit()

        data = await gather_daily_summary(db_session, test_store.id, REPORT_DATE, "Tester")
        assert data.business_days == 21
        assert any("Feriado Global" in h for h in data.holidays)
        assert any("Feriado da Loja" in h for h in data.holidays)

    async def test_team_of_the_day(self, db_session: AsyncSession, test_store: Store):
        # Nomes completos no cadastro → PDF mostra só o primeiro nome
        present = Employee(name="Gustavo Henrique da Silva", store_id=test_store.id, is_active=True)
        faulted = Employee(name="Erik Souza Lima", store_id=test_store.id, is_active=True)
        on_vacation = Employee(name="João", store_id=test_store.id, is_active=True)
        away = Employee(name="Maria", store_id=test_store.id, is_active=True, hr_status="away")
        db_session.add_all([present, faulted, on_vacation, away])
        await db_session.flush()

        db_session.add(
            EmployeeMovement(
                employee_id=faulted.id,
                type="fault",
                movement_date=REPORT_DATE,
                movement_data={"fault_type": "injustificada", "date": "2026-07-10"},
            )
        )
        db_session.add(
            EmployeeMovement(
                employee_id=on_vacation.id,
                type="vacation",
                movement_date=date(2026, 7, 1),
                movement_data={"start_date": "2026-07-01", "return_date": "2026-07-20"},
            )
        )
        await db_session.commit()

        data = await gather_daily_summary(db_session, test_store.id, REPORT_DATE, "Tester")

        assert data.team_present == ["Gustavo"]
        assert data.faults_count == 1
        reasons = {a.name: a.reason for a in data.absents}
        assert reasons["Erik"] == "Falta: Injustificada"
        assert reasons["João"] == "Férias"
        assert reasons["Maria"] == "Afastamento"

    async def test_galpon_store_gathers_only_galpon_orders(
        self,
        db_session: AsyncSession,
        test_store: Store,
        galpon_store: Store,
        test_brand: Brand,
    ):
        """Loja galpão traz O.S. is_galpon=True de qualquer loja; a loja comum segue sem galpão."""
        svc = await _make_service(db_session, test_brand, "VN Lavagem Galpão", "vn", "38.00")
        day = datetime(2026, 7, 10, 14, 0)
        # O.S. de galpão lançada sob OUTRA loja: entra no resumo do galpão
        await _make_order(db_session, test_store, svc, day, "70.00", is_galpon=True)
        # O.S. comum da loja: fora do resumo do galpão
        await _make_order(db_session, test_store, svc, day, "38.00")
        await db_session.commit()

        data = await gather_daily_summary(db_session, galpon_store.id, REPORT_DATE, "Tester")
        assert data.estetica.vehicles_count == 1
        assert data.estetica.total_day == Decimal("70.00")
        assert data.estetica.total_month == Decimal("70.00")
        assert data.worked_days == 1

        # Resumo da loja comum continua excluindo o galpão
        data_store = await gather_daily_summary(db_session, test_store.id, REPORT_DATE, "Tester")
        assert Decimal("70.00") not in [r.value for r in data_store.estetica.rows]
        assert data_store.estetica.total_day == Decimal("38.00")


@pytest.mark.asyncio
class TestResumoDiarioEndpoint:
    async def test_returns_pdf(self, owner_client, test_store: Store):
        response = await owner_client.get(
            "/api/v1/service-orders/export/resumo-diario",
            params={"store_id": test_store.id, "date": "2026-07-10"},
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert response.content.startswith(b"%PDF")

    async def test_requires_store_access(self, authenticated_client, second_store: Store):
        # test_user pertence à test_store; second_store deve ser negada (404 opaco)
        response = await authenticated_client.get(
            "/api/v1/service-orders/export/resumo-diario",
            params={"store_id": second_store.id, "date": "2026-07-10"},
        )
        assert response.status_code == 404

    async def test_owner_generates_galpon_summary(self, owner_client, galpon_store: Store):
        response = await owner_client.get(
            "/api/v1/service-orders/export/resumo-diario",
            params={"store_id": galpon_store.id, "date": "2026-07-10"},
        )
        assert response.status_code == 200
        assert response.content.startswith(b"%PDF")

    async def test_galpon_profile_only_generates_galpon(
        self, client, db_session: AsyncSession, test_store: Store, galpon_store: Store
    ):
        from tests.integration.test_galpon_scoping import (
            _link,
            _login,
            _make_profile,
            _make_user,
        )

        user = await _make_user(db_session, "galpao.resumo@test.com")
        profile = await _make_profile(
            db_session, "Galpão Resumo", [test_store, galpon_store], is_galpon_profile=True
        )
        await _link(db_session, profile, user)
        await _login(client, "galpao.resumo@test.com")

        # Loja comum: bloqueado
        response = await client.get(
            "/api/v1/service-orders/export/resumo-diario",
            params={"store_id": test_store.id, "date": "2026-07-10"},
        )
        assert response.status_code == 403

        # Loja galpão: permitido
        response = await client.get(
            "/api/v1/service-orders/export/resumo-diario",
            params={"store_id": galpon_store.id, "date": "2026-07-10"},
        )
        assert response.status_code == 200
        assert response.content.startswith(b"%PDF")

    async def test_hide_galpon_profile_cannot_generate_galpon(
        self, client, db_session: AsyncSession, test_store: Store, galpon_store: Store
    ):
        from tests.integration.test_galpon_scoping import (
            _link,
            _login,
            _make_profile,
            _make_user,
        )

        user = await _make_user(db_session, "semgalpao.resumo@test.com")
        profile = await _make_profile(
            db_session, "Sem Galpão Resumo", [test_store, galpon_store], hide_galpon_option=True
        )
        await _link(db_session, profile, user)
        await _login(client, "semgalpao.resumo@test.com")

        # Loja galpão: bloqueado
        response = await client.get(
            "/api/v1/service-orders/export/resumo-diario",
            params={"store_id": galpon_store.id, "date": "2026-07-10"},
        )
        assert response.status_code == 403

        # Loja comum: permitido
        response = await client.get(
            "/api/v1/service-orders/export/resumo-diario",
            params={"store_id": test_store.id, "date": "2026-07-10"},
        )
        assert response.status_code == 200


@pytest.mark.asyncio
class TestHolidaysCrud:
    async def test_owner_crud_flow(self, owner_client, test_store: Store):
        # create global
        response = await owner_client.post(
            "/api/v1/holidays",
            json={"date": "2026-09-07", "name": "Independência", "store_id": None},
        )
        assert response.status_code == 201
        holiday_id = response.json()["id"]
        assert response.json()["store_name"] is None

        # duplicado no mesmo escopo → 409
        response = await owner_client.post(
            "/api/v1/holidays",
            json={"date": "2026-09-07", "name": "Outro", "store_id": None},
        )
        assert response.status_code == 409

        # mesma data para loja específica é permitido
        response = await owner_client.post(
            "/api/v1/holidays",
            json={"date": "2026-09-07", "name": "Aniversário da Loja", "store_id": test_store.id},
        )
        assert response.status_code == 201
        assert response.json()["store_name"] == test_store.name

        # list por ano
        response = await owner_client.get("/api/v1/holidays", params={"year": 2026})
        assert response.status_code == 200
        assert response.json()["pagination"]["total"] == 2

        # update
        response = await owner_client.patch(
            f"/api/v1/holidays/{holiday_id}", json={"name": "Independência do Brasil"}
        )
        assert response.status_code == 200
        assert response.json()["name"] == "Independência do Brasil"

        # delete
        response = await owner_client.delete(f"/api/v1/holidays/{holiday_id}")
        assert response.status_code == 200

        response = await owner_client.get("/api/v1/holidays", params={"year": 2026})
        assert response.json()["pagination"]["total"] == 1

    async def test_write_requires_stores_permission(self, authenticated_client):
        # perfil de teste só tem service_orders → escrita negada
        response = await authenticated_client.post(
            "/api/v1/holidays",
            json={"date": "2026-12-25", "name": "Natal", "store_id": None},
        )
        assert response.status_code == 403

        # leitura é liberada para autenticados
        response = await authenticated_client.get("/api/v1/holidays")
        assert response.status_code == 200


@pytest.mark.asyncio
class TestFaultDateValidation:
    async def test_fault_without_date_is_rejected(self, owner_client, test_employee):
        response = await owner_client.post(
            f"/api/v1/employees/{test_employee.id}/movements",
            json={
                "type": "fault",
                "movement_date": "2026-07-10",
                "movement_data": {"fault_type": "injustificada"},
            },
        )
        assert response.status_code == 422

    async def test_fault_with_date_is_accepted(self, owner_client, test_employee):
        response = await owner_client.post(
            f"/api/v1/employees/{test_employee.id}/movements",
            json={
                "type": "fault",
                "movement_date": "2026-07-10",
                "movement_data": {"fault_type": "injustificada", "date": "2026-07-10"},
            },
        )
        assert response.status_code in (200, 201)
