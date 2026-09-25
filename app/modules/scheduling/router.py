"""Scheduling router - FastAPI endpoints for appointment management."""

from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import check_profile_permission, require_resource_access
from app.db.session import get_db
from app.dependencies import PaginatedResponse
from app.modules.auth.models import User
from app.modules.scheduling import schemas, service

router = APIRouter(prefix="/scheduling", tags=["Scheduling"])


@router.get("/summary/today", response_model=schemas.AppointmentSummaryResponse)
async def get_today_summary(
    store_id: int | None = Query(None, description="Filtrar por loja (opcional)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission("scheduling", "can_view")),
) -> schemas.AppointmentSummaryResponse:
    """Retorna contadores de agendamentos para o dia atual por status."""
    return await service.get_today_summary(db, current_user, store_id)


@router.get("/capacity", response_model=dict)
async def get_capacity_count(
    store_id: int = Query(..., description="ID da loja"),
    delivery_date: date = Query(..., description="Data de entrega"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission("scheduling", "can_view")),
) -> dict:
    """Retorna o número de agendamentos ativos para uma loja e data de entrega."""
    # BAIXA: valida acesso à loja (o store_id vem do cliente).
    require_resource_access(current_user, store_id, "Agendamentos")
    count = await service.get_capacity_count(db, store_id, delivery_date)
    return {"count": count}


@router.get("/", response_model=schemas.AppointmentListResponse)
async def list_appointments(
    store_id: int | None = Query(None, description="Filtrar por loja"),
    department: str | None = Query(None, description="Filtrar por departamento"),
    category: str | None = Query(None, description="Filtrar por categoria de serviço"),
    display_status: str | None = Query(None, description="Filtrar por status de exibição"),
    date_from: date | None = Query(None, description="Data de entrega inicial (inclusive)"),
    date_to: date | None = Query(None, description="Data de entrega final (inclusive)"),
    search: str | None = Query(None, description="Busca por placa ou número de O.S. externa"),
    include_cancelled: bool = Query(False, description="Incluir agendamentos cancelados"),
    include_terminal: bool = Query(
        False, description="Incluir agendamentos terminais (finalizados + cancelados)"
    ),
    page: int = Query(1, ge=1, description="Página"),
    limit: int = Query(20, ge=1, le=200, description="Itens por página"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission("scheduling", "can_view")),
) -> schemas.AppointmentListResponse:
    """Lista agendamentos com filtros e paginação."""
    items, total = await service.list_appointments(
        db=db,
        user=current_user,
        store_id=store_id,
        department=department,
        category=category,
        display_status=display_status,
        date_from=date_from,
        date_to=date_to,
        search=search,
        include_cancelled=include_cancelled,
        include_terminal=include_terminal,
        page=page,
        limit=limit,
    )
    return schemas.AppointmentListResponse(
        **PaginatedResponse.create(items=items, total=total, page=page, limit=limit)
    )


@router.get("/export/carros-para-fazer")
async def export_carros_para_fazer(
    store_id: int | None = Query(None, description="Filtrar por loja"),
    department: str | None = Query(None, description="Filtrar por departamento"),
    category: str | None = Query(None, description="Filtrar por categoria de serviço"),
    date_from: date | None = Query(None, description="Data de entrega inicial (inclusive)"),
    date_to: date | None = Query(None, description="Data de entrega final (inclusive)"),
    search: str | None = Query(None, description="Busca por placa ou número de O.S. externa"),
    display_status: list[str] | None = Query(
        None,
        description="Restringe aos status pendentes selecionados "
        "(atrasado/atencao/agendado/em_execucao); pode repetir",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission("scheduling", "can_view")),
) -> Response:
    """
    PDF "Carros para Fazer": lista de trabalho impressa dos carros pendentes que
    aparecem no Agendamento, respeitando os filtros da tela. Só status pendentes
    (atrasado/atenção/agendado/em execução).
    """
    from sqlalchemy import select as _select

    from app.modules.scheduling.carros_pdf import (
        DEPARTMENT_LABELS,
        build_carros_data,
        generate_carros_para_fazer_pdf,
    )
    from app.modules.stores.models import Store

    appointments = await service.list_appointments_for_export(
        db=db,
        user=current_user,
        store_id=store_id,
        department=department,
        category=category,
        date_from=date_from,
        date_to=date_to,
        search=search,
        display_statuses=display_status,
    )

    # Rótulos para o cabeçalho do PDF
    store_label = "Todas as Lojas"
    if store_id is not None:
        name = (
            await db.execute(_select(Store.name).where(Store.id == store_id))
        ).scalar_one_or_none()
        store_label = name or f"Loja {store_id}"

    if date_from and date_to:
        period_label = (
            date_from.strftime("%d/%m/%Y")
            if date_from == date_to
            else f"{date_from.strftime('%d/%m/%Y')} a {date_to.strftime('%d/%m/%Y')}"
        )
    elif date_from:
        period_label = f"A partir de {date_from.strftime('%d/%m/%Y')}"
    elif date_to:
        period_label = f"Até {date_to.strftime('%d/%m/%Y')}"
    else:
        period_label = "Todos"

    data = build_carros_data(
        appointments=appointments,
        store_label=store_label,
        period_label=period_label,
        department_label=DEPARTMENT_LABELS.get(department, "Todos") if department else "Todos",
        category_label=category or "Todas",
    )

    pdf_bytes = generate_carros_para_fazer_pdf(data)

    safe_store = "".join(c for c in store_label if c.isalnum() or c in "-_") or "lojas"
    stamp = data.generated_at.strftime("%Y%m%d")
    filename = f"carros_para_fazer_{safe_store}_{stamp}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/summary/carros-para-fazer", response_model=schemas.CarrosResumoResponse)
