"""
E-mail transacional via SendGrid.

Cliente fino e síncrono (o SDK do SendGrid é síncrono). É chamado a partir de
uma task Celery (`app.workers.tasks.send_transactional_email`), nunca direto na
request, para não bloquear o handler.

Guarda no-op: sem `SENDGRID_API_KEY` configurada (dev/testes/CI), apenas loga e
retorna — nada é enviado e nada quebra.
"""

import logging

from app.config import get_settings

logger = logging.getLogger(__name__)


def send_email(to: str, subject: str, html: str, text: str | None = None) -> bool:
    """
    Envia um e-mail via SendGrid.

    Args:
        to: destinatário.
        subject: assunto.
        html: corpo em HTML.
        text: corpo em texto puro (fallback). Recomenda-se sempre passar um
            texto de fallback junto do HTML.

    Returns:
        True se o SendGrid aceitou (2xx); False se desabilitado (sem API key).

    Raises:
        Exception: erros de rede/SendGrid são propagados para a task Celery
            tratar o retry.
    """
    settings = get_settings()

    if not settings.SENDGRID_API_KEY:
        logger.warning(
            "SENDGRID_API_KEY não configurada — e-mail para %r NÃO enviado (assunto=%r)",
            to,
            subject,
        )
        return False

    # Import tardio: mantém o SDK fora do caminho de import quando o envio está
    # desabilitado e evita custo em processos que não enviam e-mail.
    from sendgrid import SendGridAPIClient
    from sendgrid.helpers.mail import Content, Email, Mail, To

    message = Mail(
        from_email=Email(settings.FROM_EMAIL),
        to_emails=To(to),
        subject=subject,
    )
    if text:
        message.add_content(Content("text/plain", text))
    message.add_content(Content("text/html", html))

    client = SendGridAPIClient(settings.SENDGRID_API_KEY)
    response = client.send(message)

    status = response.status_code
    if status >= 400:
        # Deixa a task Celery decidir sobre retry.
        raise RuntimeError(f"SendGrid retornou status {status} ao enviar para {to}")

    logger.info("E-mail enviado para %r (assunto=%r, status=%s)", to, subject, status)
    return True
