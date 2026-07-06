"""
Celery tasks for background processing.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


def run_async(coro: Any) -> Any:
    """Executa uma coroutine em um novo event loop (uso em tasks Celery síncronas)."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(bind=True, max_retries=3)
def send_notification(self, channel: str, recipient: str, template: str, data: dict):
    """
    Sends a notification via specified channel.

    Args:
        channel: Notification channel (email, push, sms)
        recipient: Recipient identifier (email, device token, phone)
        template: Notification template name
        data: Template data payload
    """
    logger.info(f"Sending {channel} notification to {recipient}")
    return None


@celery_app.task(bind=True, max_retries=3)
def generate_report(self, report_type: str, filters: dict, user_email: str):
    """
    Generates a background report and emails it to the user.

    Args:
        report_type: Type of report (service_orders, inventory, performance)
        filters: Report filter parameters
        user_email: Email to send the completed report to
    """
    logger.info(f"Generating {report_type} report for {user_email}")
    return None


@celery_app.task(bind=True, max_retries=3)
def send_push_notification(
    self,
    user_id: int,
    title: str,
    body: str,
    type_value: str,
    data: dict | None = None,
):
    """
    Envia push notifications para todos os devices registrados de um usuario.

    Args:
        user_id: ID do usuario destinatario.
        title: Titulo da notificacao.
        body: Corpo/mensagem da notificacao.
        type_value: Tipo da notificacao (string, ex: 'order_created').
        data: Payload adicional para deep link (ex: {'notification_id': 42}).

    Comportamento:
        - Se PUSH_ENABLED=False: no-op imediato.
        - Se usuario nao tem devices: no-op (log debug).
        - Tokens invalidos (DeviceNotRegistered) sao removidos do banco.
        - Falha de rede transitoria dispara retry (ate 3x, espera 60s).
    """
    from app.config import get_settings

    settings = get_settings()
    if not settings.PUSH_ENABLED:
        logger.debug("PUSH_ENABLED=False — envio ignorado para user_id=%s", user_id)
        return

    async def _send():
        from sqlalchemy import delete, select
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        import app.db.registry  # noqa: F401  — registra todos os mappers (worker standalone)
        from app.modules.push.models import PushDevice
        from app.modules.push.providers import get_push_provider

        engine = create_async_engine(settings.DATABASE_URL)
        async_session = async_sessionmaker(engine, expire_on_commit=False)

        try:
            async with async_session() as session:
                result = await session.execute(
                    select(PushDevice.token).where(PushDevice.user_id == user_id)
                )
                tokens = list(result.scalars().all())

                if not tokens:
                    logger.debug(
                        "Nenhum device registrado para user_id=%s — push ignorado", user_id
                    )
                    return

                # Monta payload final: inclui 'type' e qualquer dado extra
                final_data: dict = {"type": type_value}
                if data:
                    final_data.update(data)

                provider = get_push_provider()
                invalid_tokens = await provider.send(tokens, title, body, final_data)

                if invalid_tokens:
                    await session.execute(
                        delete(PushDevice).where(PushDevice.token.in_(invalid_tokens))
                    )
                    await session.commit()
                    logger.info(
                        "Removidos %d tokens invalidos para user_id=%s",
                        len(invalid_tokens),
                        user_id,
                    )
        finally:
            await engine.dispose()

    try:
        run_async(_send())
        logger.info("Push enviado para user_id=%s title=%r", user_id, title)
    except Exception as exc:
        logger.error("Falha ao enviar push para user_id=%s: %s", user_id, str(exc))
        raise self.retry(exc=exc, countdown=60) from exc


@celery_app.task(bind=True, max_retries=2)
def purge_old_audit_logs(self):
    """
    Remove AuditLog e AccessLog com mais de 1 ano.
    Agendado mensalmente via beat schedule.
    """
    from sqlalchemy import delete
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.config import get_settings
    from app.core.audit import AuditLog
    from app.modules.auth.models import AccessLog

    async def _purge():
        settings = get_settings()
        engine = create_async_engine(settings.DATABASE_URL)
        async_session = async_sessionmaker(engine, expire_on_commit=False)

        cutoff = datetime.now(UTC) - timedelta(days=365)

        async with async_session() as session:
            audit_result = await session.execute(
                delete(AuditLog).where(AuditLog.created_at < cutoff)
            )
            access_result = await session.execute(
                delete(AccessLog).where(AccessLog.created_at < cutoff)
            )
            await session.commit()

            deleted_audit = audit_result.rowcount
            deleted_access = access_result.rowcount

        await engine.dispose()
        return deleted_audit, deleted_access

    try:
        deleted_audit, deleted_access = run_async(_purge())
        logger.info(
            "Audit log purge complete: %d audit_logs, %d access_logs removed (older than 1 year)",
            deleted_audit,
            deleted_access,
        )
        return {"deleted_audit_logs": deleted_audit, "deleted_access_logs": deleted_access}
    except Exception as exc:
        logger.error("Audit log purge failed: %s", str(exc))
        raise self.retry(exc=exc, countdown=3600) from exc
