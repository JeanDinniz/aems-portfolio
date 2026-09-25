"""
Holiday service - Business logic for holiday management.
"""

from datetime import date as date_type

from sqlalchemy import extract, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, NotFoundError
from app.core.pagination import paginate
from app.modules.holidays.models import Holiday
from app.modules.holidays.schemas import HolidayCreate, HolidayResponse, HolidayUpdate


def build_holiday_response(holiday: Holiday) -> HolidayResponse:
    """Projeção com nome da loja (None = todas as lojas)."""
    return HolidayResponse(
        id=holiday.id,
        date=holiday.date,
        name=holiday.name,
        store_id=holiday.store_id,
        store_name=holiday.store.name if holiday.store else None,
        created_at=holiday.created_at,
        updated_at=holiday.updated_at,
    )


async def list_holidays(
    db: AsyncSession,
    year: int | None = None,
    store_id: int | None = None,
    page: int = 1,
    limit: int = 100,
) -> tuple[list[Holiday], int]:
    """
    Lista feriados. store_id filtra os aplicáveis à loja
    (específicos dela + globais).
    """
    query = select(Holiday).options(selectinload(Holiday.store))

    if year is not None:
        query = query.where(extract("year", Holiday.date) == year)

    if store_id is not None:
        query = query.where(or_(Holiday.store_id == store_id, Holiday.store_id.is_(None)))

    return await paginate(db, query, page, limit, order_by=Holiday.date)


async def get_holiday(db: AsyncSession, holiday_id: int) -> Holiday:
    """Obtém um feriado por ID (com loja carregada)."""
    result = await db.execute(
        select(Holiday).options(selectinload(Holiday.store)).where(Holiday.id == holiday_id)
    )
    holiday = result.scalar_one_or_none()

    if not holiday:
        raise NotFoundError(resource="Feriado")

    return holiday


async def _check_duplicate(
    db: AsyncSession,
    date: date_type,
    store_id: int | None,
    exclude_id: int | None = None,
) -> None:
    """Bloqueia feriado duplicado na mesma data/escopo (unique não cobre NULL)."""
    query = select(Holiday).where(Holiday.date == date)
    if store_id is None:
        query = query.where(Holiday.store_id.is_(None))
    else:
        query = query.where(Holiday.store_id == store_id)
    if exclude_id is not None:
        query = query.where(Holiday.id != exclude_id)

    result = await db.execute(query)
    if result.scalar_one_or_none():
        scope = "esta loja" if store_id else "todas as lojas"
        raise ConflictError(detail=f"Já existe feriado em {date.strftime('%d/%m/%Y')} para {scope}")


async def create_holiday(db: AsyncSession, data: HolidayCreate) -> Holiday:
    """Cria um novo feriado."""
    await _check_duplicate(db, data.date, data.store_id)

    holiday = Holiday(**data.model_dump())
    db.add(holiday)
    await db.flush()

    return await get_holiday(db, holiday.id)


async def update_holiday(db: AsyncSession, holiday_id: int, data: HolidayUpdate) -> Holiday:
    """Atualiza um feriado existente."""
    holiday = await get_holiday(db, holiday_id)

    update_data = data.model_dump(exclude_unset=True, exclude={"clear_store"})
    new_date = update_data.get("date", holiday.date)
    if data.clear_store:
        new_store_id = None
    else:
        new_store_id = update_data.get("store_id", holiday.store_id)

    if new_date != holiday.date or new_store_id != holiday.store_id:
        await _check_duplicate(db, new_date, new_store_id, exclude_id=holiday_id)

    for field, value in update_data.items():
        setattr(holiday, field, value)
    holiday.store_id = new_store_id

    await db.flush()

    return await get_holiday(db, holiday_id)


async def delete_holiday(db: AsyncSession, holiday_id: int) -> dict:
    """Exclui permanentemente um feriado."""
    holiday = await get_holiday(db, holiday_id)
    deleted_info = {"id": holiday.id, "name": holiday.name, "date": holiday.date.isoformat()}

    try:
        await db.delete(holiday)
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ConflictError(detail="Não é possível excluir o feriado.") from None

    return deleted_info


async def get_holiday_dates_for_store(
    db: AsyncSession,
    store_id: int | None,
    date_from: date_type,
    date_to: date_type,
) -> list[Holiday]:
    """
    Feriados aplicáveis à loja (específicos + globais) no intervalo.
    Sem loja (None), valem apenas os feriados globais.
    Usado pelo Resumo Diário e pela previsão de faturamento (dias úteis).
    """
    result = await db.execute(
        select(Holiday)
        .where(
            Holiday.date >= date_from,
            Holiday.date <= date_to,
            or_(Holiday.store_id == store_id, Holiday.store_id.is_(None)),
        )
        .order_by(Holiday.date)
    )
    return list(result.scalars().all())
