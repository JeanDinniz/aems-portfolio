"""
Testes do status do dia (Faltas do Dia) e das permissões de movimentações.

Cobre:
- Derivação de status: presente | falta | ferias | afastado
- Afastamento por datas (dentro do período / encerrado → needs_return)
- Fallback legado: hr_status='away' sem afastamento datado → afastado
- Endpoint GET /employees/day-status (acesso por loja)
- Fase 3: POST/DELETE movements exigem permissão employees + loja
- POST /employees/{id}/return-from-absence
"""

from datetime import date

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.employees.models import Employee, EmployeeMovement
from app.modules.employees.service import get_day_status
from app.modules.stores.models import Store

DAY = date(2026, 7, 10)


def _employee(store_id: int, name: str, **kwargs) -> Employee:
    return Employee(name=name, store_id=store_id, is_active=True, **kwargs)


def _movement(employee_id: int, mtype: str, data: dict) -> EmployeeMovement:
    return EmployeeMovement(
        employee_id=employee_id,
        type=mtype,
        movement_date=DAY,
        movement_data=data,
    )


@pytest.mark.asyncio
class TestGetDayStatus:
    async def test_status_derivation(self, db_session: AsyncSession, test_store: Store):
        present = _employee(test_store.id, "Presente")
        faulted = _employee(test_store.id, "Faltou")
        vacationer = _employee(test_store.id, "Ferista")
        on_absence = _employee(test_store.id, "Afastado Datado", hr_status="away")
        legacy_away = _employee(test_store.id, "Afastado Legado", hr_status="away")
        returned = _employee(test_store.id, "Voltou", hr_status="away")
        db_session.add_all([present, faulted, vacationer, on_absence, legacy_away, returned])
        await db_session.flush()

        db_session.add_all(
            [
                _movement(
                    faulted.id,
                    "fault",
                    {"fault_type": "atestado", "date": "2026-07-09", "days_count": 2},
                ),
                _movement(
                    vacationer.id,
                    "vacation",
                    {"start_date": "2026-07-01", "return_date": "2026-07-15"},
                ),
                _movement(
                    on_absence.id,
                    "absence",
                    {"absence_type": "inss", "start_date": "2026-07-05", "return_date": "2026-08-01"},
                ),
                # Afastamento encerrado antes do dia → needs_return
                _movement(
                    returned.id,
                    "absence",
                    {"absence_type": "atestado", "start_date": "2026-07-01", "return_date": "2026-07-08"},
                ),
            ]
        )
        await db_session.commit()

        items = {i["name"]: i for i in await get_day_status(db_session, test_store.id, DAY)}

        assert items["Presente"]["status"] == "presente"

        # Falta de 2 dias (09-10/07) cobre o dia 10
        assert items["Faltou"]["status"] == "falta"
        assert items["Faltou"]["reason"] == "Falta: Atestado"
        assert items["Faltou"]["fault_movement_id"] is not None

        assert items["Ferista"]["status"] == "ferias"

        assert items["Afastado Datado"]["status"] == "afastado"
        assert items["Afastado Datado"]["reason"] == "Afastamento: INSS"

        # away sem movimento datado → afastado (legado)
        assert items["Afastado Legado"]["status"] == "afastado"
        assert items["Afastado Legado"]["reason"] == "Afastamento"

        # away com afastamento já encerrado → presente + needs_return
        assert items["Voltou"]["status"] == "presente"
        assert items["Voltou"]["needs_return"] is True

    async def test_vacation_return_date_is_exclusive(
        self, db_session: AsyncSession, test_store: Store
    ):
        emp = _employee(test_store.id, "Volta Hoje")
        db_session.add(emp)
        await db_session.flush()
        # return_date = dia 10 → dia 10 já é trabalho
        db_session.add(
            _movement(emp.id, "vacation", {"start_date": "2026-07-01", "return_date": "2026-07-10"})
        )
        await db_session.commit()

        items = await get_day_status(db_session, test_store.id, DAY)
        assert items[0]["status"] == "presente"

    async def test_attachment_url_exposed_for_covering_movement(
        self, db_session: AsyncSession, test_store: Store
    ):
        """Anexo do movimento (atestado/print) aparece no status do dia."""
        with_photo = _employee(test_store.id, "Com Anexo")
        without_photo = _employee(test_store.id, "Sem Anexo")
        db_session.add_all([with_photo, without_photo])
        await db_session.flush()

        fault = _movement(
            with_photo.id,
            "fault",
            {"fault_type": "atestado", "date": "2026-07-10", "days_count": 1},
        )
        fault.attachment_url = "/uploads/photos/atestado.jpg"
        db_session.add_all(
            [
                fault,
                _movement(
                    without_photo.id,
                    "fault",
                    {"fault_type": "injustificada", "date": "2026-07-10", "days_count": 1},
                ),
            ]
        )
        await db_session.commit()

        items = {i["name"]: i for i in await get_day_status(db_session, test_store.id, DAY)}
        assert items["Com Anexo"]["attachment_url"] == "/uploads/photos/atestado.jpg"
        assert items["Sem Anexo"]["attachment_url"] is None


