"""
Schemas Pydantic da Biblioteca (documentos operacionais e apresentações).
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.schemas import PaginationMeta

LibraryCategory = Literal["operacional", "apresentacoes"]


class LibraryDocumentCreate(BaseModel):
    """
    Cadastro de um documento da biblioteca.

    O arquivo é enviado antes por ``POST /upload/document``; aqui chegam a URL e
    os metadados devolvidos por aquele endpoint.
    """

    category: LibraryCategory
    title: str = Field(..., min_length=2, max_length=200)
    description: str | None = None
    file_url: str = Field(..., min_length=1, max_length=500)
    file_name: str = Field(..., min_length=1, max_length=255)
    file_type: str | None = Field(None, max_length=100)
    file_size: int | None = Field(None, ge=0)
    display_order: int = 0


class LibraryDocumentUpdate(BaseModel):
    """Atualização de documento — todos os campos são opcionais."""

    category: LibraryCategory | None = None
    title: str | None = Field(None, min_length=2, max_length=200)
    description: str | None = None
    file_url: str | None = Field(None, min_length=1, max_length=500)
    file_name: str | None = Field(None, min_length=1, max_length=255)
    file_type: str | None = Field(None, max_length=100)
    file_size: int | None = Field(None, ge=0)
    display_order: int | None = None
    is_active: bool | None = None


class LibraryDocumentResponse(BaseModel):
    """Resposta de um documento da biblioteca."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    category: str
    title: str
    description: str | None = None
    file_url: str
    file_name: str
    file_type: str | None = None
    file_size: int | None = None
    uploaded_by_id: int | None = None
    uploaded_by_name: str | None = None
    display_order: int
    is_active: bool
    created_at: datetime
    updated_at: datetime | None = None


class LibraryDocumentListResponse(BaseModel):
    """Resposta paginada da listagem de documentos."""

    items: list[LibraryDocumentResponse]
    pagination: PaginationMeta
