"""
Service Order router - API endpoints for service order management.
"""

from collections.abc import Callable
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.exceptions import AuthorizationError, NotFoundError
from app.core.permissions import (
    UserRole,
    check_can_change_os_status,
    check_profile_permission,
    get_access_profile_permission,
    permissions,
    require_resource_access,
)
from app.core.security import get_current_user
from app.db.session import get_db
from app.dependencies import PaginatedResponse, get_pagination_params
from app.modules.service_orders import export, service
from app.modules.service_orders.enums import ConferenceStatus, OSStatus
from app.modules.service_orders.schemas import (
    DuplicateCheckResponse,
    FinalizeOrderRequest,
    OSHistoryResponse,
    ServiceOrderCreate,
    ServiceOrderDetailResponse,
    ServiceOrderListResponse,
    ServiceOrderResponse,
    ServiceOrderUpdate,
    StatusHistoryResponse,
    StatusUpdateRequest,
    VehicleHistoryItemResponse,
    VehicleHistoryResponse,
    VerifyRequest,
)
from app.modules.services.enums import ServiceDepartment

router = APIRouter(prefix="/service-orders", tags=["Service Orders"])


def _build_item_filter(
    service_name_contains: list[str],
    service_name_not_contains: list[str],
) -> "Callable[[Any], bool] | None":
    """
    Retorna um predicado por item para filtros de nome de serviço, ou None quando
    ambos os parâmetros são ausentes.

    Regras (any-match — cada parâmetro é uma lista de padrões parciais):
    - service_name_contains: item passa se item.service existe e ALGUM needle está
      no nome (case-insensitive). Item sem service NÃO passa.
    - service_name_not_contains: item passa se item.service é None OU NENHUM needle
      está no nome. Item sem service passa (pertence ao grupo "outros serviços").
    - Se ambos forem fornecidos, service_name_contains tem precedência.
    - Se nenhum for fornecido, retorna None (sem filtro).
    """
    if service_name_contains:
        needles = [n.lower() for n in service_name_contains]

        def _contains_filter(item: "Any") -> bool:
            name = (item.service.name or "").lower() if item.service else None
            return name is not None and any(n in name for n in needles)

        return _contains_filter

    if service_name_not_contains:
        needles = [n.lower() for n in service_name_not_contains]

        def _not_contains_filter(item: "Any") -> bool:
            if not item.service:
                return True
            name = (item.service.name or "").lower()
            return not any(n in name for n in needles)

        return _not_contains_filter

    return None


def _prefilter_orders_by_service_name(
    orders: list,
    service_name_contains: list[str],
    service_name_not_contains: list[str],
) -> list:
    """
    Pré-filtro de O.S. inteiras para os filtros de nome de serviço (por item,
    any-match — cada parâmetro é uma lista de padrões parciais):

    - contains: omite O.S. sem nenhum item que case (nada dela apareceria).
    - not_contains: omite O.S. que tinha itens e TODOS casaram (sairia como
      linha zerada — ex.: cortesia só-Lavagem Simples no card Cortesia).
      O.S. originalmente sem itens é mantida (pertence ao grupo Serviços).
    - contains tem precedência quando ambos são fornecidos.
    """
    item_filter = _build_item_filter(service_name_contains, service_name_not_contains)
    if item_filter is None:
        return orders

    if service_name_contains:
        return [o for o in orders if any(item_filter(item) for item in (o.items or []))]

    return [
        o
        for o in orders
        if not (o.items or []) or any(item_filter(item) for item in (o.items or []))
    ]


