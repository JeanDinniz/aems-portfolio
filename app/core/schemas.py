"""
Schemas compartilhados entre módulos.
"""

from pydantic import BaseModel, Field, field_validator

from app.core.validators import normalize_tonality


class FilmApplicationItem(BaseModel):
    """
    Uma aplicação de película dentro de um serviço: tonalidade + região do carro.

    Um serviço pode ter N aplicações quando o cliente escolhe tonalidades
    diferentes por região (ex.: G20 nas portas dianteiras, G05 nas traseiras).
    Compartilhado entre scheduling (film_entries) e service_orders (itens).
    """

    tonality: str = Field(..., min_length=1, max_length=20)
    region: str | None = Field(None, max_length=60)

    @field_validator("tonality")
    @classmethod
    def normalize_tonality_value(cls, v: str) -> str:
        normalized = normalize_tonality(v)
        if not normalized:
            raise ValueError("Informe a tonalidade da aplicação")
        return normalized

    @field_validator("region")
    @classmethod
    def strip_region(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip() or None


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
