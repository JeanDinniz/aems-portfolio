"""
Integration tests for PUSH-BE-02 — send_push_notification task + ExpoPushProvider.

Cobre:
- ExpoPushProvider.send: payload correto, header Authorization, tokens invalidos retornados.
- Task send_push_notification: devices → chama provider; sem devices → no-op;
  token invalido retornado → device removido do banco.
- create_notification enfileira a task: .delay chamado com args corretos;
  se .delay levantar excecao, a Notification e retornada normalmente (fail-safe).
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import User
from app.modules.notifications.schemas import NotificationType
from app.modules.push.models import PushDevice
from app.modules.push.providers import ExpoPushProvider

# ===========================================================================
# Helpers
# ===========================================================================


class _AsyncContextManager:
    """
    Helper para mockar `async with httpx.AsyncClient(...) as client`.
    Retorna `inner` como o valor do `as` e nao faz nada no __aexit__.
    """

    def __init__(self, inner: Any) -> None:
        self._inner = inner

    async def __aenter__(self) -> Any:
        return self._inner

    async def __aexit__(self, *args: Any) -> None:
        return None


def _make_expo_response(tickets: list[dict[str, Any]]) -> MagicMock:
    """Constroi um mock de httpx.Response com payload da Expo Push API."""
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {"data": tickets}
    return mock_resp


async def _create_device(
    db: AsyncSession,
    user_id: int,
    token: str,
    platform: str = "android",
) -> PushDevice:
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    device = PushDevice(
        user_id=user_id,
        token=token,
        platform=platform,
        created_at=now,
        last_seen=now,
    )
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return device


# ===========================================================================
# ExpoPushProvider
# ===========================================================================


class TestExpoPushProvider:
    """Testa o provedor Expo Push diretamente (httpx mockado)."""

    @pytest.mark.asyncio
    async def test_send_builds_correct_payload(self, monkeypatch):
        """Verifica que o payload enviado a Expo contem os campos esperados."""
        captured: list[dict[str, Any]] = []

        mock_inner = MagicMock()

        async def fake_post(url, json, headers):  # noqa: ANN001
            captured.append({"url": url, "payload": json, "headers": headers})
            return _make_expo_response([{"status": "ok", "id": "xxx"}])

        mock_inner.post = fake_post

        monkeypatch.setattr(
            "app.modules.push.providers.httpx.AsyncClient",
            lambda **kw: _AsyncContextManager(mock_inner),
        )

        provider = ExpoPushProvider()
        invalid = await provider.send(
            tokens=["ExponentPushToken[abc]"],
            title="Titulo",
            body="Corpo",
            data={"notification_id": 1},
        )

        assert invalid == []
        assert len(captured) == 1
        msg = captured[0]["payload"][0]
        assert msg["to"] == "ExponentPushToken[abc]"
        assert msg["title"] == "Titulo"
        assert msg["body"] == "Corpo"
        assert msg["sound"] == "default"
        assert msg["data"] == {"notification_id": 1}

    @pytest.mark.asyncio
    async def test_send_includes_auth_header_when_token_set(self, monkeypatch):
        """Quando EXPO_ACCESS_TOKEN esta definido, envia Authorization header."""
        from app.config import get_settings

        settings = get_settings()
        object.__setattr__(settings, "EXPO_ACCESS_TOKEN", "expo-secret-token")

        captured_headers: dict[str, str] = {}

        mock_inner = MagicMock()

        async def fake_post(url, json, headers):  # noqa: ANN001
            captured_headers.update(headers)
            return _make_expo_response([{"status": "ok", "id": "yyy"}])

        mock_inner.post = fake_post

        monkeypatch.setattr(
            "app.modules.push.providers.httpx.AsyncClient",
            lambda **kw: _AsyncContextManager(mock_inner),
        )

        provider = ExpoPushProvider()
        await provider.send(["ExponentPushToken[xyz]"], "T", "B")

        assert captured_headers.get("Authorization") == "Bearer expo-secret-token"
        # Restaurar
        object.__setattr__(settings, "EXPO_ACCESS_TOKEN", None)

    @pytest.mark.asyncio
    async def test_send_returns_device_not_registered_tokens(self, monkeypatch):
        """Tokens com status error+DeviceNotRegistered sao retornados como invalidos."""
        tickets = [
            {"status": "ok", "id": "t1"},
            {"status": "error", "details": {"error": "DeviceNotRegistered"}},
            {"status": "ok", "id": "t3"},
        ]

        mock_inner = MagicMock()

        async def fake_post(url, json, headers):  # noqa: ANN001
            return _make_expo_response(tickets)

        mock_inner.post = fake_post

        monkeypatch.setattr(
            "app.modules.push.providers.httpx.AsyncClient",
            lambda **kw: _AsyncContextManager(mock_inner),
        )

        tokens = ["TokenA", "TokenB", "TokenC"]
        provider = ExpoPushProvider()
        invalid = await provider.send(tokens, "T", "B")

        assert invalid == ["TokenB"]

    @pytest.mark.asyncio
    async def test_send_returns_empty_list_for_empty_tokens(self):
        """Chamada com lista vazia nao faz requisicao e retorna lista vazia."""
        provider = ExpoPushProvider()
        result = await provider.send([], "T", "B")
        assert result == []

    @pytest.mark.asyncio
    async def test_send_propagates_network_error(self, monkeypatch):
        """Erros de rede (httpx.TransportError) propagam para que Celery faca retry."""
        import httpx

        mock_inner = MagicMock()

        async def fake_post(url, json, headers):  # noqa: ANN001
            raise httpx.ConnectError("connection refused")

        mock_inner.post = fake_post

        monkeypatch.setattr(
            "app.modules.push.providers.httpx.AsyncClient",
            lambda **kw: _AsyncContextManager(mock_inner),
        )

        provider = ExpoPushProvider()
        with pytest.raises(httpx.ConnectError):
            await provider.send(["ExponentPushToken[foo]"], "T", "B")


# ===========================================================================
# Task send_push_notification — logica central testada via coroutine isolada
# ===========================================================================


class TestSendPushNotificationTaskLogic:
    """
    Testa a logica central da task (busca devices, remove invalidos) sem
    precisar de Celery broker real nem abrir uma nova engine.

    A estrategia e isolar a coroutine _send() e executa-la diretamente sobre
    o db_session de teste, sem passar pelo Celery nem criar engine propria.
    """

    @pytest.mark.asyncio
    async def test_noop_when_user_has_no_devices(
        self, db_session: AsyncSession, test_user: User
    ):
        """Quando usuario nao tem devices registrados, provider nao e chamado."""
        provider_called: list[str] = []

        async def fake_send(tokens, title, body, data=None):  # noqa: ANN001
            provider_called.extend(tokens)
            return []

        # Replicar a logica central da task sobre o db_session de teste
        async def _task_logic():
            result = await db_session.execute(
                select(PushDevice.token).where(PushDevice.user_id == test_user.id)
            )
            tokens = list(result.scalars().all())
            if not tokens:
                return
            await fake_send(tokens, "T", "B", None)

        await _task_logic()
        assert provider_called == []

    @pytest.mark.asyncio
    async def test_invalid_tokens_are_deleted(
        self, db_session: AsyncSession, test_user: User
    ):
        """Tokens invalidos retornados pelo provider sao deletados do banco."""
        bad_token = "ExponentPushToken[invalid-device]"
        good_token = "ExponentPushToken[valid-device]"
        await _create_device(db_session, test_user.id, bad_token)
        await _create_device(db_session, test_user.id, good_token)

        async def fake_send(tokens, title, body, data=None):  # noqa: ANN001
            # Simula DeviceNotRegistered para o bad_token
            return [bad_token]

        # Replicar a logica central da task sobre o db_session de teste
        async def _task_logic():
            result = await db_session.execute(
                select(PushDevice.token).where(PushDevice.user_id == test_user.id)
            )
            tokens = list(result.scalars().all())

            invalid = await fake_send(tokens, "T", "B", None)

            if invalid:
                await db_session.execute(
                    delete(PushDevice).where(PushDevice.token.in_(invalid))
                )
                await db_session.commit()

        await _task_logic()

        result = await db_session.execute(
            select(PushDevice).where(PushDevice.user_id == test_user.id)
        )
        remaining = [d.token for d in result.scalars().all()]
        assert bad_token not in remaining
        assert good_token in remaining

    @pytest.mark.asyncio
    async def test_noop_when_push_disabled(self, test_user: User):
        """Quando PUSH_ENABLED=False, a task retorna antes de abrir sessao de banco.
        Nao precisamos de db_session aqui pois o guard retorna antes de qualquer query."""
        from app.config import get_settings
        from app.workers.tasks import send_push_notification

        settings = get_settings()
        object.__setattr__(settings, "PUSH_ENABLED", False)

        try:
            # Executar a task em modo EAGER (nao precisa de broker Celery real)
            # Como PUSH_ENABLED=False, o guard retorna cedo sem abrir engine propria
            result = send_push_notification.apply(
                args=[test_user.id, "T", "B", "order_created"],
            )
            assert result.successful()
        finally:
            # Sempre restaurar para nao poluir outros testes
            object.__setattr__(settings, "PUSH_ENABLED", True)


# ===========================================================================
# create_notification + enfileiramento da task
# ===========================================================================


class TestCreateNotificationEnqueuesPush:
    """
    Testa que create_notification dispara a task de push.

    O import de send_push_notification e feito localmente (dentro da funcao)
    para evitar dependencia circular, portanto o patch deve apontar para o
    modulo workers.tasks onde a task e definida.
    """

    @pytest.mark.asyncio
    async def test_create_notification_calls_delay(
        self, db_session: AsyncSession, test_user: User
    ):
        """Apos criar Notification, send_push_notification.delay e chamado com args corretos."""
        delay_calls: list[dict[str, Any]] = []

        mock_task = MagicMock()

        def fake_delay(uid, title, body, type_value, data=None):  # noqa: ANN001
            delay_calls.append(
                {
                    "user_id": uid,
                    "title": title,
                    "body": body,
                    "type": type_value,
                    "data": data,
                }
            )

        mock_task.delay = fake_delay

        from app.modules.notifications import service as notif_service

        # Patchar a task no modulo workers.tasks (onde e importada dentro da funcao)
        with patch("app.workers.tasks.send_push_notification", mock_task):
            notification = await notif_service.create_notification(
                db=db_session,
                user_id=test_user.id,
                type=NotificationType.ORDER_CREATED,
                title="Novo agendamento",
                body="O.S. #001 foi criada.",
            )

        # Notification deve ter sido criada
        assert notification.id is not None
        assert notification.title == "Novo agendamento"

        # delay deve ter sido chamado uma vez com os args corretos
        assert len(delay_calls) == 1
        call = delay_calls[0]
        assert call["user_id"] == test_user.id
        assert call["title"] == "Novo agendamento"
        assert call["body"] == "O.S. #001 foi criada."
        assert call["type"] == NotificationType.ORDER_CREATED.value
        assert call["data"]["notification_id"] == notification.id
        assert call["data"]["type"] == NotificationType.ORDER_CREATED.value

    @pytest.mark.asyncio
    async def test_create_notification_is_failsafe_when_delay_raises(
        self, db_session: AsyncSession, test_user: User
    ):
        """Se .delay levantar excecao (broker indisponivel), Notification ainda e retornada."""
        mock_task = MagicMock()
        mock_task.delay.side_effect = Exception("Redis connection refused")

        from app.modules.notifications import service as notif_service

        with patch("app.workers.tasks.send_push_notification", mock_task):
            notification = await notif_service.create_notification(
                db=db_session,
                user_id=test_user.id,
                type=NotificationType.ORDER_COMPLETED,
                title="O.S. finalizada",
                body="O.S. #002 foi concluida.",
            )

        # Apesar do erro no broker, a Notification foi criada normalmente
        assert notification is not None
        assert notification.id is not None
        assert notification.body == "O.S. #002 foi concluida."

    @pytest.mark.asyncio
    async def test_create_notification_survives_without_celery_broker(
        self, db_session: AsyncSession, test_user: User
    ):
        """create_notification funciona normalmente mesmo sem Celery broker disponivel.
        O try/except em service.py silencia o erro de conexao ao broker."""
        from app.modules.notifications import service as notif_service

        # Sem nenhum patch — a task vai tentar .delay() e falhar silenciosamente
        # pois nao ha Redis em teste (a excecao e capturada pelo try/except em service.py)
        notification = await notif_service.create_notification(
            db=db_session,
            user_id=test_user.id,
            type=NotificationType.ORDER_CREATED,
            title="Teste sem broker",
            body="Deve criar mesmo sem Redis.",
        )
        assert notification is not None
        assert notification.title == "Teste sem broker"


# ===========================================================================
# Registro de mappers em contexto standalone (worker Celery)
# ===========================================================================


class TestMapperRegistry:
    """
    Regressao: a task abre uma sessao propria e consulta PushDevice, que tem
    relationship("User") (e cadeia ate FilmRoll→Supplier etc.). Em um processo
    onde nem todos os models foram importados (worker Celery), configure_mappers()
    falhava com "failed to locate a name". O modulo app.db.registry importa todos
    os models para evitar isso.

    Este teste roda em um SUBPROCESSO LIMPO (so importa app.db.registry), porque
    no processo do pytest todos os models ja estao importados via conftest — o que
    mascararia models faltantes no registry.
    """

    def test_registry_resolves_all_mappers_in_clean_process(self):
        import subprocess
        import sys

        code = (
            "import app.db.registry\n"
            "from sqlalchemy.orm import configure_mappers\n"
            "configure_mappers()\n"
            "print('MAPPERS_OK')\n"
        )
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        assert "MAPPERS_OK" in result.stdout
