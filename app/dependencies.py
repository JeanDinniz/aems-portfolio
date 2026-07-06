"""
Global dependencies for FastAPI application.
Centraliza dependências comuns usadas em múltiplas rotas.
"""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db

# Type aliases para uso comum em rotas
DbSession = Annotated[AsyncSession, Depends(get_db)]

MAX_PAGINATION_LIMIT = 500


def get_pagination_params(
    page: int = 1,
    limit: int = 20,
) -> dict:
    """
    Dependency para parâmetros de paginação padronizados.

    Uso:
        @router.get("/items")
        async def list_items(pagination: dict = Depends(get_pagination_params)):
            page = pagination["page"]
            limit = pagination["limit"]
            offset = pagination["offset"]
    """
    if page < 1:
        page = 1
    if limit < 1:
        limit = 1
    if limit > MAX_PAGINATION_LIMIT:
        limit = MAX_PAGINATION_LIMIT

    return {
        "page": page,
        "limit": limit,
        "offset": (page - 1) * limit,
    }


class PaginatedResponse:
    """Helper para construir respostas paginadas."""

    @staticmethod
    def create(
        items: list,
        total: int,
        page: int,
        limit: int,
    ) -> dict:
        """
        Cria um dicionário de resposta paginada.

        Args:
            items: Lista de itens da página atual
            total: Total de itens disponíveis
            page: Página atual
            limit: Itens por página

        Returns:
            Dict com items, pagination info
        """
        total_pages = (total + limit - 1) // limit if limit > 0 else 0
        return {
            "items": items,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "total_pages": total_pages,
                "has_next": page < total_pages,
                "has_prev": page > 1,
            },
        }
