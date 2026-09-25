"""
Lógica do módulo Desempenho de Instaladores.

Fonte: ServiceOrderWorker (vínculo instalador↔O.S., opcionalmente por item).
Só entram O.S. finalizadas (status == "completed"). A data-base é
completion_time (dia em que a O.S. foi finalizada), convertida para o fuso
local. O valor por instalador segue a convenção do ranking do Dashboard:
- vínculo por item (service_order_item_id preenchido) → valor daquele serviço;
- vínculo legado (item None, O.S. inteira) → todos os serviços da O.S.;
- O.S. cortesia (is_courtesy) ou retorno (is_return) → serviço conta, mas vale R$ 0
  (não são cobrados);
- serviço com K instaladores → cada um recebe valor/K e conta 1/K serviço
  (divisão igual; centavos de resto vão para os menores employee_id).
"""

import re
from datetime import date as date_type
from datetime import datetime, time, timedelta
from decimal import ROUND_DOWN, Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NotFoundError
from app.core.permissions import (
    apply_store_filter,
    hide_galpon_user,
    is_galpon_profile_user,
)
from app.modules.employees.models import Employee
from app.modules.installer_performance.schemas import (
    DailyInstallerGroup,
    DailyReportResponse,
    DailyVehicleRow,
    IndividualReportResponse,
    IndividualServiceRow,
    ReturnRow,
    ReturnsReportResponse,
    SummaryRankingRow,
    SummaryReportResponse,
    SummaryTotals,
)
from app.modules.inventory.models import FilmRoll
from app.modules.material_requests.models import MaterialPurchaseLine, MaterialRequest
from app.modules.service_orders.enums import OSStatus
from app.modules.service_orders.models import (
    ServiceOrder,
    ServiceOrderItem,
    ServiceOrderWorker,
)

TZ_LOCAL = ZoneInfo("America/Sao_Paulo")


def _local_range(start: date_type, end: date_type) -> tuple[datetime, datetime]:
    """[start 00:00, end+1dia 00:00) no fuso local — compara com completion_time."""
    start_dt = datetime.combine(start, time.min, tzinfo=TZ_LOCAL)
    end_dt = datetime.combine(end, time.min, tzinfo=TZ_LOCAL) + timedelta(days=1)
    return start_dt, end_dt


def _local_date(dt: datetime) -> date_type:
    """Data local de um datetime (aware ou naive tratado como local)."""
    if dt.tzinfo is None:
        return dt.date()
    return dt.astimezone(TZ_LOCAL).date()


# Separadores que marcam o início de lixo anexado à cor no lançamento
# (ex.: "BRANCO – VENDEDOR DANIELA / cliente carolina"). A cor real é o
# primeiro trecho antes do primeiro travessão/hífen isolado.
_COLOR_JUNK_RE = re.compile(r"\s*[–—]\s*|\s+-\s+")


def _clean_color(color: str | None) -> str | None:
    if not color:
        return color
    cleaned = _COLOR_JUNK_RE.split(color, maxsplit=1)[0].strip()
    return cleaned or None


def _vehicle_label(order: ServiceOrder) -> str | None:
    parts = [p for p in (order.vehicle_model, _clean_color(order.vehicle_color)) if p]
    return " · ".join(parts) if parts else None


def _car_key(plate: str | None, os_id: int) -> str:
    """Identidade do carro para a contagem: placa normalizada.
    O.S. sem placa conta como carro próprio (fallback no os_id)."""
    p = (plate or "").strip().upper()
    return p or f"#{os_id}"


def _is_unpaid(order: ServiceOrder) -> bool:
    """Cortesia e retorno não são cobrados — não entram no valor do instalador."""
    return bool(order.is_courtesy or order.is_return)


def _item_value(item: ServiceOrderItem) -> Decimal:
    # Decimal(str(...)): o SQLite dos testes devolve Numeric como float; coagir
    # aqui garante aritmética em Decimal em qualquer banco (Postgres já traz Decimal).
    price = item.unit_price if item.unit_price is not None else Decimal("0")
    return Decimal(str(price)) * (item.quantity or 1)


