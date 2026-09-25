"""
Serviço da Biblioteca — lógica de negócio dos documentos (Operacional/Apresentações).
"""

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit
from app.core.exceptions import NotFoundError
from app.core.media_url import validate_internal_media_url
from app.core.pagination import paginate
from app.modules.auth.models import User
from app.modules.ebook.models import LibraryDocument
from app.modules.ebook.schemas import LibraryDocumentCreate, LibraryDocumentUpdate


async def get_document_by_id(db: AsyncSession, doc_id: int) -> LibraryDocument | None:
    """Busca documento por ID."""
    result = await db.execute(select(LibraryDocument).where(LibraryDocument.id == doc_id))
    return result.scalar_one_or_none()


async def list_documents(
    db: AsyncSession,
    category: str | None = None,
    is_active: bool | None = None,
    search: str | None = None,
    page: int = 1,
    limit: int = 50,
) -> tuple[list[LibraryDocument], int]:
    """
    Lista documentos da biblioteca com filtros opcionais.

    Ordena por (display_order, title) para exibição estável por categoria.
    """
    query = select(LibraryDocument)

    if category is not None:
        query = query.where(LibraryDocument.category == category)
    if is_active is not None:
        query = query.where(LibraryDocument.is_active == is_active)
    if search:
        term = f"%{search.strip()}%"
        query = query.where(
            or_(
                LibraryDocument.title.ilike(term),
                LibraryDocument.description.ilike(term),
            )
        )

    return await paginate(
        db,
        query,
        page,
        limit,
        order_by=(LibraryDocument.display_order, LibraryDocument.title),
    )


async def get_document(db: AsyncSession, doc_id: int) -> LibraryDocument:
    """Obtém um documento por ID ou lança NotFoundError."""
    doc = await get_document_by_id(db, doc_id)
    if not doc:
        raise NotFoundError(resource="Documento da biblioteca")
    return doc


async def create_document(
    db: AsyncSession, data: LibraryDocumentCreate, user: User
) -> LibraryDocument:
    """Cria um novo documento na biblioteca."""
    # 🟠 (auditoria): só aceita URL do upload do próprio sistema.
    validate_internal_media_url(data.file_url, field="Arquivo")
    doc = LibraryDocument(
        uploaded_by_id=user.id,
        uploaded_by_name=user.full_name,
        **data.model_dump(),
    )
    db.add(doc)
    await db.flush()

    await log_audit(
        db=db,
        action="create",
        resource_type="library_document",
        user_id=user.id,
        resource_id=doc.id,
        new_value={"title": doc.title, "category": doc.category},
    )

    await db.refresh(doc)
    return doc


async def update_document(
    db: AsyncSession,
    doc_id: int,
    data: LibraryDocumentUpdate,
) -> LibraryDocument:
    """Atualiza um documento existente."""
    doc = await get_document(db, doc_id)

    update_data = data.model_dump(exclude_unset=True)
    # 🟠 (auditoria): valida a nova URL quando o arquivo é trocado.
    if "file_url" in update_data:
        validate_internal_media_url(update_data["file_url"], field="Arquivo")
    old_value = {field: getattr(doc, field, None) for field in update_data}

    for field, value in update_data.items():
        setattr(doc, field, value)

    await db.flush()

    await log_audit(
        db=db,
        action="update",
        resource_type="library_document",
        user_id=None,
        resource_id=doc.id,
        old_value=old_value,
        new_value=update_data,
    )

    await db.refresh(doc)
    return doc


async def deactivate_document(db: AsyncSession, doc_id: int) -> LibraryDocument:
    """Desativa um documento (soft delete)."""
    doc = await get_document(db, doc_id)

    doc.is_active = False
    await db.flush()

    await log_audit(
        db=db,
        action="deactivate",
        resource_type="library_document",
        user_id=None,
        resource_id=doc.id,
        old_value={"is_active": True},
        new_value={"is_active": False},
    )

    await db.refresh(doc)
    return doc


async def hard_delete_document(db: AsyncSession, doc_id: int) -> dict:
    """Exclui permanentemente um documento."""
    doc = await get_document(db, doc_id)
    deleted_info = {"id": doc.id, "title": doc.title}

    await log_audit(
        db=db,
        action="delete",
        resource_type="library_document",
        user_id=None,
        resource_id=doc.id,
        old_value={"title": doc.title},
    )

    await db.delete(doc)
    await db.flush()

    return deleted_info