@router.get("", response_model=ServiceOrderListResponse)
async def list_service_orders(
    db: AsyncSession = Depends(get_db),
    pagination: dict = Depends(get_pagination_params),
    current_user=Depends(get_current_user),
    store_id: int | None = Query(None, description="Filtrar por loja"),
    store_ids: list[int] = Query(default=[], description="Filtrar por múltiplas lojas"),
    status_filter: list[OSStatus] | None = Query(
        default=None, alias="status", description="Filtrar por status"
    ),
    department: ServiceDepartment | None = Query(None, description="Filtrar por departamento"),
    departments: list[ServiceDepartment] = Query(
        default=[], description="Filtrar por múltiplos departamentos"
    ),
    date_from: datetime | None = Query(
        None, description="Data inicial (service_date ou entry_time)"
    ),
    date_to: datetime | None = Query(None, description="Data final (service_date ou entry_time)"),
    plate: str | None = Query(None, description="Filtrar por placa"),
    service_ids: list[int] = Query(
        default=[], description="O.S. com ao menos um item nesses serviços"
    ),
    conference_statuses: list[ConferenceStatus] = Query(
        default=[], description="Filtro multi de status da conferência (OR das condições)"
    ),
    is_verified: bool | None = Query(default=None, description="Filtrar por verificação"),
    flag: list[str] = Query(
        default=[], description="Filtrar por flags OR: courtesy, galpon, retorno"
    ),
    worker_id: int | None = Query(None, description="Filtrar por instalador (employee_id)"),
    include_cancelled: bool = Query(
        False, description="Incluir OS canceladas (usado pelo filtro 'Todas' na conferência)"
    ),
    sort_by: str | None = Query(
        None, description="Coluna para ordenação (service_date, plate, value, etc)"
    ),
    sort_dir: str = Query("desc", description="Direção da ordenação: asc ou desc"),
):
    """
    Lista ordens de serviço.
    - Owner: vê todas as O.S.
    - Demais: veem as O.S. das lojas do seu perfil de acesso (apply_store_filter)
    """
    service_orders, total = await service.list_service_orders(
        db=db,
        user=current_user,
        store_id=store_id,
        store_ids=store_ids or None,
        status=status_filter,
        department=department,
        departments=departments or None,
        date_from=date_from,
        date_to=date_to,
        plate=plate,
        service_ids=service_ids or None,
        conference_statuses=conference_statuses or None,
        is_verified=is_verified,
        worker_id=worker_id,
        include_cancelled=include_cancelled,
        flags=flag or None,
        sort_by=sort_by,
        sort_dir=sort_dir,
        page=pagination["page"],
        limit=pagination["limit"],
    )

    items = []
    for so in service_orders:
        resp = ServiceOrderResponse.model_validate(so)
        resp.updated_by_name = so.updated_by.full_name if so.updated_by else None
        items.append(resp)

    return PaginatedResponse.create(
        items=items,
        total=total,
        page=pagination["page"],
        limit=pagination["limit"],
    )


@router.get("/duplicate-check", response_model=DuplicateCheckResponse)
async def duplicate_check(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    plate: str = Query(..., description="Placa/Chassi do veículo"),
    service_date: date = Query(..., description="Data do serviço (YYYY-MM-DD)"),
    department: str = Query(..., description="Departamento"),
    service_ids: list[int] = Query(default=[], description="IDs dos serviços selecionados"),
    is_return: bool = Query(default=False, description="Lançamento de retorno/retrabalho"),
    exclude_appointment_id: int | None = Query(
        default=None, description="Agendamento a ignorar (ao editar o próprio agendamento)"
    ),
    exclude_service_order_id: int | None = Query(
        default=None, description="O.S. a ignorar (ao editar; ex.: a O.S. gerada pelo agendamento)"
    ),
):
    """
    Verifica se já existem O.S. ou agendamentos em duplicidade para o lançamento atual.

    Duplicidade = mesma Placa/Chassi + data no mesmo mês/ano + ao menos 1 serviço em comum.
    Retorno/retrabalho (is_return) é exceção legítima e nunca acusa duplicidade.
    Ao editar, exclude_* ignora o próprio registro/O.S. para não acusar a si mesmo.
    Não bloqueia nada — apenas informa para o frontend exibir um aviso.
    """
    return await service.find_launch_duplicates(
        db=db,
        user=current_user,
        plate=plate,
        on_date=service_date,
        department=department,
        service_ids=service_ids,
        is_return=is_return,
        exclude_appointment_id=exclude_appointment_id,
        exclude_service_order_id=exclude_service_order_id,
    )


@router.get("/export/resumo-diario")
async def export_resumo_diario(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    store_id: int = Query(..., description="ID da loja (obrigatório)"),
    report_date: date = Query(..., alias="date", description="Data do resumo (YYYY-MM-DD)"),
    only_completed: bool = Query(
        False, description="Só O.S. finalizadas no dia (Resumo Diário do Agendamento)"
    ),
):
    """
    Gera o PDF do Resumo Diário da loja (Relatório de Serviços do Encarregado).

    A4 retrato: Estética + fechamento do dia (seção de Película oculta por enquanto).
    Loja comum: O.S. da loja fora do galpão. Loja galpão (is_galpon_store):
    O.S. is_galpon=True de qualquer loja. Cancelada/duplicada/lançado errado
    aparecem sinalizadas e fora dos totais; cortesia não soma na receita.
    """
    from app.core.permissions import (
        hide_galpon_user,
        is_galpon_profile_user,
        require_resource_access,
    )
    from app.modules.service_orders import daily_summary
    from app.modules.stores.models import Store

    require_resource_access(current_user, store_id, "Resumo Diário")

    store = (await db.execute(select(Store).where(Store.id == store_id))).scalar_one_or_none()
    if store is None:
        raise NotFoundError(detail="Loja não encontrada")

    # Perfil exclusivo de galpão só gera o resumo do galpão; quem oculta galpão não gera o do galpão
    if is_galpon_profile_user(current_user) and not store.is_galpon_store:
        raise AuthorizationError(detail="Perfil de galpão só gera o Resumo Diário do galpão")
    if hide_galpon_user(current_user) and store.is_galpon_store:
        raise AuthorizationError(detail="Perfil sem acesso ao galpão não gera o resumo do galpão")

    data = await daily_summary.gather_daily_summary(
        db=db,
        store_id=store_id,
        report_date=report_date,
        responsible=current_user.full_name,
        only_completed=only_completed,
    )
    # CPU-bound (fpdf2): fora do event loop para não travar o worker.
    content = await run_in_threadpool(
        daily_summary.generate_daily_summary_pdf, data, film_only=only_completed
    )

    filename = f"resumo_diario_{store_id}_{report_date.strftime('%Y%m%d')}.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/fechamento")