def _item_workers(order: ServiceOrder, item_id: int) -> list[int]:
    """
    Instaladores distintos atribuídos a um item: vínculos por item ∪ legados
    (item None = O.S. inteira). Ordenado por employee_id para a distribuição
    determinística dos centavos de resto em _item_share.
    """
    per_item = {w.employee_id for w in order.workers if w.service_order_item_id == item_id}
    legacy = {w.employee_id for w in order.workers if w.service_order_item_id is None}
    return sorted(per_item | legacy)


def _item_share(item: ServiceOrderItem, employee_id: int, workers: list[int]) -> Decimal:
    """
    Parcela do instalador no valor do item (divisão igual entre K instaladores).

    Base = total/K arredondado para baixo a centavos; os centavos de resto vão
    +R$0,01 para os primeiros instaladores em ordem de employee_id — a soma das
    parcelas é sempre exatamente o total do item.
    """
    total = _item_value(item)
    k = len(workers)
    if k <= 1 or employee_id not in workers:
        return total
    base = (total / k).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    rest_cents = int(((total - base * k) * 100).to_integral_value())
    extra = Decimal("0.01") if workers.index(employee_id) < rest_cents else Decimal("0")
    return base + extra


def _item_points(item: ServiceOrderItem, workers: list[int]) -> Decimal:
    """Pontos do item repartidos igualmente entre os K instaladores.

    Pontos contam SEMPRE (inclusive cortesia/retorno), diferente do valor.
    Fração exata (sem quantizar por instalador) para a soma geral fechar.
    """
    svc = item.service
    pts = Decimal(str(svc.points)) if svc and svc.points is not None else Decimal("0")
    total = pts * (item.quantity or 1)
    k = max(len(workers), 1)
    return total / k


def _relevant_items(order: ServiceOrder, employee_id: int) -> list[ServiceOrderItem]:
    """
    Serviços do instalador nesta O.S.

    - Se há workers por item para o instalador → só esses itens;
    - se há worker legado (item None) → todos os itens da O.S.
    """
    item_ids: set[int] = set()
    has_legacy = False
    for w in order.workers:
        if w.employee_id != employee_id:
            continue
        if w.service_order_item_id is None:
            has_legacy = True
        else:
            item_ids.add(w.service_order_item_id)
    if has_legacy:
        return sorted(order.items, key=lambda i: i.id)
    return [i for i in sorted(order.items, key=lambda i: i.id) if i.id in item_ids]


async def _load_completed_orders(
    db: AsyncSession,
    user,
    start: date_type,
    end: date_type,
    store_id: int | None,
    employee_id: int | None = None,
) -> list[ServiceOrder]:
    """O.S. finalizadas no período (por completion_time), com escopo de loja/galpão."""
    start_dt, end_dt = _local_range(start, end)
    query = (
        select(ServiceOrder)
        .options(
            selectinload(ServiceOrder.items).selectinload(ServiceOrderItem.service),
            selectinload(ServiceOrder.workers).selectinload(ServiceOrderWorker.employee),
            selectinload(ServiceOrder.store),
        )
        .where(
            ServiceOrder.status == OSStatus.COMPLETED.value,
            ServiceOrder.completion_time.is_not(None),
            ServiceOrder.completion_time >= start_dt,
            ServiceOrder.completion_time < end_dt,
        )
    )
    query = apply_store_filter(query, user, ServiceOrder.store_id)
    if store_id is not None:
        query = query.where(ServiceOrder.store_id == store_id)
    if is_galpon_profile_user(user):
        query = query.where(ServiceOrder.is_galpon.is_(True))
    elif hide_galpon_user(user):
        query = query.where(ServiceOrder.is_galpon.is_(False))
    if employee_id is not None:
        query = query.where(ServiceOrder.workers.any(ServiceOrderWorker.employee_id == employee_id))
    query = query.order_by(ServiceOrder.completion_time)
    result = await db.execute(query)
    return list(result.scalars().unique().all())


async def _resolve_store_name(db: AsyncSession, store_id: int | None) -> str | None:
    if store_id is None:
        return None
    from app.modules.stores.models import Store

    store = (await db.execute(select(Store).where(Store.id == store_id))).scalar_one_or_none()
    return store.name if store else None


