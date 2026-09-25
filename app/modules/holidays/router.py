"""
Holiday router - API endpoints for holiday management.
Leitura: qualquer usuário autenticado.
Escrita: Owner ou perfil com permissão de edição em Lojas (stores.can_edit).
"""

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import check_profile_permission
from app.core.security import get_current_user
from app.db.session import get_db
from app.dependencies import PaginatedResponse
from app.modules.holidays import service
from app.modules.holidays.schemas import (
    HolidayCreate,
    HolidayListResponse,
    HolidayResponse,
    HolidayUpdate,
)

router = APIRouter(prefix="/holidays", tags=["Holidays"])


@router.get("", response_model=HolidayListResponse)
async def list_holidays(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
    page: int = Query(1, ge=1, description="Página atual"),
    limit: int = Query(100, ge=1, le=500, description="Itens por página"),
    year: int | None = Query(None, ge=2000, le=2100, description="Filtrar por ano"),
    store_id: int | None = Query(
        None, description="Feriados aplicáveis à loja (específicos + globais)"
    ),
):
    """Lista feriados cadastrados."""
    holidays, total = await service.list_holidays(
        db=db, year=year, store_id=store_id, page=page, limit=limit
    )

    return PaginatedResponse.create(
        items=[service.build_holiday_response(h) for h in holidays],
        total=total,
        page=page,
        limit=limit,
    )


@router.post(
    "",
    response_model=HolidayResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(check_profile_permission("stores", "can_edit"))],
)
async def create_holiday(
    data: HolidayCreate,
    db: AsyncSession = Depends(get_db),
):
    """Cria um novo feriado (data + nome; loja opcional, vazio = todas)."""
    holiday = await service.create_holiday(db=db, data=data)
    return service.build_holiday_response(holiday)


@router.patch(
    "/{holiday_id}",
    response_model=HolidayResponse,
    dependencies=[Depends(check_profile_permission("stores", "can_edit"))],
)
async def update_holiday(
    holiday_id: int,
    data: HolidayUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Atualiza um feriado existente."""
    holiday = await service.update_holiday(db=db, holiday_id=holiday_id, data=data)
    return service.build_holiday_response(holiday)


@router.delete(
    "/{holiday_id}",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(check_profile_permission("stores", "can_delete"))],
)
async def delete_holiday(
    holiday_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Exclui permanentemente um feriado."""
    return await service.delete_holiday(db=db, holiday_id=holiday_id)