async def get_carros_resumo(
    store_id: int | None = Query(None, description="Filtrar por loja"),
    department: str | None = Query(None, description="Filtrar por departamento"),
    category: str | None = Query(None, description="Filtrar por categoria de serviço"),
    date_from: date | None = Query(None, description="Data de entrega inicial (inclusive)"),
    date_to: date | None = Query(None, description="Data de entrega final (inclusive)"),
    search: str | None = Query(None, description="Busca por placa ou número de O.S. externa"),
    display_status: list[str] | None = Query(
        None,
        description="Restringe aos status pendentes selecionados "
        "(atrasado/atencao/agendado/em_execucao); pode repetir",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission("scheduling", "can_view")),
) -> schemas.CarrosResumoResponse:
    """
    Resumo por loja dos "carros para fazer": contagem de agendamentos pendentes
    (atrasado/atenção/agendado/em execução) agrupados por loja, com os mesmos
    filtros e critério do PDF "Carros para Fazer" (export/carros-para-fazer).
    """
    return await service.get_carros_resumo(
        db=db,
        user=current_user,
        store_id=store_id,
        department=department,
        category=category,
        date_from=date_from,
        date_to=date_to,
        search=search,
        display_statuses=display_status,
    )


@router.get("/export/excel")
async def export_excel(
    store_id: int | None = Query(None, description="Filtrar por loja"),
    department: str | None = Query(None, description="Filtrar por departamento"),
    category: str | None = Query(None, description="Filtrar por categoria de serviço"),
    date_from: date | None = Query(None, description="Data de entrega inicial (inclusive)"),
    date_to: date | None = Query(None, description="Data de entrega final (inclusive)"),
    search: str | None = Query(None, description="Busca por placa ou número de O.S. externa"),
    include_cancelled: bool = Query(False, description="Incluir agendamentos cancelados"),
    include_terminal: bool = Query(
        False, description="Incluir agendamentos terminais (finalizados + cancelados)"
    ),
    display_status: list[str] | None = Query(
        None,
        description="Restringe aos status da legenda selecionados (pode repetir); "
        "espelha o filtro visual da tela",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission("scheduling", "can_view")),
) -> Response:
    """
    Excel "Agendamento": exporta os carros exibidos na tela (respeita filtros, o
    toggle de finalizados/cancelados e a seleção de status da legenda), no formato
    da planilha operacional (21 colunas).
    """
    from app.modules.scheduling.excel import generate_scheduling_excel

    matrix = await service.collect_scheduling_excel_matrix(
        db=db,
        user=current_user,
        store_id=store_id,
        department=department,
        category=category,
        date_from=date_from,
        date_to=date_to,
        search=search,
        include_cancelled=include_cancelled,
        include_terminal=include_terminal,
        display_statuses=display_status,
    )
    content = generate_scheduling_excel(matrix)

    if date_from and date_to:
        stamp = f"{date_from.isoformat()}_{date_to.isoformat()}"
    elif date_from:
        stamp = f"desde_{date_from.isoformat()}"
    elif date_to:
        stamp = f"ate_{date_to.isoformat()}"
    else:
        stamp = date.today().isoformat()
    filename = f"agendamento_{stamp}.xlsx"

    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/", response_model=schemas.AppointmentResponse, status_code=201)