async def get_daily_report(
    db: AsyncSession,
    user,
    report_date: date_type,
    store_id: int | None = None,
    search: str | None = None,
    employee_ids: list[int] | None = None,
) -> DailyReportResponse:
    """Relatório diário agrupado por instalador."""
    orders = await _load_completed_orders(db, user, report_date, report_date, store_id)

    # employee_id -> (name, list[DailyVehicleRow])
    groups: dict[int, dict] = {}
    for order in orders:
        # instaladores distintos que trabalharam na O.S.
        worker_emp_ids = {w.employee_id for w in order.workers if w.employee}
        for emp_id in worker_emp_ids:
            emp = next((w.employee for w in order.workers if w.employee_id == emp_id), None)
            if emp is None:
                continue
            items = _relevant_items(order, emp_id)
            if not items:
                continue
            value = Decimal("0")
            has_shared = False
            service_labels: list[str] = []
            for i in items:
                item_workers = _item_workers(order, i.id)
                if not _is_unpaid(order):
                    value += _item_share(i, emp_id, item_workers)
                label = (i.service.code or i.service.name) if i.service else ""
                if len(item_workers) > 1:
                    has_shared = True
                    if label:
                        label = f"{label} (÷{len(item_workers)})"
                if label:
                    service_labels.append(label)
            services = list(dict.fromkeys(service_labels))
            row = DailyVehicleRow(
                os_id=order.id,
                order_number=order.order_number,
                external_os_number=order.external_os_number,
                plate=order.vehicle_plate or "",
                vehicle=_vehicle_label(order),
                store_name=order.store.name if order.store else None,
                services=services,
                is_courtesy=order.is_courtesy,
                is_return=order.is_return,
                has_shared=has_shared,
                value=float(value),
            )
            g = groups.setdefault(emp_id, {"name": emp.name, "vehicles": []})
            g["vehicles"].append(row)

    # busca por instalador (nome), case-insensitive
    term = (search or "").strip().lower()
    # filtro por instalador (checkbox multi-seleção)
    id_filter = set(employee_ids) if employee_ids else None

    result_groups: list[DailyInstallerGroup] = []
    for emp_id, g in groups.items():
        if id_filter is not None and emp_id not in id_filter:
            continue
        if term and term not in (g["name"] or "").lower():
            continue
        vehicles: list[DailyVehicleRow] = g["vehicles"]
        result_groups.append(
            DailyInstallerGroup(
                employee_id=emp_id,
                employee_name=g["name"],
                vehicles=vehicles,
                total_cars=len({_car_key(v.plate, v.os_id) for v in vehicles}),
                total_revenue=round(sum(v.value for v in vehicles), 2),
            )
        )
    result_groups.sort(key=lambda x: x.employee_name.lower())

    return DailyReportResponse(
        report_date=report_date,
        store_name=await _resolve_store_name(db, store_id),
        groups=result_groups,
        grand_total_cars=sum(g.total_cars for g in result_groups),
        grand_total_revenue=round(sum(g.total_revenue for g in result_groups), 2),
    )


async def get_installer_ranking(
    db: AsyncSession,
    user,
    start: date_type,
    end: date_type,
    departments: list[str] | None = None,
    store_id: int | None = None,
    limit: int = 10,
) -> list[dict]:
    """
    Ranking de instaladores no período pela MESMA régua do relatório individual:
    só O.S. finalizadas (completed), data-base = completion_time, valor
    repartido entre os K instaladores do serviço e serviço compartilhado
    contando 1/K.

    Existe para o Ranking de Funcionários do Dashboard Executivo bater com a
    tela de Desempenho (antes o Dashboard contava O.S. em qualquer status por
    entry_time e dava o valor cheio da O.S. nos vínculos legados).

    departments: filtra pelo departamento DA O.S. em que o trabalho foi feito
    (não pelo cadastro do instalador). Retorna dicts prontos para o schema
    EmployeeRankingItem, ordenados por services_count desc e limitados a `limit`.
    """
    orders = await _load_completed_orders(db, user, start, end, store_id)
    if departments:
        dept_set = set(departments)
        orders = [o for o in orders if o.department in dept_set]

    agg: dict[int, dict] = {}
    for order in orders:
        worker_emp_ids = {w.employee_id for w in order.workers if w.employee}
        for emp_id in worker_emp_ids:
            emp = next((w.employee for w in order.workers if w.employee_id == emp_id), None)
            if emp is None:
                continue
            items = _relevant_items(order, emp_id)
            if not items:
                continue
            entry = agg.setdefault(
                emp_id,
                {
                    "employee_id": emp_id,
                    "employee_name": emp.name,
                    "department": emp.department,
                    "orders_count": 0,
                    "services_count": 0.0,
                    "revenue": Decimal("0"),
                    "hours_worked": 0.0,
                },
            )
            entry["orders_count"] += 1
            for i in items:
                item_workers = _item_workers(order, i.id)
                k = max(len(item_workers), 1)
                entry["services_count"] += 1 / k
                if not _is_unpaid(order):
                    entry["revenue"] += _item_share(i, emp_id, item_workers)
            entry["hours_worked"] += sum(
                float(w.hours_worked or 0) for w in order.workers if w.employee_id == emp_id
            )

    result = list(agg.values())
    for entry in result:
        oc = entry["orders_count"]
        entry["services_count"] = round(entry["services_count"], 2)
        entry["revenue"] = float(entry["revenue"])
        entry["avg_hours_per_order"] = round(entry["hours_worked"] / oc, 2) if oc else 0.0
    result.sort(key=lambda e: (-e["services_count"], (e["employee_name"] or "").lower()))
    return result[:limit]


