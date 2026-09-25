"""
Serviço do Certificado de Garantia: persistência do histórico + geração do PDF.

Guarda os dados de cada certificado emitido e regenera o PDF sob demanda a partir
deles (o arquivo não é armazenado).
"""

from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.core.media_url import validate_internal_media_url
from app.core.pagination import paginate
from app.core.permissions import apply_store_filter, require_resource_access
from app.modules.auth.models import User
from app.modules.ebook.certificates.generator import (
    DEFAULT_SERVICE,
    DEFAULT_WARRANTY_MONTHS,
    CertificateData,
    generate_certificate_pdf,
)
from app.modules.ebook.certificates.schemas import CertificateCreate, CertificateUpdate
from app.modules.ebook.models import Certificate
from app.modules.stores.models import Store


async def _resolve_store(db: AsyncSession, store_id: int | None) -> tuple[str | None, str | None]:
    """Devolve (store_name, store_address) para o snapshot do certificado."""
    if store_id is None:
        return None, None
    store = (await db.execute(select(Store).where(Store.id == store_id))).scalar_one_or_none()
    if store is None:
        return None, None
    return store.name, store.address


async def create_certificate(db: AsyncSession, data: CertificateCreate, user: User) -> Certificate:
    """Salva um certificado no histórico (o PDF é gerado depois, sob demanda)."""
    # 🟠 (auditoria): foto assinada só do upload do próprio sistema.
    validate_internal_media_url(data.signed_photo_url, field="Foto do certificado")
    store_name, store_address = await _resolve_store(db, data.store_id)

    cert = Certificate(
        created_by_id=user.id,
        created_by_name=user.full_name,
        service_order_id=data.service_order_id,
        os_number=(data.os_number or None),
        brand_code=data.brand_code,
        brand_name=data.brand_name,
        store_id=data.store_id,
        store_name=store_name,
        store_address=store_address,
        plate=(data.plate or None),
        customer_name=(data.customer_name or None),
        model=(data.model or None),
        color=(data.color or None),
        invoice_number=(data.invoice_number or None),
        chassi=(data.chassi or None),
        service_name=(data.service_name or DEFAULT_SERVICE),
        warranty_months=(data.warranty_months or DEFAULT_WARRANTY_MONTHS),
        issue_date=data.issue_date or date.today(),
        signed_photo_url=(data.signed_photo_url or None),
    )
    db.add(cert)
    await db.flush()
    await db.refresh(cert)
    return cert


async def update_certificate(
    db: AsyncSession, certificate_id: int, data: CertificateUpdate, user: User | None = None
) -> Certificate:
    """Atualiza um certificado do histórico (re-resolve a loja se ela mudar)."""
    cert = await get_certificate(db, certificate_id, user)

    update_data = data.model_dump(exclude_unset=True)
    # 🟠 (auditoria): valida a nova foto assinada quando enviada.
    if "signed_photo_url" in update_data:
        validate_internal_media_url(update_data["signed_photo_url"], field="Foto do certificado")

    if "store_id" in update_data:
        store_name, store_address = await _resolve_store(db, update_data["store_id"])
        cert.store_name = store_name
        cert.store_address = store_address

    for field, value in update_data.items():
        setattr(cert, field, value)

    await db.flush()
    await db.refresh(cert)
    return cert


async def list_certificates(
    db: AsyncSession,
    user: User,
    page: int = 1,
    limit: int = 20,
    store_id: int | None = None,
    brand_code: str | None = None,
    search: str | None = None,
) -> tuple[list[Certificate], int]:
    """Lista o histórico de certificados (escopo de loja do usuário + filtros)."""
    query = apply_store_filter(select(Certificate), user, Certificate.store_id)

    if store_id is not None:
        query = query.where(Certificate.store_id == store_id)
    if brand_code:
        query = query.where(Certificate.brand_code == brand_code)
    if search:
        term = f"%{search.strip()}%"
        query = query.where(
            or_(
                Certificate.customer_name.ilike(term),
                Certificate.plate.ilike(term),
                Certificate.os_number.ilike(term),
            )
        )

    return await paginate(db, query, page, limit, order_by=Certificate.created_at.desc())


async def get_certificate(
    db: AsyncSession, certificate_id: int, user: User | None = None
) -> Certificate:
    """Obtém um certificado por ID ou lança NotFoundError.

    Quando `user` é informado e o certificado tem loja, valida o escopo de loja
    (fecha o IDOR do get/pdf/patch). Certificado sem loja (legado) não é escopado
    — a permissão de módulo já gate o acesso. Owner passa por qualquer loja.
    """
    cert = (
        await db.execute(select(Certificate).where(Certificate.id == certificate_id))
    ).scalar_one_or_none()
    if cert is None:
        raise NotFoundError(resource="Certificado")
    if user is not None and cert.store_id is not None:
        require_resource_access(user, cert.store_id, "Certificado")
    return cert


async def delete_certificate(db: AsyncSession, certificate_id: int) -> dict:
    """Exclui um certificado do histórico."""
    cert = await get_certificate(db, certificate_id)
    info = {"id": cert.id, "customer_name": cert.customer_name}
    await db.delete(cert)
    await db.flush()
    return info


def build_pdf(cert: Certificate) -> bytes:
    """Regenera o PDF do certificado a partir dos dados salvos."""
    return generate_certificate_pdf(
        CertificateData(
            brand_code=cert.brand_code,
            brand_name=cert.brand_name,
            store_address=cert.store_address,
            os_number=cert.os_number or "",
            plate=cert.plate or "",
            model=cert.model or "",
            color=cert.color or "",
            customer_name=cert.customer_name or "",
            invoice_number=cert.invoice_number or "",
            chassi=cert.chassi or "",
            service_name=cert.service_name or DEFAULT_SERVICE,
            warranty_months=cert.warranty_months or DEFAULT_WARRANTY_MONTHS,
            issue_date=cert.issue_date,
        )
    )