async def export_fechamento(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    store_id: int | None = Query(None, description="ID da loja"),
    date_from: datetime | None = Query(None, description="Data inicial"),
    date_to: datetime | None = Query(None, description="Data final"),
    department: ServiceDepartment | None = Query(None, description="Filtrar por departamento"),
    departments: list[ServiceDepartment] = Query(
        default=[],
        description=(
            "Filtrar por vários departamentos (repetível). Quando fornecido, tem "
            "precedência sobre `department`."
        ),
    ),
    is_courtesy: bool | None = Query(None, description="Filtrar por cortesia"),
    is_return: bool | None = Query(
        None, description="Filtrar por retorno (True=só retornos, False=excluir retornos)"
    ),
    service_name_contains: list[str] = Query(
        default=[],
        description=(
            "Filtrar por nome de serviço (parcial, por item; repetível — item casa "
            "se contém ALGUM dos padrões). O.S. sem nenhum item que case é omitida. "
            "Mutuamente exclusivo com service_name_not_contains; este tem precedência."
        ),
    ),
    service_name_not_contains: list[str] = Query(
        default=[],
        description=(
            "Excluir itens cujo nome de serviço contenha ALGUM destes textos "
            "(por item; repetível). O.S. workshop sem itens é mantida (grupo Serviços). "
            "Ignorado quando service_name_contains também for fornecido."
        ),
    ),
    status: OSStatus | None = Query(None, description="Filtrar por status (ex: cancelled)"),
):
    """
    Gera e retorna o arquivo Excel de fechamento com as OS verificadas.

    Filtra por store_id e/ou período (date_from / date_to).
    Apenas OS com is_verified=True são incluídas, exceto quando status=cancelled.

    service_name_contains e service_name_not_contains atuam POR ITEM:
    - contains: mantém apenas itens que casam; O.S. sem nenhum item que case é omitida.
    - not_contains: mantém apenas itens que não casam; O.S. cujos itens casaram todos
      é omitida (evita linha zerada); O.S. originalmente sem itens é mantida.
    - Se ambos forem enviados, contains tem precedência.
    """
    flags: list[str] = []
    if is_courtesy is True:
        flags.append("courtesy")

    # Canceladas não passam por verificação; demais cards exigem is_verified=True
    is_verified_filter: bool | None = None if status == OSStatus.CANCELLED else True

    # departments[] tem precedência: busca ampla (department=None) + pós-filtro
    # departments[] tem precedência sobre department (resolvido no service)
    orders, _total = await service.list_service_orders(
        db=db,
        user=current_user,
        store_id=store_id,
        date_from=date_from,
        date_to=date_to,
        is_verified=is_verified_filter,
        status=status,
        department=department,
        departments=departments or None,
        flags=flags or None,
        is_return=is_return,
        page=1,
        limit=5000,
    )

    # Excluir cortesias quando is_courtesy=False for explicitamente solicitado
    if is_courtesy is False:
        orders = [o for o in orders if not o.is_courtesy]

    # Filtro por nome de serviço — classificação POR ITEM (D4)
    item_filter: Callable[[Any], bool] | None = _build_item_filter(
        service_name_contains, service_name_not_contains
    )

    orders = _prefilter_orders_by_service_name(
        orders, service_name_contains, service_name_not_contains
    )

    # Determinar nome da loja
    store_name: str = ""
    if store_id is not None:
        from sqlalchemy import select as sa_select

        from app.modules.stores.models import Store

        result = await db.execute(sa_select(Store.name).where(Store.id == store_id))
        store_name = result.scalar_one_or_none() or str(store_id)
    elif orders:
        store_name = orders[0].store.name if orders[0].store else ""

    # CPU-bound (openpyxl): fora do event loop.
    content = await run_in_threadpool(
        export.generate_fechamento_excel,
        orders,
        store_name,
        date_from,
        date_to,
        department=department.value if department else None,
        item_filter=item_filter,
    )

    date_from_str = date_from.strftime("%Y%m%d") if date_from else "inicio"
    date_to_str = date_to.strftime("%Y%m%d") if date_to else "fim"
    filename = f"fechamento_{store_id or 'all'}_{date_from_str}_{date_to_str}.xlsx"

    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/fechamento-resumo")
