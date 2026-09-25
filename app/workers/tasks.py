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

    STUB INTENCIONAL (não remover). Ponto de extensão declarado para um canal
    genérico de notificações (sms/etc.); hoje sem callers — os canais reais em
    uso são send_transactional_email, send_push_notification e send_web_push.
    Mantido de propósito para expansão futura (ver CLAUDE.md — "Celery + Redis").

    Args:
        channel: Notification channel (email, push, sms)
        recipient: Recipient identifier (email, device token, phone)
        template: Notification template name
        data: Template data payload
    """
    logger.info(f"Sending {channel} notification to {recipient}")
    return None


@celery_app.task(bind=True, max_retries=3)
def send_transactional_email(self, to: str, subject: str, html: str, text: str | None = None):
    """
    Envia um e-mail transacional (reset de senha, boas-vindas) via SendGrid.

    Executado fora da request (fila Celery). Sem SENDGRID_API_KEY o envio é no-op
    (ver app.core.email.send_email). Falha de rede/SendGrid dispara retry (até 3x).
    """
    from app.core.email import send_email

    try:
        send_email(to=to, subject=subject, html=html, text=text)
    except Exception as exc:
        logger.error("Falha ao enviar e-mail para %s: %s", to, str(exc))
        raise self.retry(exc=exc, countdown=60) from exc


@celery_app.task(bind=True, max_retries=3)
def generate_report(self, report_type: str, filters: dict, user_email: str):
    """
    Generates a background report and emails it to the user.

    STUB INTENCIONAL (não remover). Reservado para relatórios assíncronos
    pesados enviados por e-mail; hoje sem callers (os exports atuais são
    síncronos, via StreamingResponse/Excel nos routers). Mantido de propósito
    para expansão futura (ver CLAUDE.md — "Tasks de relatório assíncrono").

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


@celery_app.task(bind=True, max_retries=3)
def send_web_push(
    self,
    user_id: int,
    title: str,
    body: str,
    data: dict | None = None,
):
    """
    Envia Web Push (VAPID) para todas as assinaturas de navegador do usuario.

    Espelha send_push_notification: subscriptions expiradas (404/410) sao
    removidas do banco; falha transitoria dispara retry.
    """
    from app.config import get_settings

    settings = get_settings()
    if not settings.WEB_PUSH_ENABLED or not settings.VAPID_PRIVATE_KEY:
        logger.debug("Web push desabilitado — envio ignorado para user_id=%s", user_id)
        return

    async def _send():
        from sqlalchemy import delete, select
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        import app.db.registry  # noqa: F401
        from app.modules.push.models import WebPushSubscription
        from app.modules.push.providers import WebPushProvider

        engine = create_async_engine(settings.DATABASE_URL)
        async_session = async_sessionmaker(engine, expire_on_commit=False)

        try:
            async with async_session() as session:
                result = await session.execute(
                    select(WebPushSubscription).where(WebPushSubscription.user_id == user_id)
                )
                subscriptions = [
                    {
                        "endpoint": s.endpoint,
                        "keys": {"p256dh": s.p256dh, "auth": s.auth},
                    }
                    for s in result.scalars().all()
                ]

                if not subscriptions:
                    logger.debug("Nenhuma web subscription para user_id=%s", user_id)
                    return

                provider = WebPushProvider()
                invalid = await asyncio.to_thread(
                    provider.send_sync, subscriptions, title, body, data
                )

                if invalid:
                    await session.execute(
                        delete(WebPushSubscription).where(WebPushSubscription.endpoint.in_(invalid))
                    )
                    await session.commit()
                    logger.info(
                        "Removidas %d web subscriptions invalidas (user_id=%s)",
                        len(invalid),
                        user_id,
                    )
        finally:
            await engine.dispose()

    try:
        run_async(_send())
    except Exception as exc:
        logger.error("Falha ao enviar web push para user_id=%s: %s", user_id, str(exc))
        raise self.retry(exc=exc, countdown=60) from exc


@celery_app.task(bind=True, max_retries=1)
def send_time_clock_reminders(self):
    """
    Lembretes de ponto (beat: a cada 5 minutos).

    Para cada funcionario vinculado e ativo cujo horario de entrada/saida
    (configurado ou default 08:00/18:00) caiu na janela [horario, horario+30min]
    e que ainda nao bateu o ponto correspondente hoje: envia notificacao
    (in-app + WebSocket + push Expo + Web Push via create_notification).

    Idempotencia: time_clock_reminders_sent UNIQUE(employee, date, type) —
    a task insere primeiro (savepoint) e so notifica quando a insercao vale.
    """
    from datetime import datetime as dt

    from app.config import get_settings

    settings = get_settings()
    if not settings.TIME_CLOCK_ENABLED:
        return {"reminders_sent": 0, "disabled": True}

    async def _run() -> int:
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        import app.db.registry  # noqa: F401
        from app.modules.time_clock.service import TZ_LOCAL, process_reminders

        engine = create_async_engine(settings.DATABASE_URL)
        async_session = async_sessionmaker(engine, expire_on_commit=False)

        try:
            async with async_session() as session:
                sent = await process_reminders(session, dt.now(TZ_LOCAL))
                await session.commit()
                return sent
        finally:
            await engine.dispose()

    try:
        sent = run_async(_run())
        if sent:
            logger.info("Lembretes de ponto enviados: %d", sent)
        return {"reminders_sent": sent}
    except Exception as exc:
        logger.error("Falha na task de lembretes de ponto: %s", str(exc))
        raise self.retry(exc=exc, countdown=120) from exc


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
