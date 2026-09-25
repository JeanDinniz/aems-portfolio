"""
Time Clock service - Business logic do ponto eletrônico.

Regras:
- Só bate ponto usuário vinculado a um funcionário ativo (Employee.user_id) —
  isso é identificação/autenticação, não restrição de jornada.
- Horário da batida = servidor; "dia de negócio" = data local America/Sao_Paulo.
- A marcação NUNCA é impedida: registra-se fielmente TODA batida do trabalhador.
  Não há validação de sequência que recuse nem anti-duplo-clique no servidor (a
  UI apenas sugere entrada/saída pelo último tipo e confirma toques acidentais).
- Geofence e reconhecimento facial gravam metadados e sinalizam, mas NUNCA
  recusam a batida. Isso segue o princípio do REP: registrar sem bloquear
  (Portaria MTP 671/2021).
"""

import math
from datetime import UTC, datetime, time, timedelta
from datetime import date as date_type
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings, get_settings
from app.core.audit import log_audit
from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.core.media_url import validate_internal_media_url
from app.core.pagination import paginate
from app.modules.employees.models import Employee
from app.modules.time_clock.integrity import assign_chain_fields
from app.modules.time_clock.models import TimeClockRecord
from app.modules.time_clock.schemas import (
    PunchRequest,
    TimeClockAdjustmentCreate,
    TimeClockReceipt,
    TimeClockRecordResponse,
)

TZ_LOCAL = ZoneInfo("America/Sao_Paulo")
DEFAULT_WORK_START = time(8, 0)
DEFAULT_WORK_END = time(18, 0)

TYPE_LABELS = {"in": "Entrada", "out": "Saída"}

# Reconhecimento facial. Limiar advisory de similaridade de cosseno ([-1..1])
# para marcar `face_verified`. NUNCA bloqueia a batida — só grava o score e o
# resultado como metadado (um REP não pode recusar a marcação).
FACE_MATCH_THRESHOLD = 0.5


def _cosine_similarity(a: list[float], b: list[float]) -> float | None:
    """Cosseno entre dois vetores. None se dimensões divergem ou norma ~0."""
    if not a or not b or len(a) != len(b):
        return None
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b, strict=True):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 1e-12 or nb <= 1e-12:
        return None
    return dot / (math.sqrt(na) * math.sqrt(nb))


