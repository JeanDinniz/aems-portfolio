"""Router do módulo de Pedidos de Material."""

from datetime import date as date_type
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import check_profile_permission, require_resource_access
from app.core.security import get_current_user
from app.db.session import get_db
from app.dependencies import PaginatedResponse
from app.modules.inventory.schemas import RollServiceOrdersResponse
from app.modules.material_requests import service
from app.modules.material_requests.export import generate_material_requests_excel
from app.modules.material_requests.schemas import (
    CancelMaterialRequest,
    MaterialRequestCreate,
    MaterialRequestListResponse,
    MaterialRequestResponse,
    MaterialRequestUpdate,
    RollYieldResponse,
    ToolCardListResponse,
    ToolReceiptConfirm,
)

router = APIRouter(prefix="/material-requests", tags=["Material Requests"])

_XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get(
    "",
    response_model=MaterialRequestListResponse,
    dependencies=[Depends(check_profile_permission("material_requests", "can_view"))],
)
async def list_requests(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    store_id: int | None = Query(None),
    date_from: date_type | None = Query(None),
    date_to: date_type | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
):
    requests, total = await service.list_requests(
        db,
        current_user,
        store_id=store_id,
        date_from=date_from,
        date_to=date_to,
        page=page,
        limit=limit,
    )
    return PaginatedResponse.create(
        items=[service.build_material_request_response(r) for r in requests],
        total=total,
        page=page,
        limit=limit,
    )


@router.get(
    "/export/excel",
    dependencies=[Depends(check_profile_permission("material_requests", "can_view"))],
)
async def export_excel(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    store_id: int | None = Query(None),
    date_from: date_type | None = Query(None),
    date_to: date_type | None = Query(None),
):
    requests = await service.get_requests_for_export(
        db, current_user, store_id=store_id, date_from=date_from, date_to=date_to
    )
    content = generate_material_requests_excel(requests)
    filename = "pedidos_material.xlsx"
    return Response(
        content=content,
        media_type=_XLSX_MEDIA,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/tool-cards", response_model=ToolCardListResponse)
async def list_tool_cards(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    status_filter: str | None = Query(None, alias="status", description="pendente | recebido"),
    store_id: int | None = Query(None),
    employee_id: int | None = Query(None),
):
    """Cards de recebimento de ferramentas. Self-service (funcionário vê os seus)
    ou visão de gestor/owner (todos, com filtros). Sem submódulo dedicado —
    o escopo é resolvido internamente."""
    return await service.get_tool_cards(
        db,
        current_user,
        status=status_filter,
        store_id=store_id,
        employee_id=employee_id,
    )


@router.post("/tool-cards/confirm", status_code=status.HTTP_201_CREATED)
async def confirm_tool_receipt(
    data: ToolReceiptConfirm,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Registra o recebimento assinado de um card (o funcionário confirma)."""
    receipt = await service.confirm_tool_receipt(db, data, current_user)
    return {"id": receipt.id, "detail": "Recebimento registrado"}


@router.get(
    "/roll-yield",
    response_model=RollYieldResponse,
    dependencies=[Depends(check_profile_permission("material_requests", "can_view"))],
)
async def roll_yield(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    store_id: int | None = Query(None),
    film_type_id: int | None = Query(None),
    per_material: int = Query(7, ge=1, le=30),
):
    return await service.get_roll_yield(
        db,
        current_user,
        store_id=store_id,
        film_type_id=film_type_id,
        per_material=per_material,
    )


@router.get(
    "/roll/{film_roll_id}/service-orders",
    response_model=RollServiceOrdersResponse,
    dependencies=[Depends(check_profile_permission("material_requests", "can_view"))],
)
async def roll_service_orders(
    film_roll_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Drill-down do Rendimento: os carros (O.S.) que uma bobina atendeu."""
    from app.modules.inventory.service import list_roll_service_orders

    return await list_roll_service_orders(db, film_roll_id, current_user)


@router.get("/{request_id}", response_model=MaterialRequestResponse)
async def get_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission("material_requests", "can_view")),
):
    req = await service.get_request(db, request_id)
    # Escopo de loja: só lê pedido de loja à qual o usuário tem acesso (fecha IDOR)
    require_resource_access(current_user, req.store_id, "Pedido de Material")
    return service.build_material_request_response(req)


@router.post(
    "",
    response_model=MaterialRequestResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(check_profile_permission("material_requests", "can_edit"))],
)
async def create_request(
    data: MaterialRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    req = await service.create_request(db, data, current_user)
    return service.build_material_request_response(req)


@router.patch(
    "/{request_id}",
    response_model=MaterialRequestResponse,
    dependencies=[Depends(check_profile_permission("material_requests", "can_edit"))],
)
async def update_request(
    request_id: int,
    data: MaterialRequestUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    req = await service.update_request(db, request_id, data, current_user)
    return service.build_material_request_response(req)


@router.delete(
    "/{request_id}",
    response_model=MaterialRequestResponse,
    dependencies=[Depends(check_profile_permission("material_requests", "can_delete"))],
)
async def cancel_request(
    request_id: int,
    body: CancelMaterialRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Cancela (invalida) um pedido — não apaga: fica visível com o motivo.

    As bobinas do pedido saem do Estoque; bloqueia (409) se alguma já foi usada.
    """
    req = await service.cancel_request(db, request_id, body.cancellation_reason, current_user)
    return service.build_material_request_response(req)