async def export_fechamento_resumo(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    store_id: int | None = Query(None, description="ID da loja"),
    date_from: datetime | None = Query(None, description="Data inicial"),
    date_to: datetime | None = Query(None, description="Data final"),
):
    """
    Gera Excel de RESUMO do fechamento agrupado por departamento e serviço.
    Inclui a separação especial de Oficina em Cortesia e Lavagem Simples.
    OS com is_return=True são excluídas (têm card próprio).
    Apenas OS com is_verified=True são incluídas.
    """
    orders, _total = await service.list_service_orders(
        db=db,
        user=current_user,
        store_id=store_id,
        date_from=date_from,
        date_to=date_to,
        is_verified=True,
        is_return=False,
        page=1,
        limit=5000,
    )

    # Determinar nome da loja
    store_name: str = ""
    if store_id is not None:
        from sqlalchemy import select as sa_select

        from app.modules.stores.models import Store

        result = await db.execute(sa_select(Store.name).where(Store.id == store_id))
        store_name = result.scalar_one_or_none() or str(store_id)
    elif orders:
        store_name = orders[0].store.name if orders[0].store else ""

    content = await run_in_threadpool(
        export.generate_resumo_fechamento_excel, orders, store_name, date_from, date_to
    )

    date_from_str = date_from.strftime("%Y%m%d") if date_from else "inicio"
    date_to_str = date_to.strftime("%Y%m%d") if date_to else "fim"
    filename = f"resumo_fechamento_{store_id or 'all'}_{date_from_str}_{date_to_str}.xlsx"

    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/fechamento-secao")
async def export_fechamento_secao(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    store_id: int | None = Query(None, description="ID da loja"),
    date_from: datetime | None = Query(None, description="Data inicial"),
    date_to: datetime | None = Query(None, description="Data final"),
    dept_key: str = Query(..., description="workshop_courtesy|workshop_lavagem|bodywork|vn|vd|vu"),
):
    """
    Gera Excel com apenas a seção do departamento indicado, baseado no template FECHAMENTO.xlsx.
    Apenas OS com is_verified=True são incluídas.
    """
    # Montar filtros base de departamento
    department = None
    is_courtesy: bool | None = None

    if dept_key == "workshop_courtesy":
        # Cortesia de Oficina + Película/Segurança/PPF: busca ampla + pós-filtro
        department = None
        is_courtesy = True
    elif dept_key == "workshop_lavagem":
        department = "workshop"
        is_courtesy = False
    elif dept_key == "bodywork":
        department = "bodywork"
    elif dept_key == "vn":
        department = "vn"
    elif dept_key == "vd":
        department = "vd"
    elif dept_key == "vu":
        department = "vu"

    from app.modules.services.enums import ServiceDepartment

    dept_enum = ServiceDepartment(department) if department else None
    flags: list[str] = []
    if is_courtesy is True:
        flags.append("courtesy")

    orders, _total = await service.list_service_orders(
        db=db,
        user=current_user,
        store_id=store_id,
        date_from=date_from,
        date_to=date_to,
        department=dept_enum,
        is_verified=True,
        flags=flags or None,
        page=1,
        limit=5000,
    )

    # Para workshop_lavagem e workshop_other, excluir cortesias (is_courtesy=False).
    # A separação por nome de serviço (lavagem simples vs. outros) é feita por item
    # dentro de _svc_agg — não é necessário filtrar O.S. inteiras aqui.
    if dept_key in ("workshop_lavagem", "workshop_other"):
        orders = [o for o in orders if not o.is_courtesy]

    # Oficina Cortesia agrega Oficina + Película/Segurança/PPF cortesia
    if dept_key == "workshop_courtesy":
        orders = [
            o for o in orders if (o.department or "").lower() in export.COURTESY_BUCKET_DEPARTMENTS
        ]

    store_name: str = ""
    if store_id is not None:
        from sqlalchemy import select as sa_select

        from app.modules.stores.models import Store

        result = await db.execute(sa_select(Store.name).where(Store.id == store_id))
        store_name = result.scalar_one_or_none() or str(store_id)
    elif orders:
        store_name = orders[0].store.name if orders[0].store else ""

    content = await run_in_threadpool(
        export.generate_section_fechamento_excel,
        orders,
        dept_key,
        store_name,
        date_from,
        date_to,
    )

    date_from_str = date_from.strftime("%Y%m%d") if date_from else "inicio"
    date_to_str = date_to.strftime("%Y%m%d") if date_to else "fim"
    filename = f"fechamento_{dept_key}_{store_id or 'all'}_{date_from_str}_{date_to_str}.xlsx"

    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/conferencia")
