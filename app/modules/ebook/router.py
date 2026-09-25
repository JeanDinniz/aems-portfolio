"""
Router do módulo E-book / Biblioteca — documentos + certificados de garantia.

Permissão via perfil de acesso (submódulo "ebook"):
- can_view para leitura (listar/baixar documentos, gerar/ver certificados);
- can_edit para criar/editar documentos e certificados;
- can_delete para excluir documentos.
Owner tem acesso total. A exclusão de certificado é restrita ao Proprietário.
"""

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.exceptions import NotFoundError
from app.core.permissions import UserRole, check_profile_permission, require_roles
from app.db.session import get_db
from app.dependencies import PaginatedResponse
from app.modules.ebook import service
from app.modules.ebook.certificates import service as cert_service
from app.modules.ebook.certificates.schemas import (
    CertificateCreate,
    CertificateListResponse,
    CertificateResponse,
    CertificateUpdate,
)
from app.modules.ebook.schemas import (
    LibraryDocumentCreate,
    LibraryDocumentListResponse,
    LibraryDocumentResponse,
    LibraryDocumentUpdate,
)


def _require_ebook_enabled() -> None:
    """Feature flag EBOOK_ENABLED: módulo desligado responde 404 (ex.: produção)."""
    if not get_settings().EBOOK_ENABLED:
        raise NotFoundError()


router = APIRouter(
    prefix="/ebook",
    tags=["Ebook"],
    dependencies=[Depends(_require_ebook_enabled)],
)

SUB_MODULE = "ebook"


# ---------------------------------------------------------------------------
# Biblioteca de documentos
# ---------------------------------------------------------------------------


@router.get("", response_model=LibraryDocumentListResponse)
async def list_documents(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_view")),
    page: int = Query(1, ge=1, description="Página atual"),
    limit: int = Query(50, ge=1, le=200, description="Itens por página"),
    category: str | None = Query(None, description="operacional | apresentacoes"),
    is_active: bool | None = Query(None, description="Filtrar por status ativo"),
    search: str | None = Query(None, description="Busca em título/descrição"),
):
    """Lista documentos da biblioteca (com filtros e paginação)."""
    items, total = await service.list_documents(
        db=db,
        category=category,
        is_active=is_active,
        search=search,
        page=page,
        limit=limit,
    )
    return PaginatedResponse.create(
        items=[LibraryDocumentResponse.model_validate(i) for i in items],
        total=total,
        page=page,
        limit=limit,
    )


# ---------------------------------------------------------------------------
# Certificados de garantia (rotas literais antes de "/{document_id}")
# ---------------------------------------------------------------------------


@router.post(
    "/certificates",
    response_model=CertificateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_certificate(
    data: CertificateCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_edit")),
) -> CertificateResponse:
    """
    Gera (salva) um Certificado de Garantia no histórico.

    Não baixa o PDF: registra os dados e devolve o certificado, que aparece na
    tela para o usuário revisar e então baixar o PDF por
    ``GET /ebook/certificates/{id}/pdf``.
    """
    cert = await cert_service.create_certificate(db, data, current_user)
    return CertificateResponse.model_validate(cert)


@router.get("/certificates", response_model=CertificateListResponse)
async def list_certificates(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_view")),
    page: int = Query(1, ge=1, description="Página atual"),
    limit: int = Query(20, ge=1, le=200, description="Itens por página"),
    store_id: int | None = Query(None, description="Filtra por loja (seletor global)"),
    brand_code: str | None = Query(None, description="Filtra por marca"),
    search: str | None = Query(None, description="Busca por cliente, placa ou O.S."),
):
    """Lista o histórico de certificados emitidos (escopo de loja do usuário)."""
    items, total = await cert_service.list_certificates(
        db=db,
        user=current_user,
        page=page,
        limit=limit,
        store_id=store_id,
        brand_code=brand_code,
        search=search,
    )
    return PaginatedResponse.create(
        items=[CertificateResponse.model_validate(c) for c in items],
        total=total,
        page=page,
        limit=limit,
    )


@router.get("/certificates/{certificate_id}/pdf")
async def download_certificate_pdf(
    certificate_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_view")),
):
    """Gera e baixa o PDF de um certificado já salvo (regerado a partir dos dados)."""
    cert = await cert_service.get_certificate(db, certificate_id, current_user)
    content = cert_service.build_pdf(cert)
    safe = (cert.plate or "certificado").strip().replace(" ", "-").replace("/", "-")
    filename = f"certificado_vitrificacao_{safe or 'certificado'}.pdf"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/certificates/{certificate_id}", response_model=CertificateResponse)
async def get_certificate(
    certificate_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_view")),
) -> CertificateResponse:
    """Obtém um certificado específico (tela Visualizar)."""
    cert = await cert_service.get_certificate(db, certificate_id, current_user)
    return CertificateResponse.model_validate(cert)


@router.patch("/certificates/{certificate_id}", response_model=CertificateResponse)
async def update_certificate(
    certificate_id: int,
    data: CertificateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_edit")),
) -> CertificateResponse:
    """Edita um certificado do histórico."""
    cert = await cert_service.update_certificate(db, certificate_id, data, current_user)
    return CertificateResponse.model_validate(cert)


@router.delete(
    "/certificates/{certificate_id}",
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def delete_certificate(
    certificate_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Exclui um certificado do histórico (somente Proprietário)."""
    return await cert_service.delete_certificate(db, certificate_id)


# ---------------------------------------------------------------------------
# Documentos por ID (rota dinâmica — declarada após as rotas literais acima)
# ---------------------------------------------------------------------------


@router.get("/{document_id}", response_model=LibraryDocumentResponse)
async def get_document(
    document_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_view")),
):
    """Obtém um documento específico."""
    doc = await service.get_document(db=db, doc_id=document_id)
    return LibraryDocumentResponse.model_validate(doc)


@router.post("", response_model=LibraryDocumentResponse, status_code=status.HTTP_201_CREATED)
async def create_document(
    data: LibraryDocumentCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_edit")),
):
    """Cadastra um novo documento na biblioteca."""
    doc = await service.create_document(db=db, data=data, user=current_user)
    return LibraryDocumentResponse.model_validate(doc)


@router.patch("/{document_id}", response_model=LibraryDocumentResponse)
async def update_document(
    document_id: int,
    data: LibraryDocumentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_edit")),
):
    """Atualiza um documento existente."""
    doc = await service.update_document(db=db, doc_id=document_id, data=data)
    return LibraryDocumentResponse.model_validate(doc)


@router.delete("/{document_id}", response_model=LibraryDocumentResponse)
async def deactivate_document(
    document_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_delete")),
):
    """Desativa um documento (soft delete)."""
    doc = await service.deactivate_document(db=db, doc_id=document_id)
    return LibraryDocumentResponse.model_validate(doc)


@router.delete("/{document_id}/permanent", status_code=status.HTTP_200_OK)
async def hard_delete_document(
    document_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(check_profile_permission(SUB_MODULE, "can_delete")),
):
    """Exclui permanentemente um documento."""
    return await service.hard_delete_document(db=db, doc_id=document_id)
