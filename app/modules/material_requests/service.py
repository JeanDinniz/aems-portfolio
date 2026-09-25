"""Lógica de negócio do módulo de Pedidos de Material."""

from datetime import UTC, datetime
from datetime import date as date_type

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_audit
from app.core.exceptions import AuthorizationError, ConflictError, NotFoundError, ValidationError
from app.core.pagination import paginate
from app.core.permissions import (
    apply_store_filter,
    get_access_profile_permission,
    hide_galpon_user,
    is_galpon_profile_user,
    is_owner,
    require_resource_access,
)
from app.modules.employees.models import Employee
from app.modules.inventory.models import FilmConsumption, FilmRoll, FilmType
from app.modules.material_requests.models import (
    MaterialRequest,
    MaterialRequestTool,
    ToolReceipt,
)
from app.modules.material_requests.schemas import (
    MaterialPurchaseLineItem,
    MaterialRequestCreate,
    MaterialRequestFilmItem,
    MaterialRequestFilmLineCreate,
    MaterialRequestFilmLineUpdate,
    MaterialRequestResponse,
    MaterialRequestToolItem,
    MaterialRequestUpdate,
    RollYieldEntry,
    RollYieldGroup,
    RollYieldResponse,
    ToolCard,
    ToolCardItem,
    ToolCardListResponse,
    ToolReceiptConfirm,
)
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem
from app.modules.stores.models import Store


def _loads() -> tuple:
    """Eager loads reutilizados nas leituras (film_rolls é viewonly → precisa ser
    carregado explicitamente, senão o acesso lazy quebra no contexto async).

    Construído sob demanda (não no import do módulo): chamar ``selectinload`` no
    nível de módulo forçaria a configuração dos mappers cedo demais, antes de
    todos os models estarem registrados.
    """
    return (
        selectinload(MaterialRequest.store),
        selectinload(MaterialRequest.created_by),
        selectinload(MaterialRequest.edited_by),
        selectinload(MaterialRequest.tools).selectinload(MaterialRequestTool.employee),
        selectinload(MaterialRequest.film_rolls).selectinload(FilmRoll.film_type),
        selectinload(MaterialRequest.purchase_lines),
    )


# ---------------------------------------------------------------------------
# Projeção
# ---------------------------------------------------------------------------
def build_material_request_response(req: MaterialRequest) -> MaterialRequestResponse:
    film_items = [
        MaterialRequestFilmItem(
            film_roll_id=roll.id,
            film_type_id=roll.film_type_id,
            film_type_name=roll.film_type.name if roll.film_type else "",
            tonality=roll.tonality,
            total_meters=roll.total_meters,
            remaining_meters=roll.remaining_meters,
            supplier=roll.supplier,
            supplier_id=roll.supplier_id,
            nfe_number=roll.nfe_number,
            cost=roll.cost,
            lot_number=roll.lot_number,
            receipt_date=roll.receipt_date,
            status=roll.status,
        )
        for roll in req.film_rolls
    ]
    tool_items = [
        MaterialRequestToolItem(
            id=t.id,
            name=t.name,
            quantity=t.quantity,
            notes=t.notes,
            employee_id=t.employee_id,
            employee_name=t.employee.name if t.employee else None,
            cost=t.cost,
            nfe_number=t.nfe_number,
        )
        for t in req.tools
    ]
    purchase_lines = [
        MaterialPurchaseLineItem(
            id=p.id,
            kind=p.kind,
            material_name=p.material_name,
            tonality=p.tonality,
            quantity=p.quantity,
            supplier=p.supplier,
            nfe_number=p.nfe_number,
            cost=p.cost,
            lot_number=p.lot_number,
            notes=p.notes,
        )
        for p in req.purchase_lines
    ]
    return MaterialRequestResponse(
        id=req.id,
        store_id=req.store_id,
        store_name=req.store.name if req.store else None,
        request_date=req.request_date,
        notes=req.notes,
        is_galpon=req.is_galpon,
        source=req.source,
        status=req.status,
        cancelled_at=req.cancelled_at,
        cancellation_reason=req.cancellation_reason,
        created_by_user_id=req.created_by_user_id,
        created_by_name=req.created_by.full_name if req.created_by else None,
        edited_at=req.edited_at,
        edited_by_user_id=req.edited_by_user_id,
        edited_by_name=req.edited_by.full_name if req.edited_by else None,
        film_items=film_items,
        tool_items=tool_items,
        purchase_lines=purchase_lines,
        created_at=req.created_at,
        updated_at=req.updated_at,
    )