async def export_conferencia(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    store_id: int | None = Query(None, description="ID da loja"),
    store_ids: list[int] = Query(default=[], description="Filtrar por múltiplas lojas"),
    date_from: datetime | None = Query(
        None, description="Data inicial (service_date ou entry_time)"
    ),
    date_to: datetime | None = Query(None, description="Data final (service_date ou entry_time)"),
    department: ServiceDepartment | None = Query(None, description="Filtrar por departamento"),
    departments: list[ServiceDepartment] = Query(
        default=[], description="Filtrar por múltiplos departamentos"
    ),
    is_verified: bool | None = Query(None, description="Filtrar por status de verificação"),
    status_filter: str | None = Query(
        None, alias="status", description="Filtrar por status (ex: cancelled)"
    ),
    conference_statuses: list[ConferenceStatus] = Query(
        default=[], description="Filtro multi de status da conferência (OR das condições)"
    ),
    flag: list[str] = Query(
        default=[], description="Filtrar por flags OR: courtesy, galpon, retorno"
    ),
    plate: str | None = Query(None, description="Filtrar por placa/OS"),
    service_ids: list[int] = Query(
        default=[], description="O.S. com ao menos um item nesses serviços"
    ),
    worker_id: int | None = Query(None, description="Filtrar por instalador (employee_id)"),
):
    """
    Gera e retorna o arquivo Excel de conferência com as OS filtradas.
    Uma linha por serviço, respeitando todos os filtros da tela de conferência.
    """
    from sqlalchemy import select as sa_select
    from sqlalchemy.orm import selectinload

    from app.modules.service_orders.models import ServiceOrder as SOModel
    from app.modules.service_orders.models import ServiceOrderItem, ServiceOrderWorker

    query = service.build_conference_export_query(
        current_user,
        store_id=store_id,
        store_ids=store_ids,
        date_from=date_from,
        date_to=date_to,
        department=department,
        departments=departments,
        is_verified=is_verified,
        status_filter=status_filter,
        conference_statuses=conference_statuses,
        flag=flag,
        plate=plate,
        service_ids=service_ids,
        worker_id=worker_id,
    )

    query = query.limit(5000)

    # Carga em lotes: primeiro só os IDs (já na ordem final do relatório), depois
    # os objetos completos com eager load em chunks — evita manter 5000 O.S. com
    # todas as relações em memória de uma vez (worker único com limite de 256 MB).
    id_result = await db.execute(query.with_only_columns(SOModel.id))
    ordered_ids = list(id_result.scalars().all())

    writer = export.ConferenceExcelWriter()
    batch_size = 500
    for i in range(0, len(ordered_ids), batch_size):
        chunk = ordered_ids[i : i + batch_size]
        batch_q = (
            sa_select(SOModel)
            .options(
                selectinload(SOModel.items).selectinload(ServiceOrderItem.service),
                selectinload(SOModel.consultant),
                selectinload(SOModel.store),
                selectinload(SOModel.workers).selectinload(ServiceOrderWorker.employee),
                selectinload(SOModel.created_by),
            )
            .where(SOModel.id.in_(chunk))
        )
        batch_result = await db.execute(batch_q)
        position = {oid: idx for idx, oid in enumerate(chunk)}
        batch_orders = sorted(batch_result.scalars().all(), key=lambda o: position[o.id])
        writer.add_orders(batch_orders)
        # Libera os objetos do identity map da sessão entre lotes
        db.expunge_all()

    content = await run_in_threadpool(writer.finish)

    date_from_str = date_from.strftime("%Y%m%d") if date_from else "inicio"
    date_to_str = date_to.strftime("%Y%m%d") if date_to else "fim"
    filename = f"conferencia_{store_id or 'all'}_{date_from_str}_{date_to_str}.xlsx"

    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/fotos")
