"""
Schemas do certificado de garantia.
"""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.core.schemas import PaginationMeta
from app.modules.ebook.certificates.generator import (
    DEFAULT_SERVICE,
    DEFAULT_WARRANTY_MONTHS,
    _add_months,
)


class CertificateCreate(BaseModel):
    """
    Dados enviados ao gerar/salvar um certificado.

    ``store_id`` define a loja emissora; o backend resolve o endereço da loja
    (rodapé do PDF) a partir dele. ``service_order_id``/``os_number`` vinculam o
    certificado à O.S. de origem (opcional). Os demais campos vêm do formulário.
    """

    brand_code: str = Field(..., min_length=1, max_length=30)
    brand_name: str | None = Field(None, max_length=100)
    store_id: int | None = Field(None, description="Loja emissora (define o endereço)")
    service_order_id: int | None = Field(None, description="O.S. de origem (opcional)")
    os_number: str = Field("", max_length=100)
    plate: str = Field("", max_length=30)
    customer_name: str = Field("", max_length=200)
    model: str = Field("", max_length=100)
    color: str = Field("", max_length=50)
    invoice_number: str = Field("", max_length=100)
    chassi: str = Field("", max_length=50)
    service_name: str = Field(DEFAULT_SERVICE, max_length=100)
    warranty_months: int = Field(DEFAULT_WARRANTY_MONTHS, ge=1, le=120)
    issue_date: date | None = Field(None, description="Data de emissão (default: hoje)")
    signed_photo_url: str | None = Field(
        None, max_length=500, description="Foto do certificado assinado pelo cliente"
    )


class CertificateUpdate(BaseModel):
    """Atualização de certificado — todos os campos são opcionais."""

    brand_code: str | None = Field(None, min_length=1, max_length=30)
    brand_name: str | None = Field(None, max_length=100)
    store_id: int | None = None
    service_order_id: int | None = None
    os_number: str | None = Field(None, max_length=100)
    plate: str | None = Field(None, max_length=30)
    customer_name: str | None = Field(None, max_length=200)
    model: str | None = Field(None, max_length=100)
    color: str | None = Field(None, max_length=50)
    invoice_number: str | None = Field(None, max_length=100)
    chassi: str | None = Field(None, max_length=50)
    service_name: str | None = Field(None, max_length=100)
    warranty_months: int | None = Field(None, ge=1, le=120)
    issue_date: date | None = None
    signed_photo_url: str | None = Field(None, max_length=500)


class CertificateResponse(BaseModel):
    """Certificado salvo — item da lista e do preview."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    created_by_id: int | None = None
    created_by_name: str | None = None
    service_order_id: int | None = None
    os_number: str | None = None
    brand_code: str
    brand_name: str | None = None
    store_id: int | None = None
    store_name: str | None = None
    store_address: str | None = None
    plate: str | None = None
    customer_name: str | None = None
    model: str | None = None
    color: str | None = None
    invoice_number: str | None = None
    chassi: str | None = None
    service_name: str
    warranty_months: int
    issue_date: date
    signed_photo_url: str | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def valid_until(self) -> date:
        """Data-limite da garantia (emissão + meses)."""
        return _add_months(self.issue_date, self.warranty_months or 0)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def warranty_status(self) -> str:
        """``vigente`` enquanto hoje <= validade; senão ``vencida``."""
        return "vigente" if date.today() <= self.valid_until else "vencida"


class CertificateListResponse(BaseModel):
    """Resposta paginada do histórico de certificados emitidos."""

    items: list[CertificateResponse]
    pagination: PaginationMeta
