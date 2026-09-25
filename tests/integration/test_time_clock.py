"""
Testes do Ponto Eletrônico.

Cobre:
- Punch: vínculo obrigatório, hora do servidor, sequência in/out, geofence
  (dentro/fora do raio, loja sem coordenadas), foto do storage próprio
- Permissões: time_clock (bater) e time_clock_mirror (espelho)
- Espelho: listagem por loja/dia
- Lembretes: janela de horário, quem já bateu não recebe, idempotência
"""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.audit import AuditLog
from app.modules.access_profiles.models import (
    AccessProfile,
    AccessProfileModulePermission,
    access_profile_users,
)
from app.modules.employees.models import Employee
from app.modules.stores.models import Store
from app.modules.time_clock import service as tc_service
from app.modules.time_clock.integrity import compute_record_hash, verify_chain
from app.modules.time_clock.models import (
    TimeClockImmutableError,
    TimeClockRecord,
    TimeClockReminderSent,
)
from app.modules.time_clock.service import haversine_m, process_reminders

TZ = ZoneInfo("America/Sao_Paulo")
VALID_PHOTO = "http://localhost:8000/uploads/photos/selfie.jpg"


@pytest_asyncio.fixture
async def ponto_profile(db_session: AsyncSession, test_user):
    """Perfil com permissão time_clock + time_clock_mirror para o test_user."""
    profile = AccessProfile(name="Perfil Ponto", is_active=True)
    db_session.add(profile)
    await db_session.flush()
    for sub_module in ("time_clock", "time_clock_mirror"):
        db_session.add(
            AccessProfileModulePermission(
                profile_id=profile.id,
                module_group="OPERACIONAL",
                sub_module=sub_module,
                can_view=True,
                can_edit=False,
                can_delete=False,
            )
        )
    await db_session.flush()
    await db_session.execute(
        access_profile_users.insert().values(profile_id=profile.id, user_id=test_user.id)
    )
    await db_session.commit()
    return profile


@pytest_asyncio.fixture
async def linked_employee(db_session: AsyncSession, test_store: Store, test_user) -> Employee:
    """Funcionário vinculado ao test_user."""
    employee = Employee(
        name="Batedor",
        store_id=test_store.id,
        is_active=True,
        user_id=test_user.id,
        cpf="12345678901",
        work_start_time=time(8, 0),
        work_end_time=time(18, 0),
    )
    db_session.add(employee)
    await db_session.commit()
    await db_session.refresh(employee)
    return employee


@pytest_asyncio.fixture
async def ponto_client(authenticated_client, ponto_profile):
    """Cliente autenticado com permissão de ponto."""
    return authenticated_client


def _punch_body(punch_type: str = "in", **overrides) -> dict:
    body = {
        "type": punch_type,
        "photo_url": VALID_PHOTO,
        "latitude": -22.906,
        "longitude": -43.172,
        "accuracy_m": 12.5,
    }
    body.update(overrides)
    return body