@pytest.mark.asyncio
class TestDayStatusEndpoint:
    async def test_returns_summary(self, owner_client, db_session, test_store: Store):
        emp = _employee(test_store.id, "Fulano")
        db_session.add(emp)
        await db_session.commit()

        response = await owner_client.get(
            "/api/v1/employees/day-status",
            params={"store_id": test_store.id, "date": "2026-07-10"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["present"] == 1
        assert body["items"][0]["name"] == "Fulano"

    async def test_requires_store_access(self, authenticated_client, second_store: Store):
        response = await authenticated_client.get(
            "/api/v1/employees/day-status",
            params={"store_id": second_store.id, "date": "2026-07-10"},
        )
        assert response.status_code == 404


@pytest.mark.asyncio
class TestMovementPermissions:
    async def test_create_requires_employees_permission(
        self, authenticated_client, test_employee
    ):
        # perfil de teste só tem service_orders → 403
        response = await authenticated_client.post(
            f"/api/v1/employees/{test_employee.id}/movements",
            json={
                "type": "fault",
                "movement_date": "2026-07-10",
                "movement_data": {"fault_type": "folga", "date": "2026-07-10"},
            },
        )
        assert response.status_code == 403

    async def test_owner_create_and_delete(self, owner_client, test_employee):
        response = await owner_client.post(
            f"/api/v1/employees/{test_employee.id}/movements",
            json={
                "type": "fault",
                "movement_date": "2026-07-10",
                "movement_data": {"fault_type": "folga", "date": "2026-07-10"},
            },
        )
        assert response.status_code == 201
        movement_id = response.json()["id"]

        response = await owner_client.delete(
            f"/api/v1/employees/{test_employee.id}/movements/{movement_id}"
        )
        assert response.status_code == 200


@pytest.mark.asyncio
class TestFrequencyReport:
    async def test_counters_and_occurrences(
        self, db_session: AsyncSession, test_store: Store
    ):
        from app.modules.employees.frequency_report import gather_frequency_report
        from app.modules.holidays.models import Holiday

        emp = _employee(test_store.id, "Contado")
        db_session.add(emp)
        await db_session.flush()

        db_session.add_all(
            [
                # Falta de 2 dias: qui 09/07 e sex 10/07
                _movement(
                    emp.id,
                    "fault",
                    {"fault_type": "injustificada", "date": "2026-07-09", "days_count": 2},
                ),
                # Férias 20/07 (seg) a 25/07 (sáb) — retorno dia 27 é exclusivo? não: retorno 26 (dom)
                _movement(
                    emp.id,
                    "vacation",
                    {"start_date": "2026-07-20", "return_date": "2026-07-26"},
                ),
            ]
        )
        # Feriado numa quarta desconta dos dias úteis
        db_session.add(Holiday(date=date(2026, 7, 15), name="Feriado Teste", store_id=None))
        await db_session.commit()

        data = await gather_frequency_report(db_session, emp.id, date(2026, 7, 10), "Tester")

        # Julho/2026: 27 dias seg–sáb, menos 1 feriado
        assert data.business_days == 26
        assert data.fault_days == 2
        assert data.faults_by_type == {"Injustificada": 2}
        # Férias 20–25/07 = seg a sáb = 6 dias úteis
        assert data.vacation_days == 6
        assert data.present_days == 26 - 2 - 6
        assert len(data.occurrences) == 2
        kinds = {o.kind for o in data.occurrences}
        assert kinds == {"Falta: Injustificada", "Férias"}

    async def test_endpoint_returns_pdf(self, owner_client, test_employee):
        response = await owner_client.get(
            f"/api/v1/employees/{test_employee.id}/frequency-report",
            params={"date": "2026-07-10"},
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert response.content.startswith(b"%PDF")

    async def test_endpoint_requires_store_access(
        self, authenticated_client, db_session, second_store: Store
    ):
        emp = _employee(second_store.id, "De Outra Loja")
        db_session.add(emp)
        await db_session.commit()

        response = await authenticated_client.get(
            f"/api/v1/employees/{emp.id}/frequency-report",
            params={"date": "2026-07-10"},
        )
        assert response.status_code == 404


@pytest.mark.asyncio
class TestReturnFromAbsence:
    async def test_owner_marks_return(self, owner_client, db_session, test_store: Store):
        emp = _employee(test_store.id, "Afastado", hr_status="away")
        db_session.add(emp)
        await db_session.commit()

        response = await owner_client.post(f"/api/v1/employees/{emp.id}/return-from-absence")
        assert response.status_code == 200
        assert response.json()["hr_status"] == "active"

    async def test_rejects_if_not_away(self, owner_client, test_employee):
        response = await owner_client.post(
            f"/api/v1/employees/{test_employee.id}/return-from-absence"
        )
        assert response.status_code == 422