# ---------------------------------------------------------------------------
# Leitura
# ---------------------------------------------------------------------------
async def get_request(
    db: AsyncSession, request_id: int, *, populate_existing: bool = False
) -> MaterialRequest:
    """Lê um pedido com as relações carregadas.

    ``populate_existing=True`` força o refresh do objeto já presente na
    identity-map (colunas + eager loaders) — necessário após o reconcílio da
    edição, quando film_rolls/edited_by já foram carregados e ficariam obsoletos.
    """
    query = select(MaterialRequest).options(*_loads()).where(MaterialRequest.id == request_id)
    if populate_existing:
        query = query.execution_options(populate_existing=True)
    result = await db.execute(query)
    req = result.scalar_one_or_none()
    if not req:
        raise NotFoundError(resource="Pedido de Material")
    return req


def _filtered_query(
    user,
    store_id: int | None,
    date_from: date_type | None,
    date_to: date_type | None,
):
    query = select(MaterialRequest).options(*_loads())
    query = apply_store_filter(query, user, MaterialRequest.store_id)

    # Filtros de galpão (mesma semântica aditiva dos demais módulos).
    if is_galpon_profile_user(user):
        query = query.where(MaterialRequest.is_galpon.is_(True))
    elif hide_galpon_user(user):
        query = query.where(MaterialRequest.is_galpon.is_(False))

    if store_id is not None:
        query = query.where(MaterialRequest.store_id == store_id)
    if date_from is not None:
        query = query.where(MaterialRequest.request_date >= date_from)
    if date_to is not None:
        query = query.where(MaterialRequest.request_date <= date_to)
    return query


async def list_requests(
    db: AsyncSession,
    user,
    store_id: int | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    page: int = 1,
    limit: int = 50,
) -> tuple[list[MaterialRequest], int]:
    query = _filtered_query(user, store_id, date_from, date_to)
    return await paginate(db, query, page, limit, order_by=MaterialRequest.request_date.desc())


async def get_requests_for_export(
    db: AsyncSession,
    user,
    store_id: int | None = None,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
) -> list[MaterialRequest]:
    """Todos os pedidos que casam os filtros (sem paginação), para o Excel."""
    query = _filtered_query(user, store_id, date_from, date_to).order_by(
        MaterialRequest.store_id, MaterialRequest.request_date
    )
    result = await db.execute(query)
    return list(result.scalars().unique().all())


# ---------------------------------------------------------------------------
# Escrita
# ---------------------------------------------------------------------------
async def _resolve_unique_receipt_date(
    db: AsyncSession,
    store_id: int,
    film_type_id: int,
    tonality: str | None,
    receipt_date: date_type,
    *,
    exclude_roll_id: int | None = None,
) -> date_type:
    """
    Resolve a data de recebimento garantindo unicidade do visual_id da bobina.

    O visual_id é computado a partir de (nome_tipo, tonalidade, receipt_date, metros).
    Duas bobinas com os mesmos 4 parâmetros teriam visual_ids idênticos, confundindo
    o usuário no painel de Estoque.

    Mesma intenção do auto-incremento de ``inventory.service.register_roll``,
    porém em LOOP: enquanto existir bobina com mesma loja + tipo + tonalidade +
    data, avança receipt_date +1 dia até achar uma data livre (I3). É mais
    robusto que o register_roll, que hoje incrementa uma única vez.
    """
    from datetime import timedelta

    tonality_filter = (
        FilmRoll.tonality == tonality if tonality is not None else FilmRoll.tonality.is_(None)
    )

    # Coleta todas as datas já usadas para esta combinação (inclui linhas
    # ainda não commitadas da sessão atual via flush prévio do caller).
    # ``exclude_roll_id`` tira a própria bobina da conta na edição (senão ela
    # veria a própria data como "ocupada" e avançaria à toa).
    used_query = select(FilmRoll.receipt_date).where(
        FilmRoll.store_id == store_id,
        FilmRoll.film_type_id == film_type_id,
        tonality_filter,
    )
    if exclude_roll_id is not None:
        used_query = used_query.where(FilmRoll.id != exclude_roll_id)
    used_dates_result = await db.execute(used_query)
    used_dates = {row[0] for row in used_dates_result.all()}

    candidate = receipt_date
    while candidate in used_dates:
        candidate = candidate + timedelta(days=1)
    return candidate


