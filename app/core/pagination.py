"""
Pagination helper for async SQLAlchemy queries.
"""

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def paginate(
    db: AsyncSession,
    query: Select,
    page: int = 1,
    limit: int = 20,
    order_by=None,
) -> tuple[list, int]:
    """
    Executa query com paginação e retorna (items, total).

    Args:
        db: Sessão assíncrona do banco de dados
        query: Query SQLAlchemy já com filtros aplicados
        page: Número da página (1-based)
        limit: Itens por página
        order_by: Cláusula de ordenação (ex: Model.created_at.desc())

    Returns:
        Tuple com lista de itens e total de registros
    """
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    if order_by is not None:
        if isinstance(order_by, tuple):
            query = query.order_by(*order_by)
        else:
            query = query.order_by(order_by)

    offset = (page - 1) * limit
    result = await db.execute(query.offset(offset).limit(limit))
    items = list(result.scalars().all())

    return items, total