async def export_fotos(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    store_id: int | None = Query(None, description="ID da loja"),
    store_ids: list[int] = Query(default=[], description="Filtrar por múltiplas lojas"),
    date_from: datetime | None = Query(
        None, description="Data inicial (service_date ou entry_time)"
    ),
    date_to: datetime | None = Query(None, description="Data final (service_date ou entry_time)"),
    department: ServiceDepartment | None = Query(None, description="Filtrar por departamento"),
    departments: list[ServiceDepartment] = Query(
        default=[], description="Filtrar por múltiplos departamentos"
    ),
    is_verified: bool | None = Query(None, description="Filtrar por status de verificação"),
    status_filter: str | None = Query(
        None, alias="status", description="Filtrar por status (ex: cancelled)"
    ),
    conference_statuses: list[ConferenceStatus] = Query(
        default=[], description="Filtro multi de status da conferência (OR das condições)"
    ),
    flag: list[str] = Query(
        default=[], description="Filtrar por flags OR: courtesy, galpon, retorno"
    ),
    plate: str | None = Query(None, description="Filtrar por placa/OS"),
    service_ids: list[int] = Query(
        default=[], description="O.S. com ao menos um item nesses serviços"
    ),
    worker_id: int | None = Query(None, description="Filtrar por instalador (employee_id)"),
):
    """
    Gera um ZIP com as fotos das O.S. filtradas na Conferência (mesmos filtros do
    export de Excel). Uma pasta por O.S., nomeada pelo número de O.S. da
    concessionária; arquivos com prefixo foto_/avaria_/chancela_.
    """
    import json
    import os

    from starlette.background import BackgroundTask
    from starlette.concurrency import run_in_threadpool
    from starlette.responses import StreamingResponse

    from app.modules.service_orders.models import ServiceOrder as SOModel
    from app.modules.upload.router import build_s3_client, read_media_bytes

    query = service.build_conference_export_query(
        current_user,
        store_id=store_id,
        store_ids=store_ids,
        date_from=date_from,
        date_to=date_to,
        department=department,
        departments=departments,
        is_verified=is_verified,
        status_filter=status_filter,
        conference_statuses=conference_statuses,
        flag=flag,
        plate=plate,
        service_ids=service_ids,
        worker_id=worker_id,
    ).limit(5000)

    # Só as colunas necessárias (nada de relações) — os campos de foto são JSON em Text.
    cols_query = query.with_only_columns(
        SOModel.id,
        SOModel.external_os_number,
        SOModel.vehicle_plate,
        SOModel.photos,
        SOModel.damage_photos,
        SOModel.completion_photos,
    )
    result = await db.execute(cols_query)

    def _parse(raw: str | None) -> list[str]:
        if not raw:
            return []
        try:
            value = json.loads(raw)
            return [str(u) for u in value if u] if isinstance(value, list) else []
        except (ValueError, TypeError):
            return []

    orders: list[dict] = [
        {
            "id": row.id,
            "external_os_number": row.external_os_number,
            "vehicle_plate": row.vehicle_plate,
            "photos": _parse(row.photos),
            "damage_photos": _parse(row.damage_photos),
            "completion_photos": _parse(row.completion_photos),
        }
        for row in result.all()
    ]

    # Montagem do ZIP é I/O síncrono e bloqueante (storage + disco) → threadpool.
    # Reusa UM cliente boto3 para todas as fotos (antes recriava um por foto).
    _s3 = build_s3_client()
    zip_path = await run_in_threadpool(
        export.build_photos_zip, orders, lambda url: read_media_bytes(url, s3_client=_s3)
    )

    date_from_str = date_from.strftime("%Y%m%d") if date_from else "inicio"
    date_to_str = date_to.strftime("%Y%m%d") if date_to else "fim"
    filename = f"fotos_conferencia_{store_id or 'all'}_{date_from_str}_{date_to_str}.zip"

    file_handle = open(zip_path, "rb")  # noqa: SIM115 — fechado no BackgroundTask após o stream

    def _cleanup() -> None:
        try:
            file_handle.close()
        finally:
            try:
                os.remove(zip_path)
            except OSError:
                pass

    return StreamingResponse(
        file_handle,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        background=BackgroundTask(_cleanup),
    )


@router.get("/conference/summary", response_model=list[dict])
async def get_conference_summary(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    store_ids: list[int] = Query(default=[], description="Filtrar por múltiplas lojas"),
    date_from: datetime | None = Query(
        None, description="Data inicial (service_date ou entry_time)"
    ),
    date_to: datetime | None = Query(None, description="Data final (service_date ou entry_time)"),
    plate: str | None = Query(None, description="Filtrar por placa/OS"),
    service_ids: list[int] = Query(
        default=[], description="O.S. com ao menos um item nesses serviços"
    ),
    worker_id: int | None = Query(None, description="Filtrar por instalador (employee_id)"),
    include_cancelled: bool = Query(False, description="Incluir OS canceladas na contagem"),
    is_courtesy: bool | None = Query(None, description="Filtrar por cortesia"),
):
    """
    Retorna um resumo de O.S. da conferência agrupado por departamento.

    Para cada departamento retorna total, verificadas, aguardando, erradas,
    canceladas e percentual verificado.

    Acessível para qualquer usuário autenticado.
    """
    return await service.get_conference_summary(
        db=db,
        user=current_user,
        store_ids=store_ids or None,
        date_from=date_from,
        date_to=date_to,
        plate=plate,
        service_ids=service_ids or None,
        worker_id=worker_id,
        include_cancelled=include_cancelled,
        is_courtesy=is_courtesy,
    )


@router.get("/conference/summary/by-store", response_model=list[dict])
async def get_conference_summary_by_store(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    store_ids: list[int] = Query(default=[], description="Filtrar por múltiplas lojas"),
    date_from: datetime | None = Query(
        None, description="Data inicial (service_date ou entry_time)"
    ),
    date_to: datetime | None = Query(None, description="Data final (service_date ou entry_time)"),
    plate: str | None = Query(None, description="Filtrar por placa/OS"),
    service_ids: list[int] = Query(
        default=[], description="O.S. com ao menos um item nesses serviços"
    ),
    worker_id: int | None = Query(None, description="Filtrar por instalador (employee_id)"),
    include_cancelled: bool = Query(False, description="Incluir OS canceladas na contagem"),
    is_courtesy: bool | None = Query(None, description="Filtrar por cortesia"),
):
    """
    Retorna um resumo de O.S. da conferência agrupado por LOJA.

    Para cada loja retorna total, verificadas, aguardando, erradas, canceladas e
    percentual verificado. Mesmos filtros do resumo por departamento.

    Acessível para qualquer usuário autenticado.
    """
    return await service.get_conference_summary_by_store(
        db=db,
        user=current_user,
        store_ids=store_ids or None,
        date_from=date_from,
        date_to=date_to,
        plate=plate,
        service_ids=service_ids or None,
        worker_id=worker_id,
        include_cancelled=include_cancelled,
        is_courtesy=is_courtesy,
    )