async def get_individual_report(
    db: AsyncSession,
    user,
    start: date_type,
    end: date_type,
    employee_id: int,
    store_id: int | None = None,
) -> IndividualReportResponse:
    """Relatório individual detalhado de um instalador no período."""
    employee = (
        await db.execute(select(Employee).where(Employee.id == employee_id))
    ).scalar_one_or_none()
    if employee is None:
        raise NotFoundError(resource="Instalador")

    orders = await _load_completed_orders(db, user, start, end, store_id, employee_id=employee_id)

    rows: list[IndividualServiceRow] = []
    total_services = 0.0
    total_points = Decimal("0")
    for order in orders:
        items = _relevant_items(order, employee_id)
        if not items:
            continue
        completion_date = _local_date(order.completion_time) if order.completion_time else start
        value = Decimal("0")
        row_points = Decimal("0")
        has_shared = False
        service_labels: list[str] = []
        for i in items:
            item_workers = _item_workers(order, i.id)
            k = max(len(item_workers), 1)
            total_services += 1 / k
            if not _is_unpaid(order):
                value += _item_share(i, employee_id, item_workers)
            pts = _item_points(i, item_workers)
            total_points += pts
            row_points += pts
            label = (i.service.code or i.service.name) if i.service else ""
            if k > 1:
                has_shared = True
                if label:
                    label = f"{label} (÷{k})"
            if label:
                service_labels.append(label)
        services = list(dict.fromkeys(service_labels))
        rows.append(
            IndividualServiceRow(
                completion_date=completion_date,
                os_id=order.id,
                order_number=order.order_number,
                external_os_number=order.external_os_number,
                plate=order.vehicle_plate or "",
                vehicle=_vehicle_label(order),
                store_name=order.store.name if order.store else None,
                services=services,
                is_courtesy=order.is_courtesy,
                is_return=order.is_return,
                has_shared=has_shared,
                value=float(value),
                points=float(round(row_points, 2)),
            )
        )

    rows.sort(key=lambda r: (r.completion_date, r.os_id))

    return IndividualReportResponse(
        employee_id=employee.id,
        employee_name=employee.name,
        period_start=start,
        period_end=end,
        store_name=await _resolve_store_name(db, store_id),
        total_cars=len({_car_key(r.plate, r.os_id) for r in rows}),
        total_services=round(total_services, 2),
        total_points=float(round(total_points, 2)),
        total_revenue=round(sum(r.value for r in rows), 2),
        rows=rows,
    )


def _workers_names(order: ServiceOrder) -> list[str]:
    """Nomes únicos e ordenados dos instaladores de uma O.S."""
    names = {w.employee.name for w in order.workers if w.employee}
    return sorted(names)


def _services_labels(order: ServiceOrder) -> list[str]:
    """Códigos (ou nomes) dos serviços de uma O.S., preservando a ordem de inserção."""
    labels = [(i.service.code or i.service.name) for i in order.items if i.service]
    return list(dict.fromkeys(labels))