def local_today() -> date_type:
    """Data local (America/Sao_Paulo) de agora."""
    return datetime.now(TZ_LOCAL).date()


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distância em metros entre duas coordenadas (fórmula de haversine)."""
    earth_radius_m = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return earth_radius_m * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def get_employee_for_user(db: AsyncSession, user_id: int) -> Employee | None:
    """Funcionário ativo vinculado ao usuário (autorização do ponto)."""
    result = await db.execute(
        select(Employee)
        .options(selectinload(Employee.store))
        .where(
            Employee.user_id == user_id,
            Employee.is_active.is_(True),
            Employee.hr_status == "active",
        )
    )
    return result.scalar_one_or_none()


def build_receipt(
    record: TimeClockRecord, settings: Settings, employee: Employee | None = None
) -> TimeClockReceipt:
    """Comprovante de registro (NSR real, empregador, hash curto de conferência)."""
    employee = employee if employee is not None else record.employee
    name = ""
    if employee:
        name = (
            f"{employee.name} {employee.last_name}".strip() if employee.last_name else employee.name
        )
    return TimeClockReceipt(
        nsr=record.nsr,
        employer_name=settings.EMPLOYER_NAME,
        employer_cnpj=settings.EMPLOYER_CNPJ,
        employee_name=name,
        employee_cpf=employee.cpf if employee else None,
        type=record.type,
        recorded_at=record.recorded_at,
        is_offline_record=record.is_offline_record,
        system_id=settings.TIME_CLOCK_SYSTEM_ID,
        hash_short=(record.record_hash or "")[-8:],
    )


def is_offline_sync_late(record: TimeClockRecord, settings: Settings) -> bool:
    """True se a batida offline foi sincronizada muito depois da marcação.

    Alerta de conferência do RH contra backdating: `synced_at − recorded_at`
    acima de `OFFLINE_SYNC_ALERT_HOURS`. Só se aplica a registros offline.
    """
    if not record.is_offline_record or record.synced_at is None or record.recorded_at is None:
        return False
    delay = record.synced_at - record.recorded_at
    return delay > timedelta(hours=settings.OFFLINE_SYNC_ALERT_HOURS)


def _record_to_response(record: TimeClockRecord) -> TimeClockRecordResponse:
    employee = record.employee if "employee" in record.__dict__ else None
    store = record.store if "store" in record.__dict__ else None
    name = None
    if employee:
        name = (
            f"{employee.name} {employee.last_name}".strip() if employee.last_name else employee.name
        )
    settings = get_settings()
    receipt = build_receipt(record, settings, employee=employee) if record.nsr is not None else None
    return TimeClockRecordResponse(
        id=record.id,
        employee_id=record.employee_id,
        employee_name=name,
        store_id=record.store_id,
        store_name=store.name if store else None,
        type=record.type,
        recorded_at=record.recorded_at,
        recorded_date=record.recorded_date,
        client_reported_at=record.client_reported_at,
        latitude=record.latitude,
        longitude=record.longitude,
        accuracy_m=record.accuracy_m,
        distance_m=record.distance_m,
        is_within_radius=record.is_within_radius,
        photo_url=record.photo_url,
        face_match_score=record.face_match_score,
        face_verified=record.face_verified,
        source=record.source,
        adjustment_reason=record.adjustment_reason,
        annuls_record_id=record.annuls_record_id,
        nsr=record.nsr,
        is_offline_record=record.is_offline_record,
        synced_at=record.synced_at,
        offline_sync_late=is_offline_sync_late(record, settings),
        receipt=receipt,
    )


async def punch(db: AsyncSession, user_id: int, data: PunchRequest) -> TimeClockRecord:
    """Registra uma batida de ponto para o funcionário vinculado ao usuário."""
    employee = await get_employee_for_user(db, user_id)
    if employee is None:
        raise ValidationError(
            detail="Seu usuário não está vinculado a um funcionário. Fale com o administrador."
        )

    validate_internal_media_url(data.photo_url, field="Foto da batida")

    # A marcação NUNCA é impedida: não há validação de sequência que recuse nem
    # anti-duplo-clique no servidor. Registra-se fielmente toda batida — a UI
    # sugere entrada/saída pelo último tipo do dia e confirma toques acidentais
    # (princípio do REP: registrar sem bloquear — Portaria MTP 671/2021).

    # Horário oficial (REP-A / Opção A): batida online usa o servidor; batida
    # coletada offline usa o horário real do dispositivo (client_reported_at),
    # sinalizada e com synced_at = instante do recebimento. Janela de sanidade
    # rejeita relógio adiantado além do skew e sync fora do prazo máximo.
    settings = get_settings()
    now_server = datetime.now(UTC)
    if data.is_offline and data.client_reported_at is None:
        raise ValidationError(
            detail="Batida offline exige o horário do dispositivo (client_reported_at)."
        )
    if data.is_offline and data.client_reported_at is not None:
        official_at = data.client_reported_at
        if official_at.tzinfo is None:
            official_at = official_at.replace(tzinfo=TZ_LOCAL)
        skew = timedelta(minutes=settings.OFFLINE_CLOCK_SKEW_MINUTES)
        if official_at > now_server + skew:
            raise ValidationError(detail="Horário da batida offline não pode ser futuro.")
        if official_at < now_server - timedelta(days=settings.OFFLINE_MAX_AGE_DAYS):
            raise ValidationError(detail="Batida offline excede o prazo máximo de sincronização.")
        recorded_at = official_at
        is_offline = True
        synced_at: datetime | None = now_server
    else:
        recorded_at = now_server
        is_offline = False
        synced_at = None

    recorded_date = recorded_at.astimezone(TZ_LOCAL).date()

    # Geofence: distância à loja (nunca bloqueia)
    store = employee.store
    distance_m: Decimal | None = None
    is_within_radius: bool | None = None
    if store and store.latitude is not None and store.longitude is not None:
        distance = haversine_m(
            float(data.latitude),
            float(data.longitude),
            float(store.latitude),
            float(store.longitude),
        )
        distance_m = Decimal(str(round(distance, 2)))
        is_within_radius = distance <= store.geofence_radius_m

    # Reconhecimento facial (advisory): compara a selfie da batida com o rosto de
    # referência quando ambos existem e grava a similaridade + o resultado pelo
    # limiar. NUNCA recusa a batida (um REP não pode bloquear a marcação); o score
    # fica no espelho para conferência do RH.
    face_match_score: float | None = None
    face_verified: bool | None = None
    if employee.face_embedding and data.face_embedding:
        score = _cosine_similarity(employee.face_embedding, data.face_embedding)
        if score is not None:
            face_match_score = score
            face_verified = score >= FACE_MATCH_THRESHOLD

    record = TimeClockRecord(
        employee_id=employee.id,
        user_id=user_id,
        store_id=employee.store_id,
        type=data.type,
        recorded_at=recorded_at,
        recorded_date=recorded_date,
        client_reported_at=data.client_reported_at,
        is_offline_record=is_offline,
        synced_at=synced_at,
        source="employee",
        latitude=data.latitude,
        longitude=data.longitude,
        accuracy_m=data.accuracy_m,
        distance_m=distance_m,
        is_within_radius=is_within_radius,
        photo_url=data.photo_url,
        face_match_score=face_match_score,
        face_verified=face_verified,
    )
    # Corrente de integridade (NSR + record_hash) antes de persistir.
    await assign_chain_fields(db, record, employee.cpf)
    db.add(record)
    await db.flush()
    # Recarrega com employee/store para a projeção (nome + comprovante). NÃO
    # mutar o registro persistido aqui: qualquer alteração o marca como "dirty"
    # e o autoflush seguinte dispara a guarda de imutabilidade.
    return await _reload_record(db, record.id)


async def _reload_record(db: AsyncSession, record_id: int) -> TimeClockRecord:
    """Recarrega uma batida com employee/store para a projeção da resposta."""
    result = await db.execute(
        select(TimeClockRecord)
        .options(selectinload(TimeClockRecord.employee), selectinload(TimeClockRecord.store))
        .where(TimeClockRecord.id == record_id)
    )
    return result.scalar_one()


async def create_adjustment(
    db: AsyncSession, actor, data: TimeClockAdjustmentCreate, request=None
) -> TimeClockRecord:
    """
    Ajuste administrativo (RH): lança uma batida esquecida como NOVO registro
    vinculado (source='admin_adjustment'). NUNCA sobrescreve a marcação bruta.
    `recorded_at` é o horário pretendido; `created_at` marca quando o RH lançou.
    Registra na trilha de auditoria (quem, quando, motivo).
    """
    from app.core.permissions import require_resource_access

    employee = await db.get(Employee, data.employee_id)
    if employee is None:
        raise NotFoundError(resource="Funcionário")
    require_resource_access(actor, employee.store_id, "Funcionário")

    recorded_at = data.recorded_at
    if recorded_at.tzinfo is None:
        recorded_at = recorded_at.replace(tzinfo=TZ_LOCAL)
    recorded_date = recorded_at.astimezone(TZ_LOCAL).date()

    record = TimeClockRecord(
        employee_id=employee.id,
        user_id=employee.user_id,
        store_id=employee.store_id,
        type=data.type,
        recorded_at=recorded_at,
        recorded_date=recorded_date,
        source="admin_adjustment",
        created_by_user_id=actor.id,
        adjustment_reason=data.reason,
    )
    await assign_chain_fields(db, record, employee.cpf)
    db.add(record)
    await db.flush()
    await log_audit(
        db,
        action="time_clock_adjustment_created",
        resource_type="time_clock_record",
        user_id=actor.id,
        resource_id=record.id,
        new_value={
            "employee_id": employee.id,
            "type": data.type,
            "recorded_at": recorded_at,
            "reason": data.reason,
        },
        request=request,
    )
    return await _reload_record(db, record.id)


async def annul_record(
    db: AsyncSession, actor, record_id: int, reason: str, request=None
) -> TimeClockRecord:
    """
    Anula uma batida existente criando um registro de ANULAÇÃO vinculado
    (annuls_record_id). O bruto original permanece imutável. Registra na trilha
    de auditoria. Recusa anular uma batida já anulada.
    """
    from app.core.permissions import require_resource_access

    original = await db.get(TimeClockRecord, record_id)
    if original is None:
        raise NotFoundError(resource="Batida")
    require_resource_access(actor, original.store_id, "Batida")

    already = (
        await db.execute(
            select(TimeClockRecord.id).where(TimeClockRecord.annuls_record_id == record_id)
        )
    ).scalar_one_or_none()
    if already is not None:
        raise ConflictError(detail="Esta batida já foi anulada.")

    annulment = TimeClockRecord(
        employee_id=original.employee_id,
        user_id=original.user_id,
        store_id=original.store_id,
        type=original.type,
        recorded_at=datetime.now(UTC),
        recorded_date=local_today(),
        source="admin_adjustment",
        created_by_user_id=actor.id,
        adjustment_reason=reason,
        annuls_record_id=record_id,
    )
    employee = await db.get(Employee, original.employee_id)
    await assign_chain_fields(db, annulment, employee.cpf if employee else None)
    db.add(annulment)
    await db.flush()
    await log_audit(
        db,
        action="time_clock_record_annulled",
        resource_type="time_clock_record",
        user_id=actor.id,
        resource_id=record_id,
        new_value={"annulment_record_id": annulment.id, "reason": reason},
        request=request,
    )
    return await _reload_record(db, annulment.id)


async def enroll_face(
    db: AsyncSession, user_id: int, embedding: list[float], consent: bool
) -> dict:
    """
    Cadastra o rosto de REFERÊNCIA (embedding) do funcionário vinculado ao
    usuário. Guarda apenas o vetor gerado no aparelho (não a imagem crua) e
    registra o consentimento LGPD. Sobrescreve um cadastro anterior (re-enroll).
    """
    from datetime import UTC

    employee = await get_employee_for_user(db, user_id)
    if employee is None:
        raise ValidationError(
            detail="Seu usuário não está vinculado a um funcionário. Fale com o administrador."
        )
    if not consent:
        raise ValidationError(
            detail="É necessário o consentimento para cadastrar o reconhecimento facial."
        )

    now = datetime.now(UTC)
    employee.face_embedding = [float(x) for x in embedding]
    employee.face_enrolled_at = now
    employee.face_consent_at = now
    await db.flush()
    return {"enrolled": True, "enrolled_at": now, "dimension": len(embedding)}


async def get_me(db: AsyncSession, user_id: int) -> dict:
    """Estado do ponto do usuário: vínculo, batidas de hoje e últimos 7 dias."""
    employee = await get_employee_for_user(db, user_id)
    if employee is None:
        return {"employee_id": None}

    today = local_today()
    result = await db.execute(
        select(TimeClockRecord)
        .where(
            TimeClockRecord.employee_id == employee.id,
            TimeClockRecord.recorded_date >= today - timedelta(days=6),
        )
        .order_by(TimeClockRecord.recorded_at.desc(), TimeClockRecord.id.desc())
    )
    recent = list(result.scalars().all())
    today_records = [r for r in recent if r.recorded_date == today]

    display = (
        f"{employee.name} {employee.last_name}".strip() if employee.last_name else employee.name
    )
    return {
        "employee_id": employee.id,
        "employee_name": display,
        "store_name": employee.store.name if employee.store else None,
        "work_start_time": employee.work_start_time or DEFAULT_WORK_START,
        "work_end_time": employee.work_end_time or DEFAULT_WORK_END,
        "face_enrolled": employee.face_embedding is not None,
        "last_type": today_records[0].type if today_records else None,
        "today": [_record_to_response(r) for r in today_records],
        "recent": [_record_to_response(r) for r in recent],
    }


def my_mirror_range(period: str) -> tuple[date_type, date_type]:
    """Intervalo [start, end] (datas locais) para o autoatendimento: 24h ou mês corrente."""
    today = local_today()
    if period == "month":
        return today.replace(day=1), today
    # '24h' → dia de hoje e ontem (cobre as últimas 24h de forma robusta a fuso)
    return today - timedelta(days=1), today


async def get_my_mirror(db: AsyncSession, user_id: int, period: str) -> dict | None:
    """
    Autoatendimento (Portaria 671): o próprio funcionário consulta seu espelho das
    últimas 24h ou do mês corrente, sem depender do RH. None se não há vínculo.
    """
    employee = await get_employee_for_user(db, user_id)
    if employee is None:
        return None

    start, end = my_mirror_range(period)
    result = await db.execute(
        select(TimeClockRecord)
        .options(selectinload(TimeClockRecord.employee), selectinload(TimeClockRecord.store))
        .where(
            TimeClockRecord.employee_id == employee.id,
            TimeClockRecord.recorded_date >= start,
            TimeClockRecord.recorded_date <= end,
        )
        .order_by(TimeClockRecord.recorded_at.desc(), TimeClockRecord.id.desc())
    )
    records = list(result.scalars().all())
    display = (
        f"{employee.name} {employee.last_name}".strip() if employee.last_name else employee.name
    )
    return {
        "period": period,
        "employee_id": employee.id,
        "employee_name": display,
        "store_name": employee.store.name if employee.store else None,
        "start": start,
        "end": end,
        "items": [_record_to_response(r) for r in records],
    }


async def list_records(
    db: AsyncSession,
    user,
    store_id: int | None = None,
    day: date_type | None = None,
    employee_id: int | None = None,
    page: int = 1,
    limit: int = 50,
) -> tuple[list[TimeClockRecord], int]:
    """Espelho de ponto (admin): registros por loja/dia/funcionário."""
    from app.core.permissions import apply_store_filter

    query = select(TimeClockRecord).options(
        selectinload(TimeClockRecord.employee),
        selectinload(TimeClockRecord.store),
    )

    query = apply_store_filter(query, user, TimeClockRecord.store_id)

    if store_id is not None:
        query = query.where(TimeClockRecord.store_id == store_id)
    if day is not None:
        query = query.where(TimeClockRecord.recorded_date == day)
    if employee_id is not None:
        query = query.where(TimeClockRecord.employee_id == employee_id)

    return await paginate(db, query, page, limit, order_by=TimeClockRecord.recorded_at.desc())


def record_to_response(record: TimeClockRecord) -> TimeClockRecordResponse:
    """Projeção pública (usada pelo router do espelho)."""
    return _record_to_response(record)


REMINDER_WINDOW_MINUTES = 30

REMINDER_MESSAGES = {
    "in": ("Hora de bater o ponto!", "Não esqueça de registrar sua ENTRADA de hoje."),
    "out": ("Hora de bater o ponto!", "Não esqueça de registrar sua SAÍDA de hoje."),
}


async def process_reminders(db: AsyncSession, now_local: datetime) -> int:
    """
    Lembretes de ponto: para cada funcionário vinculado e ativo cujo horário
    de entrada/saída caiu na janela [horário, horário+30min] e sem batida
    correspondente hoje, envia notificação (in-app + WS + push Expo + Web Push
    via create_notification). Idempotente por (funcionário, dia, tipo).

    Extraída da task Celery para ser testável com uma sessão injetada.
    """
    from sqlalchemy.exc import IntegrityError

    from app.modules.notifications.service import create_notification
    from app.modules.time_clock.models import TimeClockReminderSent

    today = now_local.date()
    window = timedelta(minutes=REMINDER_WINDOW_MINUTES)

    def in_window(target: time) -> bool:
        start_dt = datetime.combine(today, target, tzinfo=now_local.tzinfo)
        return start_dt <= now_local <= start_dt + window

    employees = (
        (
            await db.execute(
                select(Employee).where(
                    Employee.user_id.isnot(None),
                    Employee.is_active.is_(True),
                    Employee.hr_status == "active",
                )
            )
        )
        .scalars()
        .all()
    )
    if not employees:
        return 0

    emp_ids = [e.id for e in employees]
    punches_today = (
        await db.execute(
            select(TimeClockRecord.employee_id, TimeClockRecord.type).where(
                TimeClockRecord.employee_id.in_(emp_ids),
                TimeClockRecord.recorded_date == today,
            )
        )
    ).all()
    punched = {(row.employee_id, row.type) for row in punches_today}

    sent_count = 0
    for emp in employees:
        checks = (
            ("in", emp.work_start_time or DEFAULT_WORK_START),
            ("out", emp.work_end_time or DEFAULT_WORK_END),
        )
        for punch_type, target_time in checks:
            if not in_window(target_time):
                continue
            if (emp.id, punch_type) in punched:
                continue

            # Idempotência: só notifica se a marca inserir (UNIQUE por emp/dia/tipo)
            try:
                async with db.begin_nested():
                    db.add(
                        TimeClockReminderSent(
                            employee_id=emp.id,
                            reminder_date=today,
                            type=punch_type,
                        )
                    )
                    await db.flush()
            except IntegrityError:
                continue

            title, body = REMINDER_MESSAGES[punch_type]
            await create_notification(
                db,
                user_id=emp.user_id,
                type="time_clock_reminder",
                title=title,
                body=body,
            )
            sent_count += 1

    return sent_count
