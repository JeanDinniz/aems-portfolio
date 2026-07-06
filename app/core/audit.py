"""
Audit logging module - AuditLog model and log_audit helper.

Registra acoes sensiveis do sistema como alteracoes de role, ativacao/desativacao
de usuarios, aprovacoes/rejeicoes de compras, etc.
"""

import logging
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import Request
from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

logger = logging.getLogger(__name__)


class AuditLog(Base):
    """
    Log de auditoria para acoes sensiveis do sistema.

    Registra quem fez o que, quando, em qual recurso e qual foi a mudanca.
    Diferente do AccessLog (login/logout), o AuditLog cobre acoes de negocio
    como alteracoes de role, aprovacoes de compra, ativacao/desativacao de usuarios.
    """

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Quem realizou a acao (nullable para acoes de sistema)
    user_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Qual acao foi realizada (ex: "role_changed", "user_deactivated", "purchase_approved")
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)

    # Tipo de recurso afetado (ex: "user", "purchase_request", "service_order")
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    # ID do recurso afetado (nullable para acoes que nao tem recurso especifico)
    resource_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Estado anterior do recurso (snapshot parcial ou completo)
    old_value: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Novo estado do recurso apos a acao
    new_value: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Contexto da requisicao HTTP
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relacionamento com o usuario que realizou a acao
    user: Mapped["User"] = relationship("User")  # noqa: F821

    __table_args__ = (
        # Indice composto para consultas por tipo de recurso + acao (relatorios de auditoria)
        Index("ix_audit_logs_resource_type_action", "resource_type", "action"),
        # Indice composto para consultas por usuario ao longo do tempo
        Index("ix_audit_logs_user_created", "user_id", "created_at"),
    )

    def __repr__(self) -> str:
        return (
            f"<AuditLog action={self.action!r} "
            f"resource={self.resource_type}:{self.resource_id} "
            f"user_id={self.user_id}>"
        )


def _make_json_safe(d: dict[str, Any] | None) -> dict[str, Any] | None:
    """Converte valores não-serializáveis em JSON para tipos primitivos."""
    if d is None:
        return None

    def _convert(v: Any) -> Any:
        if isinstance(v, (datetime, date, time)):
            return v.isoformat()
        if isinstance(v, Decimal):
            return float(v)
        if isinstance(v, UUID):
            return str(v)
        if isinstance(v, dict):
            return {k: _convert(val) for k, val in v.items()}
        if isinstance(v, list):
            return [_convert(item) for item in v]
        return v

    return {k: _convert(v) for k, v in d.items()}


def _extract_request_context(request: Request | None) -> tuple[str | None, str | None]:
    """
    Extrai IP e User-Agent de uma requisicao FastAPI.

    Considera headers de proxy como X-Forwarded-For e X-Real-IP para
    obter o IP real do cliente em ambientes com load balancer.

    Args:
        request: Objeto Request do FastAPI (opcional)

    Returns:
        Tuple (ip_address, user_agent) - ambos podem ser None
    """
    if request is None:
        return None, None

    # Tentar obter o IP real considerando proxies
    ip_address: str | None = None
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # X-Forwarded-For pode conter multiplos IPs: "client, proxy1, proxy2"
        ip_address = forwarded_for.split(",")[0].strip()
    else:
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            ip_address = real_ip.strip()
        elif request.client:
            ip_address = request.client.host

    user_agent = request.headers.get("User-Agent")
    # Truncar user-agent para evitar estouro do campo String(500)
    if user_agent and len(user_agent) > 500:
        user_agent = user_agent[:497] + "..."

    return ip_address, user_agent


async def log_audit(
    db: AsyncSession,
    action: str,
    resource_type: str,
    user_id: int | None = None,
    resource_id: int | None = None,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
    request: Request | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    """
    Registra uma entrada no audit log de forma assíncrona e segura.

    Esta funcao nunca lanca excecoes - erros sao registrados no log do sistema
    mas nao interrompem o fluxo principal da aplicacao.

    Args:
        db: Sessao assincrona do banco de dados
        action: Identificador da acao realizada (ex: "role_changed", "user_created")
        resource_type: Tipo do recurso afetado (ex: "user", "purchase_request")
        user_id: ID do usuario que realizou a acao (None para acoes de sistema)
        resource_id: ID do recurso afetado (None quando nao aplicavel)
        old_value: Dicionario com o estado anterior do recurso
        new_value: Dicionario com o novo estado do recurso
        request: Objeto Request do FastAPI para extrair IP e User-Agent

    Examples:
        >>> await log_audit(
        ...     db=db,
        ...     action="role_changed",
        ...     resource_type="user",
        ...     user_id=current_user.id,
        ...     resource_id=target_user.id,
        ...     old_value={"role": "operator"},
        ...     new_value={"role": "supervisor"},
        ...     request=request,
        ... )
    """
    try:
        extracted_ip, extracted_ua = _extract_request_context(request)
        # Parâmetros explícitos têm precedência sobre os extraídos do request
        ip_address = ip_address or extracted_ip
        user_agent = user_agent or extracted_ua

        entry = AuditLog(
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            old_value=_make_json_safe(old_value),
            new_value=_make_json_safe(new_value),
            ip_address=ip_address,
            user_agent=user_agent,
        )
        db.add(entry)
        # Flush sem commit para que o audit log participe da mesma transacao
        # da operacao de negocio quando possivel (o commit e feito pelo caller).
        # Se a sessao ja tiver sido commitada, usamos add + flush separado.
        await db.flush()
    except Exception:
        # Nunca deixar o audit log quebrar o fluxo de negocio
        logger.exception(
            "Falha ao registrar audit log: action=%s resource_type=%s resource_id=%s user_id=%s",
            action,
            resource_type,
            resource_id,
            user_id,
        )