async def get_returns_report(
    db: AsyncSession,
    user,
    start: date_type,
    end: date_type,
    store_id: int | None = None,
) -> ReturnsReportResponse:
    """Tabela de retornos no período, cruzada com a O.S. de origem (quando houver)."""
    from app.modules.service_orders.service import get_vehicle_history

    orders = await _load_completed_orders(db, user, start, end, store_id)
    returns = [o for o in orders if o.is_return]

    # Resolve a O.S. de origem de cada retorno: prioriza o link manual
    # (original_service_order_id); quando ausente, faz fallback por PLACA +
    # MESMO DEPARTAMENTO (última O.S. finalizada, não-retorno, com data anterior
    # à do retorno). get_vehicle_history respeita o escopo de loja do usuário.
    resolved_origin_id: dict[int, int] = {}
    history_cache: dict[str, list[ServiceOrder]] = {}
    for r in returns:
        if r.original_service_order_id:
            resolved_origin_id[r.id] = r.original_service_order_id
            continue
        plate = (r.vehicle_plate or "").upper()
        if not plate:
            continue
        if plate not in history_cache:
            history_cache[plate] = await get_vehicle_history(db, plate, user)
        return_date = _local_date(r.completion_time) if r.completion_time else r.service_date
        for so in history_cache[plate]:  # ordenado por entry_time desc (mais recente 1º)
            if so.id == r.id or so.status != "completed" or so.is_return:
                continue
            if so.department != r.department:
                continue
            # Espelha o filtro de galpão do batch-load: não escolhe uma origem que
            # seria descartada depois (deixaria a linha sem "anterior" à toa).
            if is_galpon_profile_user(user) and not so.is_galpon:
                continue
            if hide_galpon_user(user) and so.is_galpon:
                continue
            so_date = _local_date(so.completion_time) if so.completion_time else so.service_date
            if return_date is not None and so_date is not None and so_date > return_date:
                continue
            resolved_origin_id[r.id] = so.id
            break

    origin_ids = list(set(resolved_origin_id.values()))
    origins: dict[int, ServiceOrder] = {}
    if origin_ids:
        q = (
            select(ServiceOrder)
            .options(
                selectinload(ServiceOrder.items).selectinload(ServiceOrderItem.service),
                selectinload(ServiceOrder.workers).selectinload(ServiceOrderWorker.employee),
            )
            .where(ServiceOrder.id.in_(origin_ids))
        )
        # Escopo de loja: espelha _load_completed_orders para evitar vazamento cross-store.
        # Um usuário com acesso restrito à loja X não pode ler dados de instaladores/notas
        # de uma O.S. de origem da loja Y mesmo que o original_service_order_id aponte para lá.
        q = apply_store_filter(q, user, ServiceOrder.store_id)
        if is_galpon_profile_user(user):
            q = q.where(ServiceOrder.is_galpon.is_(True))
        elif hide_galpon_user(user):
            q = q.where(ServiceOrder.is_galpon.is_(False))
        for so in (await db.execute(q)).scalars().all():
            origins[so.id] = so

    rows: list[ReturnRow] = []
    for r in returns:
        _origin_id = resolved_origin_id.get(r.id)
        origin = origins.get(_origin_id) if _origin_id else None
        origin_date = None
        if origin is not None:
            origin_date = (
                _local_date(origin.completion_time)
                if origin.completion_time
                else origin.service_date
            )
        rows.append(
            ReturnRow(
                return_os_id=r.id,
                return_date=_local_date(r.completion_time) if r.completion_time else r.service_date,
                return_workers=_workers_names(r),
                return_notes=r.notes,
                return_services=_services_labels(r),
                origin_os_id=origin.id if origin else None,
                origin_date=origin_date,
                origin_workers=_workers_names(origin) if origin else [],
                origin_notes=origin.notes if origin else None,
                origin_services=_services_labels(origin) if origin else [],
                model=r.vehicle_model,
                chassis=r.vehicle_plate,
                color=r.vehicle_color,
            )
        )
    rows.sort(key=lambda x: x.return_date)
    return ReturnsReportResponse(
        period_start=start,
        period_end=end,
        store_name=await _resolve_store_name(db, store_id),
        rows=rows,
    )