@router.get("/vehicle-history", response_model=VehicleHistoryResponse)
async def get_vehicle_history(
    plate: str = Query(..., description="Placa ou chassi do veículo"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Retorna todas as OSs abertas para um veículo (por placa/chassi)."""
    orders = await service.get_vehicle_history(db=db, plate=plate, user=current_user)
    items = []
    for o in orders:
        items.append(
            VehicleHistoryItemResponse(
                id=o.id,
                order_number=o.order_number,
                service_date=o.service_date,
                entry_time=o.entry_time,
                department=o.department,
                status=o.status,
                store_name=o.store.name if o.store else None,
                service_names=[
                    (item.service.name if item.service else f"Serviço #{item.service_id}")
                    for item in (o.items or [])
                ],
            )
        )
    return VehicleHistoryResponse(plate=plate.upper(), items=items)


@router.get("/return-origin-suggestion")
async def return_origin_suggestion(
    plate: str = Query(..., min_length=3),
    exclude_os_id: int | None = Query(None),
    store_id: int | None = Query(
        None, description="Loja onde o retorno será aberto (amplia a busca à marca)"
    ),
    department: str | None = Query(
        None, description="Departamento do retorno — restringe a origem ao mesmo departamento"
    ),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Sugere a O.S. de origem para um retorno (por placa/chassi).

    Quando `store_id` é informado, a busca inclui as O.S. de outras lojas da mesma
    marca dessa loja — exige que o usuário tenha acesso à loja informada.

    Quando `department` é informado, a origem é restrita ao mesmo departamento.
    """
    if store_id is not None:
        require_resource_access(current_user, store_id, "Loja")
    so = await service.suggest_return_origin(
        db, plate, current_user, exclude_os_id, store_id=store_id, department=department
    )
    if so is None:
        return {"suggestion": None}
    return {
        "suggestion": {
            "id": so.id,
            "order_number": so.order_number,
            "external_os_number": so.external_os_number,
            "service_date": so.service_date.isoformat() if so.service_date else None,
            "services": [i.service.code or i.service.name for i in so.items if i.service],
        }
    }


@router.get("/{service_order_id}/history", response_model=OSHistoryResponse)
async def get_os_history(
    service_order_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Retorna o histórico de transições de status de uma OS."""
    history_items = await service.get_os_history(
        db=db, service_order_id=service_order_id, user=current_user
    )
    return OSHistoryResponse(
        items=[StatusHistoryResponse.from_orm_with_user(h) for h in history_items]
    )


@router.get("/{service_order_id}", response_model=ServiceOrderDetailResponse)
async def get_service_order(
    service_order_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Obtém detalhes completos de uma ordem de serviço."""
    service_order = await service.get_service_order(
        db=db, service_order_id=service_order_id, user=current_user
    )
    resp = ServiceOrderDetailResponse.model_validate(service_order)
    resp.updated_by_name = service_order.updated_by.full_name if service_order.updated_by else None

    # Metros de película consumidos por item — só no detalhe (ver docstring de
    # get_item_linear_meters). Uma única query agregada para todos os itens.
    meters_by_item = await service.get_item_linear_meters(db, [item.id for item in resp.items])
    for item_resp in resp.items:
        item_resp.linear_meters = meters_by_item.get(item_resp.id)

    return resp


@router.post(
    "",
    response_model=ServiceOrderDetailResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(check_profile_permission("service_orders", "can_edit"))],
)
async def create_service_order(
    request: Request,
    data: ServiceOrderCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Cria uma nova ordem de serviço.

    Validações:
    - Placa brasileira válida (ABC1D23 ou ABC1234)
    - Mínimo 4 fotos obrigatórias
    - Pelo menos 1 item (serviço)
    """
    service_order = await service.create_service_order(
        db=db, data=data, user=current_user, request=request
    )
    return ServiceOrderDetailResponse.model_validate(service_order)


@router.patch(
    "/{service_order_id}",
    response_model=ServiceOrderDetailResponse,
    dependencies=[Depends(check_profile_permission("service_orders", "can_edit"))],
)
async def update_service_order(
    request: Request,
    service_order_id: int,
    data: ServiceOrderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Atualiza uma ordem de serviço.
    Não permite mudar status (use endpoint específico para isso).

    Validações:
    - Usuário deve ter acesso à loja da O.S.
    """
    # Buscar O.S. primeiro para validar permissões de loja
    order = await service.get_service_order(
        db=db, service_order_id=service_order_id, user=current_user
    )

    # Validar permissão de loja
    permissions.require_store_access(current_user, order.store_id, "atualizar ordem de serviço")

    service_order = await service.update_service_order(
        db=db, service_order_id=service_order_id, data=data, user=current_user, request=request
    )
    return ServiceOrderDetailResponse.model_validate(service_order)


@router.delete(
    "/{service_order_id}",
    response_model=ServiceOrderDetailResponse,
)
async def cancel_service_order(
    request: Request,
    service_order_id: int,
    reason: str | None = Query(None, description="Motivo do cancelamento"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Cancela uma ordem de serviço (soft delete).
    Owner pode sempre cancelar.
    Usuários com can_delete=True no módulo 'conference' também podem cancelar.
    A O.S. não é excluída do banco — fica disponível para auditoria.
    """
    if current_user.role != UserRole.OWNER.value:
        if not get_access_profile_permission(current_user, "conference", "delete"):
            raise AuthorizationError(
                detail="Permissão negada: sem permissão para cancelar ordens de serviço"
            )

    order = await service.get_service_order(
        db=db, service_order_id=service_order_id, user=current_user
    )
    permissions.require_store_access(current_user, order.store_id, "cancelar ordem de serviço")
    service_order = await service.cancel_service_order(
        db=db,
        service_order_id=service_order_id,
        user=current_user,
        reason=reason,
        request=request,
    )
    return ServiceOrderDetailResponse.model_validate(service_order)


@router.post(
    "/{service_order_id}/finalize",
    response_model=ServiceOrderDetailResponse,
    dependencies=[Depends(check_can_change_os_status())],
)
async def finalize_service_order(
    service_order_id: int,
    data: FinalizeOrderRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Finaliza uma O.S. em andamento — assigna bobinas, workers e fotos da chancela.
    Muda status para completed.
    """
    order = await service.get_service_order(
        db=db, service_order_id=service_order_id, user=current_user
    )
    permissions.require_store_access(current_user, order.store_id, "finalizar ordem de serviço")
    result = await service.finalize_service_order(db, service_order_id, data, current_user, request)
    return ServiceOrderDetailResponse.model_validate(result)


@router.api_route(
    "/{service_order_id}/status",
    methods=["POST", "PATCH"],
    response_model=ServiceOrderDetailResponse,
    dependencies=[Depends(check_can_change_os_status())],
)
async def change_status(
    request: Request,
    service_order_id: int,
    data: StatusUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Muda o status de uma ordem de serviço.

    # Fluxo de status:
    # - waiting → in_progress (ou completed, wrong)
    # - in_progress → waiting, completed, wrong
    # - completed → wrong
    # - wrong → waiting

    Validações:
    - Usuário deve ter acesso à loja da O.S.
    """
    # Buscar O.S. primeiro para validar permissões de loja
    order = await service.get_service_order(
        db=db, service_order_id=service_order_id, user=current_user
    )

    # Validar permissão de loja
    permissions.require_store_access(
        current_user, order.store_id, "alterar status da ordem de serviço"
    )

    service_order = await service.change_status(
        db=db, service_order_id=service_order_id, data=data, user=current_user, request=request
    )
    return ServiceOrderDetailResponse.model_validate(service_order)


@router.post(
    "/{service_order_id}/undo-wrong",
    response_model=ServiceOrderDetailResponse,
    dependencies=[Depends(check_can_change_os_status())],
)
async def undo_wrong(
    request: Request,
    service_order_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Desfaz o "Lançado Errado" restaurando a O.S. ao status anterior (tipicamente
    Finalizado), em vez de reabrir para Aguardando. Evita que corrigir um falso
    "Lançado Errado" de uma O.S. já finalizada a faça ressurgir como "Atrasado".
    """
    order = await service.get_service_order(
        db=db, service_order_id=service_order_id, user=current_user
    )
    permissions.require_store_access(
        current_user, order.store_id, "alterar status da ordem de serviço"
    )
    service_order = await service.undo_wrong(
        db=db, service_order_id=service_order_id, user=current_user, request=request
    )
    return ServiceOrderDetailResponse.model_validate(service_order)


@router.patch("/{service_order_id}/verify", response_model=ServiceOrderDetailResponse)
async def set_service_order_verified(
    service_order_id: int,
    data: VerifyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("conference", "can_edit")),
) -> ServiceOrderDetailResponse:
    """
    Marca/desmarca a verificação (conferência) de uma O.S. — caminho leve e dedicado.

    Mais rápido que o update genérico: altera apenas is_verified/verified_at, grava histórico
    mínimo e faz o broadcast WebSocket em background.
    """
    service_order = await service.set_verified(
        db=db,
        service_order_id=service_order_id,
        verified=data.verified,
        user=current_user,
        request=request,
    )
    return ServiceOrderDetailResponse.model_validate(service_order)
