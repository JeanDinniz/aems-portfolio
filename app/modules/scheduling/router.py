"""Scheduling router - FastAPI endpoints for appointment management."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import check_profile_permission
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


@router.post("/", response_model=schemas.AppointmentResponse, status_code=201)
async def create_appointment(
    data: schemas.AppointmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(check_profile_permission("scheduling", "can_edit")),
) -> schemas.AppointmentResponse:
    """Cria um novo agendamento."""
    return await service.create_appointment(db, data, current_user)


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