async def _film_cost(
    db: AsyncSession, user, start: date_type, end: date_type, store_id: int | None
) -> Decimal:
    """Custo das películas compradas no período (pedidos de material).

    Soma FilmRoll.cost (compras via app) + MaterialPurchaseLine.cost (kind=film,
    histórico importado), pelos MaterialRequest com request_date no período.
    """
    req_q = select(MaterialRequest.id).where(
        MaterialRequest.request_date >= start,
        MaterialRequest.request_date <= end,
    )
    if store_id is not None:
        req_q = req_q.where(MaterialRequest.store_id == store_id)
    req_q = apply_store_filter(req_q, user, MaterialRequest.store_id)
    if is_galpon_profile_user(user):
        req_q = req_q.where(MaterialRequest.is_galpon.is_(True))
    elif hide_galpon_user(user):
        req_q = req_q.where(MaterialRequest.is_galpon.is_(False))
    req_ids = list((await db.execute(req_q)).scalars().all())
    if not req_ids:
        return Decimal("0")

    rolls = (
        (await db.execute(select(FilmRoll.cost).where(FilmRoll.material_request_id.in_(req_ids))))
        .scalars()
        .all()
    )
    lines = (
        (
            await db.execute(
                select(MaterialPurchaseLine.cost).where(
                    MaterialPurchaseLine.request_id.in_(req_ids),
                    MaterialPurchaseLine.kind == "film",
                )
            )
        )
        .scalars()
        .all()
    )
    total = Decimal("0")
    for c in list(rolls) + list(lines):
        if c is not None:
            total += Decimal(str(c))
    return total


async def get_summary_report(
    db: AsyncSession,
    user,
    start: date_type,
    end: date_type,
    store_id: int | None = None,
) -> SummaryReportResponse:
    """Resumo de todos os instaladores no período (base do ranking + custo de película)."""
    orders = await _load_completed_orders(db, user, start, end, store_id)

    agg: dict[int, dict] = {}
    for order in orders:
        worker_emp_ids = {w.employee_id for w in order.workers if w.employee}
        for emp_id in worker_emp_ids:
            emp = next((w.employee for w in order.workers if w.employee_id == emp_id), None)
            if emp is None:
                continue
            items = _relevant_items(order, emp_id)
            if not items:
                continue
            entry = agg.setdefault(
                emp_id,
                {
                    "employee_id": emp_id,
                    "employee_name": emp.name,
                    "orders_count": 0,
                    "services_count": 0.0,
                    "points": Decimal("0"),
                    "revenue": Decimal("0"),
                    "car_keys": set(),
                },
            )
            entry["orders_count"] += 1
            entry["car_keys"].add(_car_key(order.vehicle_plate, order.id))
            for i in items:
                item_workers = _item_workers(order, i.id)
                k = max(len(item_workers), 1)
                entry["services_count"] += 1 / k
                entry["points"] += _item_points(i, item_workers)
                if not _is_unpaid(order):
                    entry["revenue"] += _item_share(i, emp_id, item_workers)

    rows: list[SummaryRankingRow] = []
    for e in agg.values():
        rows.append(
            SummaryRankingRow(
                employee_id=e["employee_id"],
                employee_name=e["employee_name"],
                orders_count=e["orders_count"],
                services_count=round(e["services_count"], 2),
                cars_count=len(e["car_keys"]),
                points=float(round(e["points"], 2)),
                revenue=float(round(e["revenue"], 2)),
            )
        )
    rows.sort(key=lambda r: (-r.points, r.employee_name.lower()))

    all_car_keys: set[str] = set()
    for order in orders:
        if any(w.employee for w in order.workers):
            all_car_keys.add(_car_key(order.vehicle_plate, order.id))
    film_cost = await _film_cost(db, user, start, end, store_id)

    return SummaryReportResponse(
        period_start=start,
        period_end=end,
        store_name=await _resolve_store_name(db, store_id),
        totals=SummaryTotals(
            total_cars=len(all_car_keys),
            total_services=round(sum(r.services_count for r in rows), 2),
            total_points=round(sum(r.points for r in rows), 2),
            total_revenue=round(sum(r.revenue for r in rows), 2),
            film_cost=float(round(film_cost, 2)),
        ),
        rows=rows,
    )
