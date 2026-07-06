"""
Push notification providers — interface + Expo implementation.

Decisao arquitetural: toda a logica de envio passa pela ABC `PushProvider`.
Isso torna a troca de provedor (Expo → FCM/APNs direto, ou outro) transparente
para a task Celery e para qualquer call-site futuro: basta trocar a factory
`get_push_provider()` sem tocar em `tasks.py` nem nos modulos de negocio.
"""

import logging
from abc import ABC, abstractmethod

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


class PushProvider(ABC):
    """
    Interface para envio de push notifications.

    Implementacoes: `ExpoPushProvider` (atual).
    Futuro: `FcmApnsPushProvider` para envio direto sem passar pela Expo.
    """

    @abstractmethod
    async def send(
        self,
        tokens: list[str],
        title: str,
        body: str,
        data: dict | None = None,
    ) -> list[str]:
        """
        Envia uma notificacao push para a lista de tokens.

        Args:
            tokens: Lista de tokens de dispositivo (ExponentPushToken[...] para Expo).
            title: Titulo da notificacao.
            body: Corpo/mensagem da notificacao.
            data: Payload extra (deep link, notification_id, etc.).

        Returns:
            Lista de tokens **invalidos** que devem ser removidos do banco
            (ex.: `DeviceNotRegistered`).

        Raises:
            httpx.TransportError | httpx.TimeoutException: Falha de rede transitoria.
                A task Celery e responsavel por fazer retry nesses casos.
        """


class ExpoPushProvider(PushProvider):
    """
    Provedor de push via Expo Push API (https://exp.host/--/api/v2/push/send).

    A Expo aceita um array de mensagens por requisicao (envio em lote).
    Cada mensagem pode ter `to` como string ou lista; aqui usamos um objeto
    por token para facilitar o mapeamento ticket → token no parse da resposta.

    Referencia: https://docs.expo.dev/push-notifications/sending-notifications/
    """

    async def send(
        self,
        tokens: list[str],
        title: str,
        body: str,
        data: dict | None = None,
    ) -> list[str]:
        """
        Envia notificacoes em lote para a Expo Push API.

        Retorna a lista de tokens com erro `DeviceNotRegistered` — esses tokens
        devem ser apagados do banco para evitar envios futuros desnecessarios.
        """
        if not tokens:
            return []

        settings = get_settings()

        messages = [
            {
                "to": token,
                "title": title,
                "body": body,
                "sound": "default",
                **({"data": data} if data else {}),
            }
            for token in tokens
        ]

        headers: dict[str, str] = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if settings.EXPO_ACCESS_TOKEN:
            headers["Authorization"] = f"Bearer {settings.EXPO_ACCESS_TOKEN}"

        async with httpx.AsyncClient(timeout=15.0) as client:
            # Pode levantar httpx.TransportError ou httpx.TimeoutException —
            # deixamos propagar para a task Celery decidir retry.
            response = await client.post(
                settings.EXPO_PUSH_URL,
                json=messages,
                headers=headers,
            )
            response.raise_for_status()

        payload = response.json()
        tickets = payload.get("data", [])

        invalid_tokens: list[str] = []
        for idx, ticket in enumerate(tickets):
            if ticket.get("status") == "error":
                details = ticket.get("details", {})
                if details.get("error") == "DeviceNotRegistered":
                    if idx < len(tokens):
                        invalid_tokens.append(tokens[idx])
                        logger.debug("Token invalido (DeviceNotRegistered): %s", tokens[idx])
                else:
                    logger.warning(
                        "Expo push error for token %s: %s",
                        tokens[idx] if idx < len(tokens) else "unknown",
                        ticket,
                    )

        logger.info(
            "Expo push: %d enviados, %d invalidos",
            len(tokens),
            len(invalid_tokens),
        )
        return invalid_tokens


def get_push_provider() -> PushProvider:
    """
    Factory que retorna o provedor de push ativo.

    Ponto unico de troca futura: para migrar para FCM/APNs direto, basta
    retornar `FcmApnsPushProvider()` aqui sem alterar tasks.py nem call sites.
    """
    return ExpoPushProvider()
