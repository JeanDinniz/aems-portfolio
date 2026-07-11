"""
Schemas compartilhados entre módulos.
"""

from pydantic import BaseModel


class PaginationMeta(BaseModel):
    """
    Metadados de paginação das respostas de lista.

    Reflete exatamente o shape produzido por
    app.dependencies.PaginatedResponse.create() — tipar aqui documenta o
    contrato no OpenAPI e valida a resposta (antes era `dict` cego, o que
    deixou passar divergências de contrato no frontend).
    """

    page: int
    limit: int
    total: int
    total_pages: int
    has_next: bool
    has_prev: bool