async def create_appointment(
    data: schemas.AppointmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission("scheduling", "can_edit")),
) -> schemas.AppointmentResponse:
    """Cria um novo agendamento."""
    return await service.create_appointment(db, data, current_user)


@router.post("/combined", response_model=schemas.CombinedAppointmentResponse, status_code=201)
async def create_combined_appointments(
    data: schemas.CombinedAppointmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission("scheduling", "can_edit")),
) -> schemas.CombinedAppointmentResponse:
    """
    Agendamento combinado: um carro com serviços de vários departamentos.
    Cria 1 agendamento POR departamento, vinculados por appointment_group_id
    (transacional — tudo ou nada). Mantém a regra de O.S./Fechamento por
    departamento: cada agendamento do grupo gera e finaliza sua O.S. normalmente.
    """
    items = await service.create_combined_appointments(db, data, current_user)
    return schemas.CombinedAppointmentResponse(items=items)


@router.get("/summary/stores", response_model=list[schemas.SchedulingStoreSummary])
async def get_store_summaries(
    date_from: date | None = Query(None, description="Data de entrega inicial"),
    date_to: date | None = Query(None, description="Data de entrega final"),
    department: str | None = Query(None, description="Filtrar por departamento"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission("scheduling", "can_view")),
) -> list[schemas.SchedulingStoreSummary]:
    """Retorna contadores de agendamentos agrupados por loja."""
    return await service.get_store_summaries(
        db=db,
        user=current_user,
        date_from=date_from,
        date_to=date_to,
        department=department,
    )


@router.get("/{appointment_id}", response_model=schemas.AppointmentResponse)
async def get_appointment(
    appointment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission("scheduling", "can_view")),
) -> schemas.AppointmentResponse:
    """Retorna os detalhes de um agendamento."""
    appt = await service.get_appointment(db, appointment_id, current_user)
    return service.appointment_to_response(
        appt,
        await service._build_service_map(db, [appt]),
        await service._build_roll_map(db, [appt]),
        await service._build_group_map(db, [appt]),
        await service._build_os_applications_map(db, [appt]),
    )


@router.patch("/{appointment_id}", response_model=schemas.AppointmentResponse)
async def update_appointment(
    appointment_id: int,
    data: schemas.AppointmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission("scheduling", "can_edit")),
) -> schemas.AppointmentResponse:
    """Atualiza um agendamento existente."""
    return await service.update_appointment(db, appointment_id, data, current_user)


@router.post(
    "/{appointment_id}/add-departments", response_model=schemas.CombinedAppointmentResponse
)
async def add_departments_to_appointment(
    appointment_id: int,
    data: schemas.AddDepartmentsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission("scheduling", "can_edit")),
) -> schemas.CombinedAppointmentResponse:
    """
    Combina departamentos na edição: cria agendamentos-irmãos para os
    departamentos informados, vinculados ao agendamento base pelo
    appointment_group_id (gerado se o base ainda era avulso). Cada irmão
    herda os dados do veículo/entrega do base e segue o fluxo normal depois.
    """
    items = await service.add_departments_to_appointment(
        db, appointment_id, data.departments, current_user
    )
    return schemas.CombinedAppointmentResponse(items=items)


@router.post("/{appointment_id}/generate-os", status_code=201)
async def generate_os_from_appointment(
    appointment_id: int,
    data: schemas.GenerateOSRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission("scheduling_os", "can_edit")),
) -> dict:
    """Gera uma O.S. a partir de um agendamento."""
    service_order = await service.generate_service_order(db, appointment_id, data, current_user)
    return {"service_order_id": service_order.id, "order_number": service_order.order_number}


@router.get("/{appointment_id}/history", response_model=schemas.AppointmentHistoryResponse)
async def get_appointment_history(
    appointment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission("scheduling", "can_view")),
) -> schemas.AppointmentHistoryResponse:
    """Retorna o histórico de edições de um agendamento."""
    return await service.get_appointment_history(db, appointment_id, current_user)


@router.delete("/{appointment_id}", response_model=schemas.AppointmentResponse)
async def cancel_appointment(
    appointment_id: int,
    body: schemas.CancelAppointmentRequest = schemas.CancelAppointmentRequest(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission("scheduling", "can_delete")),
) -> schemas.AppointmentResponse:
    """Cancela um agendamento (não deleta do banco, apenas muda status para cancelled)."""
    return await service.cancel_appointment(
        db, appointment_id, body.cancellation_reason, current_user
    )