async def _create_roll_from_line(
    db: AsyncSession,
    line: MaterialRequestFilmLineCreate,
    *,
    store_id: int,
    receipt_date: date_type,
    request_id: int,
    user,
) -> FilmRoll:
    """Cria uma bobina no Estoque a partir de uma linha de película do pedido.

    Espelha o mapeamento de campos de ``inventory.service.register_roll``, mas
    inline (sem commit interno) para manter o pedido numa única transação.
    Vincula a bobina ao pedido via material_request_id.

    Auto-incrementa receipt_date (I3) quando já existe bobina com mesma combinação
    store + tipo + tonalidade + data, evitando visual_ids duplicados.
    """
    film_type = (
        await db.execute(
            select(FilmType).where(
                FilmType.id == line.film_type_id,
                FilmType.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if not film_type:
        raise NotFoundError(resource="Tipo de Película")

    # Garante receipt_date único para esta combinação (evita visual_id duplicado).
    # Faz flush das linhas anteriores do mesmo pedido antes de resolver a data,
    # para que o SELECT enxergue as bobinas já inseridas nesta transação.
    await db.flush()
    resolved_date = await _resolve_unique_receipt_date(
        db, store_id, line.film_type_id, line.tonality, receipt_date
    )

    roll = FilmRoll(
        store_id=store_id,
        film_type_id=line.film_type_id,
        tonality=line.tonality,
        supplier=line.supplier,
        supplier_id=line.supplier_id,
        nfe_number=line.nfe_number,
        cost=line.cost,
        lot_number=line.lot_number,
        total_meters=line.total_meters,
        remaining_meters=line.total_meters,
        receipt_date=resolved_date,
        status="em_estoque",
        material_request_id=request_id,
    )
    db.add(roll)
    await db.flush()

    await log_audit(
        db=db,
        action="create",
        resource_type="film_roll",
        user_id=getattr(user, "id", None),
        resource_id=roll.id,
        new_value={
            "film_type_id": line.film_type_id,
            "tonality": line.tonality,
            "total_meters": line.total_meters,
            "receipt_date": resolved_date.isoformat(),
            "store_id": store_id,
            "material_request_id": request_id,
        },
    )
    return roll


async def create_request(db: AsyncSession, data: MaterialRequestCreate, user) -> MaterialRequest:
    require_resource_access(user, data.store_id, "Loja")

    req = MaterialRequest(
        store_id=data.store_id,
        request_date=data.request_date,
        notes=data.notes,
        is_galpon=data.is_galpon,
        created_by_user_id=getattr(user, "id", None),
    )
    db.add(req)
    await db.flush()  # garante req.id para vincular bobinas/ferramentas

    for line in data.film_lines:
        await _create_roll_from_line(
            db,
            line,
            store_id=data.store_id,
            receipt_date=line.receipt_date or data.request_date,
            request_id=req.id,
            user=user,
        )

    for tool in data.tool_lines:
        db.add(
            MaterialRequestTool(
                request_id=req.id,
                name=tool.name,
                quantity=tool.quantity,
                notes=tool.notes,
                employee_id=tool.employee_id,
                cost=tool.cost,
                nfe_number=tool.nfe_number,
            )
        )

    await db.flush()

    # Indicadores agregam bobinas/pedidos criados → marca para invalidar o
    # cache de analytics pós-commit (get_db lê a flag e bumpa depois do commit)
    db.info["bump_analytics"] = True

    return await get_request(db, req.id)


def _audit_snapshot(req: MaterialRequest) -> dict:
    """Estado do pedido para o de→para da Auditoria (campos + linhas).

    Exige ``film_rolls``/``tools`` já carregados (o get_request faz o eager load).
    Decimal/date são convertidos pelo ``log_audit`` (``_make_json_safe``).
    """
    return {
        "request_date": req.request_date,
        "notes": req.notes,
        "is_galpon": req.is_galpon,
        "film_lines": [
            {
                "film_roll_id": r.id,
                "film_type_id": r.film_type_id,
                "tonality": r.tonality,
                "total_meters": float(r.total_meters),
                "nfe_number": r.nfe_number,
                "supplier": r.supplier,
                "supplier_id": r.supplier_id,
                "cost": float(r.cost) if r.cost is not None else None,
                "lot_number": r.lot_number,
                "receipt_date": r.receipt_date.isoformat() if r.receipt_date else None,
            }
            for r in req.film_rolls
        ],
        "tool_lines": [
            {
                "name": t.name,
                "quantity": t.quantity,
                "employee_id": t.employee_id,
                "nfe_number": t.nfe_number,
                "cost": float(t.cost) if t.cost is not None else None,
                "notes": t.notes,
            }
            for t in req.tools
        ],
    }


async def _roll_consumption_count(db: AsyncSession, roll_id: int) -> int:
    """Quantos consumos a bobina já tem no ledger (base da trava anti-inconsistência)."""
    return (
        await db.execute(
            select(func.count(FilmConsumption.id)).where(FilmConsumption.film_roll_id == roll_id)
        )
    ).scalar_one()


async def _update_roll_from_line(
    db: AsyncSession, roll: FilmRoll, line: "MaterialRequestFilmLineUpdate", user
) -> None:
    """Atualiza uma bobina existente a partir de uma linha da edição.

    Tonalidade, NF, fornecedor, custo e lote são sempre editáveis. Metros e tipo
    de película só mudam se a bobina NÃO tiver consumo — senão bloqueia (409),
    pois alterá-los depois de a bobina ter atendido carros quebraria o histórico
    das O.S./rendimento (mesma regra do cancelamento).
    """

    def _roll_snapshot() -> dict:
        return {
            "film_type_id": roll.film_type_id,
            "tonality": roll.tonality,
            "total_meters": float(roll.total_meters),
            "nfe_number": roll.nfe_number,
            "supplier": roll.supplier,
            "supplier_id": roll.supplier_id,
            "cost": float(roll.cost) if roll.cost is not None else None,
            "lot_number": roll.lot_number,
            "receipt_date": roll.receipt_date.isoformat() if roll.receipt_date else None,
        }

    old_value = _roll_snapshot()

    changing_meters = float(line.total_meters) != float(roll.total_meters)
    changing_type = line.film_type_id != roll.film_type_id
    changing_tonality = line.tonality != roll.tonality
    changing_receipt = line.receipt_date is not None and line.receipt_date != roll.receipt_date

    if changing_meters or changing_type:
        used = await _roll_consumption_count(db, roll.id)
        if used > 0:
            raise ConflictError(
                detail=(
                    f"Não é possível alterar metros/tipo: a bobina #{roll.id} já foi usada "
                    "em carros. Corrija apenas os demais campos ou ajuste essa bobina no Estoque."
                )
            )

    if changing_type:
        film_type = (
            await db.execute(
                select(FilmType).where(
                    FilmType.id == line.film_type_id,
                    FilmType.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if not film_type:
            raise NotFoundError(resource="Tipo de Película")
        roll.film_type_id = line.film_type_id

    if changing_meters:
        # Sem consumo (garantido acima) → o remanescente acompanha o novo total.
        roll.total_meters = line.total_meters
        roll.remaining_meters = line.total_meters

    roll.tonality = line.tonality
    roll.supplier = line.supplier
    roll.supplier_id = line.supplier_id
    roll.nfe_number = line.nfe_number
    roll.cost = line.cost
    roll.lot_number = line.lot_number

    # O visual_id legível deriva de (tipo, tonalidade, receipt_date, metros). Se
    # qualquer um desses componentes mudou, re-resolve a data para não colidir com
    # OUTRA bobina (exclui a própria) — mantendo a mesma invariante do create.
    if changing_meters or changing_type or changing_tonality or changing_receipt:
        base_date = line.receipt_date or roll.receipt_date
        roll.receipt_date = await _resolve_unique_receipt_date(
            db,
            roll.store_id,
            roll.film_type_id,
            roll.tonality,
            base_date,
            exclude_roll_id=roll.id,
        )
    await db.flush()

    new_value = _roll_snapshot()
    if new_value != old_value:
        await log_audit(
            db=db,
            action="update",
            resource_type="film_roll",
            user_id=getattr(user, "id", None),
            resource_id=roll.id,
            old_value=old_value,
            new_value=new_value,
        )


async def _reconcile_film_lines(
    db: AsyncSession,
    req: MaterialRequest,
    lines: list["MaterialRequestFilmLineUpdate"],
    user,
) -> None:
    """Reconcilia as bobinas do pedido com as linhas enviadas na edição.

    - linha com ``film_roll_id`` → edita a bobina existente (com trava);
    - linha sem id → cria uma bobina nova (mesma rotina do create);
    - bobina existente ausente do payload → removida (bloqueia se tiver consumo).
    """
    current = {roll.id: roll for roll in req.film_rolls}
    seen_ids: set[int] = set()

    for line in lines:
        if line.film_roll_id is not None:
            roll = current.get(line.film_roll_id)
            if roll is None:
                raise NotFoundError(resource=f"Bobina #{line.film_roll_id} do pedido")
            seen_ids.add(roll.id)
            await _update_roll_from_line(db, roll, line, user)
        else:
            await _create_roll_from_line(
                db,
                line,
                store_id=req.store_id,
                receipt_date=line.receipt_date or req.request_date,
                request_id=req.id,
                user=user,
            )

    for roll_id, roll in current.items():
        if roll_id in seen_ids:
            continue
        used = await _roll_consumption_count(db, roll_id)
        if used > 0:
            raise ConflictError(
                detail=(
                    f"Não é possível remover: a bobina #{roll_id} já foi usada em carros. "
                    "Resolva o estoque dessa bobina antes de removê-la do pedido."
                )
            )
        await log_audit(
            db=db,
            action="delete",
            resource_type="film_roll",
            user_id=getattr(user, "id", None),
            resource_id=roll_id,
            old_value={
                "film_type_id": roll.film_type_id,
                "tonality": roll.tonality,
                "total_meters": float(roll.total_meters),
                "material_request_id": req.id,
            },
        )
        await db.delete(roll)

    await db.flush()


async def update_request(
    db: AsyncSession, request_id: int, data: MaterialRequestUpdate, user
) -> MaterialRequest:
    """Edita um pedido lançado (reconcílio completo), deixando rastro na Auditoria.

    Pedido cancelado e pedido histórico (``source="planilha"``) não são editáveis
    aqui. Toda edição bem-sucedida registra ``edited_at``/``edited_by_user_id`` e
    uma entrada de auditoria ``update`` de ``material_request`` com o de→para.
    """
    req = await get_request(db, request_id)
    require_resource_access(user, req.store_id, "Loja")

    if req.status == "cancelled":
        raise ConflictError(detail="Pedido cancelado não pode ser editado.")
    if req.source == "planilha":
        raise ConflictError(detail="Pedido importado da planilha não pode ser editado.")

    old_value = _audit_snapshot(req)

    if data.request_date is not None:
        req.request_date = data.request_date
    if data.notes is not None:
        req.notes = data.notes
    if data.is_galpon is not None:
        req.is_galpon = data.is_galpon

    if data.film_lines is not None:
        await _reconcile_film_lines(db, req, data.film_lines, user)

    # Substitui as ferramentas quando tool_lines é enviado.
    if data.tool_lines is not None:
        for existing in list(req.tools):
            await db.delete(existing)
        await db.flush()
        for tool in data.tool_lines:
            db.add(
                MaterialRequestTool(
                    request_id=req.id,
                    name=tool.name,
                    quantity=tool.quantity,
                    notes=tool.notes,
                    employee_id=tool.employee_id,
                    cost=tool.cost,
                    nfe_number=tool.nfe_number,
                )
            )
        await db.flush()

    await db.flush()

    # Relê com populate_existing: como ``req`` já teve as relações carregadas no
    # topo (film_rolls/edited_by), sem isso o reload via identity-map traria o
    # estado obsoleto (pré-reconcílio).
    req = await get_request(db, req.id, populate_existing=True)

    # Não deixa o pedido ficar vazio (mesma invariante do create).
    if not req.film_rolls and not req.tools:
        raise ValidationError(detail="Informe ao menos uma película ou ferramenta no pedido")

    # Só carimba "editado" (selo + Auditoria) quando algo realmente mudou — salvar
    # sem alteração NÃO deve marcar o pedido como editado (senão o selo mente).
    new_value = _audit_snapshot(req)
    if new_value != old_value:
        req.edited_at = datetime.now(UTC)
        req.edited_by_user_id = getattr(user, "id", None)
        await db.flush()
        await log_audit(
            db=db,
            action="update",
            resource_type="material_request",
            user_id=getattr(user, "id", None),
            resource_id=req.id,
            old_value=old_value,
            new_value=new_value,
        )
        # Relê de novo para popular a relação ``edited_by`` (o FK acabou de ser
        # setado; sem isso o acesso a req.edited_by na resposta faria lazy-load).
        req = await get_request(db, req.id, populate_existing=True)

    # Indicadores agregam bobinas/pedidos editados → marca para invalidar o
    # cache de analytics pós-commit (get_db lê a flag e bumpa depois do commit)
    db.info["bump_analytics"] = True

    return req


async def cancel_request(db: AsyncSession, request_id: int, reason: str, user) -> MaterialRequest:
    """Cancela (invalida) um pedido — não some da lista, fica visível com o motivo.

    Regras (decisão de negócio):
    - Motivo é obrigatório (validado no schema).
    - As bobinas que o pedido registrou saem do Estoque (são apagadas), MAS se
      alguma já foi usada em carros (tem consumo) o cancelamento é BLOQUEADO —
      apagar uma bobina consumida quebraria o histórico das O.S./rendimento.
    """
    req = await get_request(db, request_id)
    require_resource_access(user, req.store_id, "Loja")

    if req.status == "cancelled":
        raise ConflictError(detail="Pedido já está cancelado.")

    rolls = (
        (await db.execute(select(FilmRoll).where(FilmRoll.material_request_id == req.id)))
        .scalars()
        .all()
    )

    # Bloqueia se qualquer bobina do pedido já tem consumo registrado.
    for roll in rolls:
        used = (
            await db.execute(
                select(func.count(FilmConsumption.id)).where(
                    FilmConsumption.film_roll_id == roll.id
                )
            )
        ).scalar_one()
        if used > 0:
            raise ConflictError(
                detail=(
                    f"Não é possível cancelar: a bobina #{roll.id} já foi usada em carros. "
                    "Resolva o estoque dessa bobina antes de cancelar o pedido."
                )
            )

    # Nenhuma bobina usada → tira do estoque (apaga as bobinas do pedido).
    for roll in rolls:
        await db.delete(roll)

    req.status = "cancelled"
    req.cancelled_at = datetime.now(UTC)
    req.cancellation_reason = reason
    await db.flush()

    await log_audit(
        db=db,
        action="cancel",
        resource_type="material_request",
        user_id=user.id,
        resource_id=req.id,
        new_value={"cancellation_reason": reason, "rolls_removed": len(rolls)},
    )

    # Indicadores agregam bobinas removidas do cancelamento → marca para invalidar
    # o cache de analytics pós-commit (get_db lê a flag e bumpa depois do commit)
    db.info["bump_analytics"] = True

    return await get_request(db, req.id)


# ---------------------------------------------------------------------------
# Rendimento das bobinas (carros por bobina)
# ---------------------------------------------------------------------------
async def get_roll_yield(
    db: AsyncSession,
    user,
    store_id: int | None = None,
    film_type_id: int | None = None,
    per_material: int = 7,
) -> RollYieldResponse:
    """Quantos carros cada bobina rendeu, agrupado por loja × tipo × tonalidade.

    "Carros" = placas distintas de O.S. que consumiram a bobina (via ledger
    FilmConsumption, considerando só consumos reais — exclui estorno/ajuste).
    Só entram bobinas que já tiveram consumo. Por grupo, mostra as
    ``per_material`` bobinas mais recentes (por data de recebimento) e as médias
    — base para o planejamento de pedidos, como a aba da planilha.
    """
    cars_subq = (
        select(
            FilmConsumption.film_roll_id.label("roll_id"),
            func.count(func.distinct(ServiceOrder.vehicle_plate)).label("cars"),
            func.max(FilmConsumption.created_at).label("last_at"),
        )
        .join(ServiceOrderItem, ServiceOrderItem.id == FilmConsumption.service_order_item_id)
        .join(ServiceOrder, ServiceOrder.id == ServiceOrderItem.service_order_id)
        .where(or_(FilmConsumption.kind == "consumo", FilmConsumption.kind.is_(None)))
        .group_by(FilmConsumption.film_roll_id)
        .subquery()
    )

    query = (
        select(
            FilmRoll.id.label("roll_id"),
            FilmRoll.store_id,
            Store.name.label("store_name"),
            FilmRoll.film_type_id,
            FilmType.name.label("film_type_name"),
            FilmRoll.tonality,
            FilmRoll.total_meters,
            FilmRoll.remaining_meters,
            FilmRoll.status,
            FilmRoll.receipt_date,
            cars_subq.c.cars,
            cars_subq.c.last_at,
        )
        .join(FilmType, FilmType.id == FilmRoll.film_type_id)
        .join(Store, Store.id == FilmRoll.store_id)
        .join(cars_subq, cars_subq.c.roll_id == FilmRoll.id)
    )
    query = apply_store_filter(query, user, FilmRoll.store_id)
    if store_id is not None:
        query = query.where(FilmRoll.store_id == store_id)
    if film_type_id is not None:
        query = query.where(FilmRoll.film_type_id == film_type_id)
    query = query.order_by(
        FilmRoll.store_id,
        FilmType.name,
        FilmRoll.tonality,
        FilmRoll.receipt_date.desc(),
        FilmRoll.id.desc(),
    )

    rows = (await db.execute(query)).all()

    groups: dict[tuple, dict] = {}
    order: list[tuple] = []
    for r in rows:
        key = (r.store_id, r.film_type_id, r.tonality)
        if key not in groups:
            groups[key] = {
                "store_id": r.store_id,
                "store_name": r.store_name,
                "film_type_id": r.film_type_id,
                "film_type_name": r.film_type_name,
                "tonality": r.tonality,
                "rolls": [],
            }
            order.append(key)
        g = groups[key]
        if len(g["rolls"]) < per_material:
            g["rolls"].append(
                RollYieldEntry(
                    roll_id=r.roll_id,
                    receipt_date=r.receipt_date,
                    total_meters=r.total_meters,
                    remaining_meters=r.remaining_meters,
                    status=r.status,
                    cars=int(r.cars or 0),
                    last_consumption_at=r.last_at,
                )
            )

    items: list[RollYieldGroup] = []
    for key in order:
        g = groups[key]
        rolls: list[RollYieldEntry] = g["rolls"]
        total_cars = sum(x.cars for x in rolls)
        total_meters = sum(x.total_meters for x in rolls)
        count = len(rolls)
        items.append(
            RollYieldGroup(
                store_id=g["store_id"],
                store_name=g["store_name"],
                film_type_id=g["film_type_id"],
                film_type_name=g["film_type_name"],
                tonality=g["tonality"],
                rolls=rolls,
                roll_count=count,
                total_cars=total_cars,
                avg_cars=round(total_cars / count, 1) if count else 0.0,
                avg_cars_per_meter=round(total_cars / total_meters, 2) if total_meters else 0.0,
            )
        )

    return RollYieldResponse(items=items)


# ---------------------------------------------------------------------------
# Cards de recebimento de ferramentas (Controle de EPIs)
# ---------------------------------------------------------------------------
async def _employee_id_for_user(db: AsyncSession, user) -> int | None:
    """Employee vinculado ao usuário logado (self-service), ou None."""
    return (
        await db.execute(select(Employee.id).where(Employee.user_id == user.id))
    ).scalar_one_or_none()


def _can_manage_tool_cards(user) -> bool:
    """Gestor/owner enxerga todos os cards; caso contrário é self-service."""
    return (
        is_owner(user)
        or get_access_profile_permission(user, "material_requests", "view")
        or get_access_profile_permission(user, "epi", "view")
    )


async def get_tool_cards(
    db: AsyncSession,
    user,
    status: str | None = None,
    store_id: int | None = None,
    employee_id: int | None = None,
) -> ToolCardListResponse:
    """Cards de recebimento: ferramentas de um pedido destinadas a um funcionário.

    Card pendente = (request_id, employee_id) sem ``ToolReceipt``; recebido = com.
    Escopo: funcionário logado vê só os seus; gestor/owner vê todos (filtros).
    """
    query = (
        select(MaterialRequestTool)
        .join(MaterialRequest, MaterialRequest.id == MaterialRequestTool.request_id)
        .options(
            selectinload(MaterialRequestTool.request).selectinload(MaterialRequest.store),
            selectinload(MaterialRequestTool.employee),
        )
        .where(MaterialRequestTool.employee_id.isnot(None))
    )

    if _can_manage_tool_cards(user):
        query = apply_store_filter(query, user, MaterialRequest.store_id)
        if employee_id is not None:
            query = query.where(MaterialRequestTool.employee_id == employee_id)
    else:
        my_emp = await _employee_id_for_user(db, user)
        if my_emp is None:
            return ToolCardListResponse(items=[])
        query = query.where(MaterialRequestTool.employee_id == my_emp)

    if store_id is not None:
        query = query.where(MaterialRequest.store_id == store_id)

    query = query.order_by(
        MaterialRequest.request_date.desc(), MaterialRequestTool.request_id.desc()
    )
    tools = list((await db.execute(query)).scalars().unique().all())

    request_ids = {t.request_id for t in tools}
    receipts: dict[tuple[int, int], ToolReceipt] = {}
    if request_ids:
        recs = (
            (await db.execute(select(ToolReceipt).where(ToolReceipt.request_id.in_(request_ids))))
            .scalars()
            .all()
        )
        for r in recs:
            receipts[(r.request_id, r.employee_id)] = r

    groups: dict[tuple[int, int], list[MaterialRequestTool]] = {}
    for t in tools:
        groups.setdefault((t.request_id, t.employee_id), []).append(t)

    cards: list[ToolCard] = []
    for (req_id, emp_id), items in groups.items():
        rep = items[0]
        req = rep.request
        receipt = receipts.get((req_id, emp_id))
        card_status = "recebido" if receipt else "pendente"
        if status and card_status != status:
            continue
        cards.append(
            ToolCard(
                request_id=req_id,
                request_date=req.request_date,
                store_id=req.store_id,
                store_name=req.store.name if req.store else None,
                employee_id=emp_id,
                employee_name=rep.employee.name if rep.employee else None,
                items=[
                    ToolCardItem(
                        id=x.id,
                        name=x.name,
                        quantity=x.quantity,
                        notes=x.notes,
                        photo_url=x.photo_url,
                    )
                    for x in items
                ],
                status=card_status,
                received_at=receipt.received_at if receipt else None,
                signature_base64=receipt.signature_base64 if receipt else None,
            )
        )

    return ToolCardListResponse(items=cards)


async def confirm_tool_receipt(db: AsyncSession, data: ToolReceiptConfirm, user) -> ToolReceipt:
    """Registra o recebimento assinado de um card (pedido × funcionário).

    Exige exatamente 1 foto por item do card (``item_photos``): nem faltando
    nem sobrando item_id em relação aos itens reais do card.
    """
    tools = list(
        (
            await db.execute(
                select(MaterialRequestTool).where(
                    MaterialRequestTool.request_id == data.request_id,
                    MaterialRequestTool.employee_id == data.employee_id,
                )
            )
        )
        .scalars()
        .all()
    )
    if not tools:
        raise NotFoundError(resource="Card de recebimento")

    my_emp = await _employee_id_for_user(db, user)
    is_self = my_emp is not None and my_emp == data.employee_id
    can_edit = (
        is_owner(user)
        or get_access_profile_permission(user, "material_requests", "edit")
        or get_access_profile_permission(user, "epi", "edit")
    )
    if not (is_self or can_edit):
        raise AuthorizationError(detail="Sem permissão para registrar este recebimento")

    existing = (
        await db.execute(
            select(ToolReceipt).where(
                ToolReceipt.request_id == data.request_id,
                ToolReceipt.employee_id == data.employee_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise ConflictError(detail="Recebimento já registrado para este card")

    card_item_ids = {t.id for t in tools}
    photo_item_ids = [p.item_id for p in data.item_photos]
    if len(photo_item_ids) != len(set(photo_item_ids)):
        raise ValidationError(detail="Foto duplicada para o mesmo item")
    photo_by_item = {p.item_id: p.photo_url for p in data.item_photos}
    if set(photo_by_item.keys()) != card_item_ids:
        raise ValidationError(
            detail="Envie exatamente 1 foto para cada item do card de recebimento"
        )

    for tool in tools:
        tool.photo_url = photo_by_item[tool.id]

    receipt = ToolReceipt(
        request_id=data.request_id,
        employee_id=data.employee_id,
        signature_base64=data.signature_base64,
        confirmed_by_user_id=getattr(user, "id", None),
        notes=data.notes,
    )
    db.add(receipt)
    await db.flush()
    return receipt