@pytest.mark.asyncio
class TestEnrollFace:
    """Cadastro do rosto de referência (Fase 1 do reconhecimento facial 1:1)."""

    async def test_requires_link(self, owner_client):
        # Owner passa na permissão mas não tem vínculo com funcionário → 422
        resp = await owner_client.post(
            "/api/v1/time-clock/enroll-face",
            json={"embedding": [0.1] * 128, "consent": True},
        )
        assert resp.status_code == 422
        assert "vinculado" in resp.json()["detail"].lower()

    async def test_requires_consent(self, ponto_client, linked_employee):
        resp = await ponto_client.post(
            "/api/v1/time-clock/enroll-face",
            json={"embedding": [0.1] * 128, "consent": False},
        )
        assert resp.status_code == 422
        assert "consentimento" in resp.json()["detail"].lower()

    async def test_rejects_short_embedding(self, ponto_client, linked_employee):
        resp = await ponto_client.post(
            "/api/v1/time-clock/enroll-face",
            json={"embedding": [0.1] * 8, "consent": True},
        )
        assert resp.status_code == 422

    async def test_enroll_persists_and_me_reflects(self, ponto_client, linked_employee):
        resp = await ponto_client.post(
            "/api/v1/time-clock/enroll-face",
            json={"embedding": [0.1] * 128, "consent": True},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["enrolled"] is True
        assert body["dimension"] == 128

        # /me passa a indicar que o rosto já foi cadastrado.
        me = await ponto_client.get("/api/v1/time-clock/me")
        assert me.status_code == 200
        assert me.json()["face_enrolled"] is True


@pytest.mark.asyncio
class TestPunchFaceMatch:
    """Score facial na batida é ADVISORY — grava mas NUNCA recusa (um REP não bloqueia)."""

    async def test_matching_and_mismatch_are_both_recorded(
        self, ponto_client, db_session: AsyncSession, linked_employee
    ):
        # Cadastra um rosto de referência direto no funcionário.
        ref = [1.0, 0.0] + [0.0] * 30  # 32 dimensões (mínimo aceito)
        linked_employee.face_embedding = ref
        await db_session.commit()

        # Batida com o MESMO vetor → similaridade ~1, verified True, 201.
        resp = await ponto_client.post(
            "/api/v1/time-clock/punch", json=_punch_body("in", face_embedding=ref)
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["face_match_score"] is not None
        assert body["face_match_score"] > 0.99
        assert body["face_verified"] is True

        # Batida com vetor ORTOGONAL (outra pessoa) → similaridade ~0, verified False,
        # mas a batida é REGISTRADA (201) — nunca recusada.
        diff = [0.0, 1.0] + [0.0] * 30
        resp2 = await ponto_client.post(
            "/api/v1/time-clock/punch", json=_punch_body("out", face_embedding=diff)
        )
        assert resp2.status_code == 201
        body2 = resp2.json()
        assert body2["face_match_score"] is not None
        assert body2["face_match_score"] < 0.5
        assert body2["face_verified"] is False

    async def test_no_embedding_leaves_score_null(
        self, ponto_client, db_session: AsyncSession, linked_employee
    ):
        linked_employee.face_embedding = [1.0] + [0.0] * 31
        await db_session.commit()
        resp = await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("in"))
        assert resp.status_code == 201
        assert resp.json()["face_match_score"] is None
        assert resp.json()["face_verified"] is None


class TestHaversine:
    def test_known_distance(self):
        # Cristo Redentor → Pão de Açúcar ≈ 6,05 km
        dist = haversine_m(-22.9519, -43.2105, -22.9486, -43.1566)
        assert 5500 < dist < 6500

    def test_same_point_is_zero(self):
        assert haversine_m(-22.9, -43.1, -22.9, -43.1) == 0


@pytest.mark.asyncio
class TestPunch:
    async def test_requires_link(self, owner_client):
        # Owner passa na permissão mas não tem vínculo com funcionário
        response = await owner_client.post("/api/v1/time-clock/punch", json=_punch_body())
        assert response.status_code == 422
        assert "vinculado" in response.json()["detail"].lower()

    async def test_requires_permission(self, authenticated_client, linked_employee):
        # test_user tem vínculo mas o perfil (service_orders) não tem time_clock
        response = await authenticated_client.post("/api/v1/time-clock/punch", json=_punch_body())
        assert response.status_code == 403

    async def test_records_all_punches_without_blocking(self, ponto_client, linked_employee):
        # A marcação NUNCA é impedida: qualquer sequência é registrada (princípio
        # do REP — Portaria 671). O backend não recusa por ordem nem por repetição.

        # Saída sem entrada → REGISTRA (201), com hora do servidor
        response = await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("out"))
        assert response.status_code == 201
        assert response.json()["recorded_at"] is not None
        assert response.json()["type"] == "out"

        # Entrada → 201
        response = await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("in"))
        assert response.status_code == 201

        # Entrada repetida em seguida → também REGISTRA (sem 409, sem duplo-clique)
        response = await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("in"))
        assert response.status_code == 201

    async def test_geofence_flags(
        self, ponto_client, db_session: AsyncSession, test_store: Store, linked_employee
    ):
        # Loja sem coordenadas → distância/raio nulos
        response = await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("in"))
        assert response.status_code == 201
        assert response.json()["distance_m"] is None
        assert response.json()["is_within_radius"] is None

        # Cadastra coordenadas: batida no mesmo ponto → dentro do raio
        test_store.latitude = -22.906
        test_store.longitude = -43.172
        await db_session.commit()

        response = await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("out"))
        assert response.status_code == 201
        assert float(response.json()["distance_m"]) < 5
        assert response.json()["is_within_radius"] is True

        # Batida ~1,5km longe → fora do raio (200m), mas REGISTRA (nunca bloqueia)
        response = await ponto_client.post(
            "/api/v1/time-clock/punch",
            json=_punch_body("in", latitude=-22.92, longitude=-43.172),
        )
        assert response.status_code == 201
        assert response.json()["is_within_radius"] is False
        assert float(response.json()["distance_m"]) > 1000

    async def test_client_reported_at_is_metadata_only(self, ponto_client, linked_employee):
        # O app pode mandar o horário do próprio relógio, mas o oficial é o do servidor.
        resp = await ponto_client.post(
            "/api/v1/time-clock/punch",
            json=_punch_body("in", client_reported_at="2000-01-01T00:00:00-03:00"),
        )
        assert resp.status_code == 201
        body = resp.json()
        # Metadado do cliente é preservado...
        assert body["client_reported_at"].startswith("2000-01-01")
        # ...mas recorded_at (oficial, servidor) NÃO é o horário do cliente.
        assert not body["recorded_at"].startswith("2000-01-01")

    async def test_rejects_external_photo(self, ponto_client, linked_employee):
        response = await ponto_client.post(
            "/api/v1/time-clock/punch",
            json=_punch_body("in", photo_url="https://malicioso.com/foto.jpg"),
        )
        assert response.status_code == 422

    async def test_me_states(self, ponto_client, linked_employee):
        response = await ponto_client.get("/api/v1/time-clock/me")
        assert response.status_code == 200
        body = response.json()
        assert body["employee_id"] == linked_employee.id
        assert body["last_type"] is None
        assert body["work_start_time"] == "08:00:00"

        await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("in"))
        body = (await ponto_client.get("/api/v1/time-clock/me")).json()
        assert body["last_type"] == "in"
        assert len(body["today"]) == 1

    async def test_me_without_link(self, owner_client):
        response = await owner_client.get("/api/v1/time-clock/me")
        assert response.status_code == 200
        assert response.json()["employee_id"] is None


@pytest.mark.asyncio
class TestMirror:
    async def test_requires_mirror_permission(self, owner_client, ponto_client):
        # Owner sempre pode
        response = await owner_client.get("/api/v1/time-clock")
        assert response.status_code == 200

    async def test_lists_by_store_and_day(self, ponto_client, linked_employee, test_store: Store):
        await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("in"))

        response = await ponto_client.get("/api/v1/time-clock", params={"store_id": test_store.id})
        assert response.status_code == 200
        body = response.json()
        assert body["pagination"]["total"] == 1
        assert body["items"][0]["employee_name"] == "Batedor"

        # Dia sem batidas
        response = await ponto_client.get(
            "/api/v1/time-clock",
            params={"store_id": test_store.id, "date": "2020-01-01"},
        )
        assert response.json()["pagination"]["total"] == 0

    async def test_export_pdf(self, owner_client, test_store: Store):
        today = tc_service.local_today().isoformat()
        response = await owner_client.get(
            "/api/v1/time-clock/export/pdf",
            params={"store_id": test_store.id, "date": today},
        )
        assert response.status_code == 200
        assert response.content.startswith(b"%PDF")


@pytest.mark.asyncio
class TestReminders:
    async def _make_employee(self, db, store, user_id, start=time(8, 0), end=time(18, 0)):
        emp = Employee(
            name=f"Func {user_id}",
            store_id=store.id,
            is_active=True,
            user_id=user_id,
            work_start_time=start,
            work_end_time=end,
        )
        db.add(emp)
        await db.flush()
        return emp

    async def test_window_and_idempotency(
        self, db_session: AsyncSession, test_store: Store, test_user, test_owner
    ):
        emp = await self._make_employee(db_session, test_store, test_user.id)
        # Funcionário fora da janela (entrada 06:00, agora 08:10)
        await self._make_employee(db_session, test_store, test_owner.id, start=time(6, 0))
        await db_session.commit()

        now = datetime(2026, 7, 14, 8, 10, tzinfo=TZ)

        sent = await process_reminders(db_session, now)
        assert sent == 1  # só o funcionário com entrada 08:00 na janela [08:00, 08:30]

        # Segunda execução no mesmo tick: idempotente
        sent = await process_reminders(db_session, now)
        assert sent == 0

        marks = (
            (
                await db_session.execute(
                    __import__("sqlalchemy")
                    .select(TimeClockReminderSent)
                    .where(TimeClockReminderSent.employee_id == emp.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(marks) == 1

    async def test_no_reminder_after_punch(
        self, db_session: AsyncSession, test_store: Store, test_user
    ):
        emp = await self._make_employee(db_session, test_store, test_user.id)
        db_session.add(
            TimeClockRecord(
                employee_id=emp.id,
                user_id=test_user.id,
                store_id=test_store.id,
                type="in",
                recorded_date=date(2026, 7, 14),
                latitude=-22.9,
                longitude=-43.1,
                photo_url=VALID_PHOTO,
            )
        )
        await db_session.commit()

        now = datetime(2026, 7, 14, 8, 10, tzinfo=TZ)
        sent = await process_reminders(db_session, now)
        assert sent == 0

    async def test_exit_reminder(self, db_session: AsyncSession, test_store: Store, test_user):
        await self._make_employee(db_session, test_store, test_user.id)
        await db_session.commit()

        now = datetime(2026, 7, 14, 18, 5, tzinfo=TZ)
        sent = await process_reminders(db_session, now)
        assert sent == 1


@pytest.mark.asyncio
class TestFeatureFlag:
    """TIME_CLOCK_ENABLED=false (ex.: produção) desliga o módulo inteiro."""

    async def test_disabled_module_returns_404(self, owner_client, monkeypatch):
        from app.config import get_settings

        monkeypatch.setattr(get_settings(), "TIME_CLOCK_ENABLED", False)
        response = await owner_client.get("/api/v1/time-clock/me")
        assert response.status_code == 404

    async def test_reminders_task_skips_when_disabled(self, monkeypatch):
        from app.config import get_settings
        from app.workers.tasks import send_time_clock_reminders

        monkeypatch.setattr(get_settings(), "TIME_CLOCK_ENABLED", False)
        result = send_time_clock_reminders.apply().result
        assert result == {"reminders_sent": 0, "disabled": True}


def _make_raw_punch(
    store_id: int, employee_id: int, user_id: int, ptype: str = "in"
) -> TimeClockRecord:
    """Cria (em memória) uma batida bruta para testar imutabilidade/anulação."""
    return TimeClockRecord(
        employee_id=employee_id,
        user_id=user_id,
        store_id=store_id,
        type=ptype,
        recorded_date=tc_service.local_today(),
        latitude=-22.906,
        longitude=-43.172,
        photo_url=VALID_PHOTO,
    )


@pytest.mark.asyncio
class TestImmutabilityAndCorrections:
    """Item A: imutabilidade estrutural + correção por registro vinculado + auditoria."""

    async def test_record_cannot_be_updated_or_deleted(
        self, db_session: AsyncSession, test_store: Store, test_user, linked_employee
    ):
        rec = _make_raw_punch(test_store.id, linked_employee.id, test_user.id)
        db_session.add(rec)
        await db_session.commit()
        rec_id = rec.id  # captura antes de qualquer expire (rollback expira atributos)

        # UPDATE direto é bloqueado pela guarda de imutabilidade.
        rec.type = "out"
        with pytest.raises(TimeClockImmutableError):
            await db_session.flush()
        await db_session.rollback()

        # DELETE direto também é bloqueado.
        again = await db_session.get(TimeClockRecord, rec_id)
        await db_session.delete(again)
        with pytest.raises(TimeClockImmutableError):
            await db_session.flush()
        await db_session.rollback()

    async def test_adjustment_creates_linked_record_and_audits(
        self, owner_client, db_session: AsyncSession, linked_employee
    ):
        resp = await owner_client.post(
            "/api/v1/time-clock/adjustments",
            json={
                "employee_id": linked_employee.id,
                "type": "in",
                "recorded_at": "2026-08-05T08:00:00-03:00",
                "reason": "Esqueceu de bater a entrada",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["source"] == "admin_adjustment"
        assert body["adjustment_reason"].startswith("Esqueceu")
        # Ajuste não tem GPS/selfie.
        assert body["photo_url"] is None
        assert body["latitude"] is None
        assert body["type"] == "in"

        # Trilha de auditoria registrou quem/o quê.
        audits = (
            (
                await db_session.execute(
                    select(AuditLog).where(AuditLog.action == "time_clock_adjustment_created")
                )
            )
            .scalars()
            .all()
        )
        assert len(audits) == 1
        assert audits[0].resource_id == body["id"]
        assert audits[0].new_value["reason"].startswith("Esqueceu")

    async def test_annul_creates_annulment_and_blocks_double(
        self, owner_client, db_session: AsyncSession, test_store: Store, test_user, linked_employee
    ):
        original = _make_raw_punch(test_store.id, linked_employee.id, test_user.id)
        db_session.add(original)
        await db_session.commit()

        resp = await owner_client.post(
            f"/api/v1/time-clock/{original.id}/annul",
            json={"reason": "Batida indevida"},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["annuls_record_id"] == original.id
        assert body["source"] == "admin_adjustment"
        # O bruto original permanece (imutável), a anulação é um NOVO registro.
        assert body["id"] != original.id

        # Segunda anulação da mesma batida → 409.
        resp2 = await owner_client.post(
            f"/api/v1/time-clock/{original.id}/annul",
            json={"reason": "de novo"},
        )
        assert resp2.status_code == 409

    async def test_adjustment_requires_can_edit(self, ponto_client, linked_employee):
        # ponto_profile concede time_clock_mirror can_view mas NÃO can_edit → 403.
        resp = await ponto_client.post(
            "/api/v1/time-clock/adjustments",
            json={
                "employee_id": linked_employee.id,
                "type": "in",
                "recorded_at": "2026-08-05T08:00:00-03:00",
                "reason": "tentativa sem permissão",
            },
        )
        assert resp.status_code == 403


@pytest.mark.asyncio
class TestAfdAej:
    """Item D: geração de AFD (tipo 1/7/9) e AEJ compatíveis com o leiaute (sem assinatura)."""

    async def test_afd_structure_and_audit(
        self,
        owner_client,
        db_session: AsyncSession,
        test_store: Store,
        test_user,
        linked_employee,
        monkeypatch,
    ):
        from app.config import get_settings

        settings = get_settings()
        monkeypatch.setattr(settings, "EMPLOYER_CNPJ", "12345678000199")
        monkeypatch.setattr(settings, "EMPLOYER_NAME", "Empresa Teste LTDA")

        from app.modules.time_clock.schemas import PunchRequest

        linked_employee.cpf = "12345678901"
        # Batidas pelo service para receberem o NSR persistido (1, 2) — o AFD
        # agora usa o NSR da corrente, não um contador recalculado na exportação.
        await tc_service.punch(
            db_session,
            test_user.id,
            PunchRequest(type="in", photo_url=VALID_PHOTO, latitude=-22.906, longitude=-43.172),
        )
        await tc_service.punch(
            db_session,
            test_user.id,
            PunchRequest(type="out", photo_url=VALID_PHOTO, latitude=-22.906, longitude=-43.172),
        )
        await db_session.commit()

        today = tc_service.local_today().isoformat()
        resp = await owner_client.get(
            "/api/v1/time-clock/export/afd",
            params={"store_id": test_store.id, "start": today, "end": today},
        )
        assert resp.status_code == 200
        lines = resp.content.decode("latin-1").strip().split("\r\n")

        # Cabeçalho tipo 1 com NSR zerado, CNPJ e razão social do empregador.
        assert lines[0].startswith("000000000" + "1")
        assert "12345678000199" in lines[0]
        assert "EMPRESA TESTE" in lines[0].upper()

        # Duas marcações REP-P (tipo 7), NSR sequencial 1 e 2, com o CPF do trabalhador.
        assert lines[1][:10] == "000000001" + "7"
        assert lines[2][:10] == "000000002" + "7"
        assert "12345678901" in lines[1]

        # Trailer tipo 9 totaliza 2 marcações tipo 7.
        assert lines[-1].startswith("999999999" + "9")
        assert lines[-1].endswith("000000002")

        # Geração registrada na trilha de auditoria.
        audits = (
            (
                await db_session.execute(
                    select(AuditLog).where(AuditLog.action == "time_clock_afd_exported")
                )
            )
            .scalars()
            .all()
        )
        assert len(audits) == 1

    async def test_aej_structure(
        self,
        owner_client,
        db_session: AsyncSession,
        test_store: Store,
        test_user,
        linked_employee,
    ):
        linked_employee.cpf = "12345678901"
        db_session.add(_make_raw_punch(test_store.id, linked_employee.id, test_user.id, "in"))
        await db_session.commit()

        today = tc_service.local_today().isoformat()
        resp = await owner_client.get(
            "/api/v1/time-clock/export/aej",
            params={"store_id": test_store.id, "start": today, "end": today},
        )
        assert resp.status_code == 200
        text = resp.content.decode("latin-1")
        # Deixa explícito que é simplificado e sem assinatura.
        assert "AEJ-SIMPLIFICADO-SEM-ASSINATURA" in text
        lines = text.strip().split("\r\n")
        # Registro de empregado (tipo 3) com CPF e registro de marcação (tipo 4).
        assert any(ln.startswith("3") and "12345678901" in ln for ln in lines)
        assert any(ln.startswith("4") for ln in lines)
        assert lines[-1].startswith("9")

    async def test_fetch_includes_adjustments_and_excludes_annulled(
        self,
        db_session: AsyncSession,
        test_store: Store,
        test_owner,
        test_user,
        linked_employee,
    ):
        """F3 (auditoria): a jornada efetiva do AFD/AEJ deve INCLUIR ajustes do RH
        (batidas esquecidas) e EXCLUIR batidas anuladas + o próprio marcador de
        anulação. Antes, o filtro source=='employee' omitia ajustes e mantinha as
        anuladas → arquivo legal inconsistente.
        """
        from app.modules.time_clock import afd_aej
        from app.modules.time_clock.schemas import TimeClockAdjustmentCreate

        linked_employee.cpf = "12345678901"

        # A: batida do funcionário (mantida). B: batida do funcionário que será anulada.
        a = _make_raw_punch(test_store.id, linked_employee.id, test_user.id, "in")
        b = _make_raw_punch(test_store.id, linked_employee.id, test_user.id, "out")
        db_session.add_all([a, b])
        await db_session.commit()
        a_id, b_id = a.id, b.id

        # Ajuste do RH (batida esquecida) — deve entrar na jornada.
        today = tc_service.local_today()
        adj = await tc_service.create_adjustment(
            db_session,
            test_owner,
            TimeClockAdjustmentCreate(
                employee_id=linked_employee.id,
                type="in",
                recorded_at=datetime.combine(today, time(5, 0), tzinfo=TZ),
                reason="Esqueceu a entrada",
            ),
        )
        adj_id = adj.id

        # Anula B — a original sai da jornada e o marcador de anulação não é marcação.
        annulment = await tc_service.annul_record(db_session, test_owner, b_id, "indevida")
        await db_session.commit()

        _, effective = await afd_aej._fetch(db_session, test_store.id, today, today)
        ids = {r.id for r in effective}

        assert a_id in ids, "batida válida do funcionário deve permanecer"
        assert adj_id in ids, "ajuste do RH (batida esquecida) deve entrar"
        assert b_id not in ids, "batida anulada não pode aparecer"
        assert annulment.id not in ids, "marcador de anulação não é marcação"
        assert all(r.annuls_record_id is None for r in effective)

        # Um ajuste do RH que é POSTERIORMENTE anulado também deve sair da jornada.
        await tc_service.annul_record(db_session, test_owner, adj_id, "ajuste indevido")
        await db_session.commit()
        _, effective2 = await afd_aej._fetch(db_session, test_store.id, today, today)
        assert adj_id not in {r.id for r in effective2}, "ajuste anulado deve sair"


@pytest.mark.asyncio
class TestSelfServiceMirror:
    """Item C: autoatendimento — o funcionário consulta/exporta o próprio espelho."""

    async def test_me_mirror_month(self, ponto_client, linked_employee):
        await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("in"))
        resp = await ponto_client.get("/api/v1/time-clock/me/mirror", params={"period": "month"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["period"] == "month"
        assert body["employee_id"] == linked_employee.id
        assert len(body["items"]) == 1

    async def test_me_mirror_requires_link(self, owner_client):
        # Owner passa na permissão mas não tem vínculo → 422.
        resp = await owner_client.get("/api/v1/time-clock/me/mirror")
        assert resp.status_code == 422

    async def test_me_export_pdf(self, ponto_client, linked_employee):
        await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("in"))
        resp = await ponto_client.get("/api/v1/time-clock/me/export/pdf", params={"period": "24h"})
        assert resp.status_code == 200
        assert resp.content.startswith(b"%PDF")


class TestRetentionGuard:
    """Item E: retenção — nada no código (app/) apaga batidas de ponto."""

    def test_no_delete_routine_for_time_clock_records(self):
        import pathlib

        app_dir = pathlib.Path(tc_service.__file__).resolve().parents[2]
        assert app_dir.name == "app"
        offenders = []
        for path in app_dir.rglob("*.py"):
            low = path.read_text(encoding="utf-8").lower().replace(" ", "")
            if "deletefromtime_clock_records" in low or "delete(timeclockrecord)" in low:
                offenders.append(str(path))
        assert not offenders, f"Rotina de exclusão de batidas encontrada: {offenders}"


# ══════════════════════════════════════════════════════════════════════════════
# REP-A: NSR persistido + corrente de hash + batida offline + comprovante
# ══════════════════════════════════════════════════════════════════════════════


@pytest.fixture
def employer_configured():
    """Empregador preenchido (AFD/comprovante) — restaura o estado ao final."""
    s = get_settings()
    old = (s.EMPLOYER_CNPJ, s.EMPLOYER_NAME)
    s.EMPLOYER_CNPJ = "12345678000199"
    s.EMPLOYER_NAME = "EMPRESA EXEMPLO LTDA"
    yield s
    s.EMPLOYER_CNPJ, s.EMPLOYER_NAME = old


@pytest.fixture
def employer_missing():
    """Empregador vazio (AFD deve recusar) — restaura o estado ao final."""
    s = get_settings()
    old = (s.EMPLOYER_CNPJ, s.EMPLOYER_NAME)
    s.EMPLOYER_CNPJ = ""
    s.EMPLOYER_NAME = ""
    yield s
    s.EMPLOYER_CNPJ, s.EMPLOYER_NAME = old


class TestIntegrityHash:
    """Função pura de hash encadeado (Task 1)."""

    def test_hash_is_deterministic_and_depends_on_prev(self):
        base = dict(
            nsr=1,
            cpf="12345678901",
            type_="in",
            recorded_at=datetime(2026, 9, 1, 11, 0, tzinfo=TZ),
            store_id=3,
            source="employee",
            annuls_record_id=None,
        )
        h1 = compute_record_hash(prev_hash=None, **base)
        h1_again = compute_record_hash(prev_hash=None, **base)
        h2 = compute_record_hash(prev_hash="ABCDEF", **base)
        assert h1 == h1_again  # determinístico
        assert h1 != h2  # muda com o elo anterior
        assert len(h1) == 64 and h1 == h1.upper()  # SHA-256 hex maiúsculo


@pytest.mark.asyncio
class TestPunchIntegrity:
    """NSR sequencial + horário fiel para batida offline (Task 3)."""

    async def test_punch_assigns_sequential_nsr_and_chain(self, ponto_client, linked_employee):
        r1 = await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("in"))
        r2 = await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("out"))
        b1, b2 = r1.json(), r2.json()
        assert b1["nsr"] == 1 and b2["nsr"] == 2
        assert b1["is_offline_record"] is False

    async def test_offline_punch_uses_client_time_as_official(self, ponto_client, linked_employee):
        client_dt = datetime.now(timezone.utc) - timedelta(hours=2)
        body = _punch_body("in", is_offline=True, client_reported_at=client_dt.isoformat())
        resp = await ponto_client.post("/api/v1/time-clock/punch", json=body)
        assert resp.status_code == 201
        data = resp.json()
        assert data["is_offline_record"] is True
        assert data["synced_at"] is not None  # instante do recebimento
        # horário oficial = o do dispositivo (não o do servidor)
        recorded = datetime.fromisoformat(data["recorded_at"])
        assert abs((recorded - client_dt).total_seconds()) < 2

    async def test_offline_punch_rejects_future_client_time(self, ponto_client, linked_employee):
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        body = _punch_body("in", is_offline=True, client_reported_at=future)
        resp = await ponto_client.post("/api/v1/time-clock/punch", json=body)
        assert resp.status_code == 422

    async def test_offline_punch_without_client_time_rejected(self, ponto_client, linked_employee):
        # is_offline=True sem client_reported_at não pode virar batida online silenciosa.
        body = _punch_body("in", is_offline=True)
        resp = await ponto_client.post("/api/v1/time-clock/punch", json=body)
        assert resp.status_code == 422

    async def test_late_offline_sync_is_flagged(self, ponto_client, linked_employee):
        # Offline sincronizada >24h após a marcação (dentro dos 7 dias) → sinalizada.
        client_dt = datetime.now(timezone.utc) - timedelta(days=2)
        body = _punch_body("in", is_offline=True, client_reported_at=client_dt.isoformat())
        resp = await ponto_client.post("/api/v1/time-clock/punch", json=body)
        assert resp.status_code == 201
        assert resp.json()["offline_sync_late"] is True

    async def test_recent_offline_sync_not_flagged(self, ponto_client, linked_employee):
        client_dt = datetime.now(timezone.utc) - timedelta(hours=1)
        body = _punch_body("in", is_offline=True, client_reported_at=client_dt.isoformat())
        resp = await ponto_client.post("/api/v1/time-clock/punch", json=body)
        assert resp.json()["offline_sync_late"] is False


@pytest.mark.asyncio
class TestChainOnAdjustments:
    """Ajuste e anulação entram na corrente (Task 4).

    Nível de serviço: `owner_client` e `ponto_client` compartilham o mesmo objeto
    httpx (o último token resolvido vence), então a batida do funcionário e o
    ajuste/anulação do RH são feitos direto pelo service com a mesma sessão.
    """

    async def test_adjustment_gets_sequential_nsr(
        self, db_session: AsyncSession, test_owner, test_user, linked_employee
    ):
        from app.modules.time_clock.schemas import PunchRequest, TimeClockAdjustmentCreate

        p = await tc_service.punch(
            db_session,
            test_user.id,
            PunchRequest(type="in", photo_url=VALID_PHOTO, latitude=-22.906, longitude=-43.172),
        )
        assert p.nsr == 1
        adj = await tc_service.create_adjustment(
            db_session,
            test_owner,
            TimeClockAdjustmentCreate(
                employee_id=linked_employee.id,
                type="out",
                recorded_at=datetime(2026, 9, 1, 17, 0, tzinfo=TZ),
                reason="esqueceu de bater",
            ),
        )
        assert adj.nsr == 2  # segue a corrente

    async def test_annul_gets_sequential_nsr(
        self, db_session: AsyncSession, test_owner, test_user, linked_employee
    ):
        from app.modules.time_clock.schemas import PunchRequest

        p = await tc_service.punch(
            db_session,
            test_user.id,
            PunchRequest(type="in", photo_url=VALID_PHOTO, latitude=-22.906, longitude=-43.172),
        )
        assert p.nsr == 1
        annulment = await tc_service.annul_record(db_session, test_owner, p.id, "batida duplicada")
        assert annulment.nsr == 2


@pytest.mark.asyncio
class TestVerifyChain:
    """Verificação da corrente detecta adulteração (Task 5)."""

    async def test_chain_valid_then_broken(self, ponto_client, linked_employee, db_session):
        await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("in"))
        await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("out"))
        ok, bad = await verify_chain(db_session)
        assert ok is True and bad is None

        # Adultera direto no banco, contornando a guarda ORM (UPDATE por statement).
        await db_session.execute(
            sa_update(TimeClockRecord).where(TimeClockRecord.nsr == 1).values(type="out")
        )
        await db_session.flush()
        ok, bad = await verify_chain(db_session)
        assert ok is False and bad == 1


@pytest.mark.asyncio
class TestAfdPersistedNsr:
    """AFD usa NSR/hash persistidos e exige CNPJ (Task 6)."""

    async def test_afd_uses_persisted_nsr_stable_across_exports(
        self, ponto_client, linked_employee, db_session, test_store, employer_configured
    ):
        from app.modules.time_clock import afd_aej

        await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("in"))
        start = end = tc_service.local_today()
        afd1 = await afd_aej.generate_afd(db_session, test_store.id, start, end)
        afd2 = await afd_aej.generate_afd(db_session, test_store.id, start, end)
        assert afd1 == afd2  # NSR estável entre exportações

    async def test_afd_refuses_without_employer_cnpj(
        self, ponto_client, linked_employee, db_session, test_store, employer_missing
    ):
        from app.core.exceptions import ValidationError
        from app.modules.time_clock import afd_aej

        await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("in"))
        start = end = tc_service.local_today()
        with pytest.raises(ValidationError):
            await afd_aej.generate_afd(db_session, test_store.id, start, end)


@pytest.mark.asyncio
class TestReceipt:
    """Comprovante de registro JSON + PDF com NSR real (Task 7)."""

    async def test_punch_response_includes_receipt(
        self, ponto_client, linked_employee, employer_configured
    ):
        resp = await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("in"))
        receipt = resp.json()["receipt"]
        assert receipt["nsr"] == 1
        assert receipt["employer_cnpj"] == "12345678000199"
        assert receipt["employee_cpf"] is not None
        assert receipt["system_id"] == "AEMS-REP-A"

    async def test_receipt_pdf_endpoint(self, ponto_client, linked_employee, employer_configured):
        r = await ponto_client.post("/api/v1/time-clock/punch", json=_punch_body("in"))
        rid = r.json()["id"]
        pdf = await ponto_client.get(f"/api/v1/time-clock/records/{rid}/receipt?format=pdf")
        assert pdf.status_code == 200
        assert pdf.headers["content-type"].startswith("application/pdf")

    async def test_receipt_denies_other_employees_record(
        self, ponto_client, db_session: AsyncSession, test_store: Store, linked_employee
    ):
        # Batida de OUTRO funcionário (não vinculado ao usuário logado) → 404,
        # sem vazar CPF/nome nem permitir enumeração (IDOR).
        other = Employee(name="Outro", store_id=test_store.id, is_active=True, cpf="99999999999")
        db_session.add(other)
        await db_session.flush()
        rec = _make_raw_punch(test_store.id, other.id, None, "in")
        db_session.add(rec)
        await db_session.commit()
        resp = await ponto_client.get(f"/api/v1/time-clock/records/{rec.id}/receipt")
        assert resp.status_code == 404


@pytest.mark.asyncio
class TestMirrorOfflineFlag:
    """Espelho admin expõe a flag offline (Task 8)."""

    async def test_mirror_marks_offline(self, owner_client, ponto_client, linked_employee):
        client_dt = datetime.now(timezone.utc) - timedelta(hours=1)
        body = _punch_body("in", is_offline=True, client_reported_at=client_dt.isoformat())
        punch = await ponto_client.post("/api/v1/time-clock/punch", json=body)
        # Consulta pela data da própria batida (robusto à virada de dia local).
        rec_date = punch.json()["recorded_date"]
        resp = await owner_client.get(
            f"/api/v1/time-clock?store_id={linked_employee.store_id}&date={rec_date}"
        )
        assert resp.status_code == 200
        assert any(r["is_offline_record"] for r in resp.json()["items"])
