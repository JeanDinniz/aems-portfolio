"""
Integration tests for WebSocket endpoints.

Note: Due to async session limitations with synchronous WebSocket testing,
these tests focus on authentication/authorization logic and the /ws/status endpoint.
Full WebSocket connection behavior is validated through the manager unit tests.
"""

import pytest
from httpx import AsyncClient

from app.core.security import create_access_token
from app.modules.auth.models import User
from app.modules.stores.models import Store
from app.websocket.manager import manager as ws_manager


class TestWebSocketStatus:
    """Tests for /ws/status endpoint."""

    @pytest.mark.asyncio
    async def test_websocket_status_no_connections(self, authenticated_client: AsyncClient):
        """Status endpoint should show zero connections when none connected."""
        # Clear any existing connections
        ws_manager.active_connections.clear()

        response = await authenticated_client.get("/ws/status")
        assert response.status_code == 200

        data = response.json()
        assert data["total_connections"] == 0
        assert data["connections_by_store"] == {}

    @pytest.mark.asyncio
    async def test_websocket_status_structure(self, authenticated_client: AsyncClient):
        """Status endpoint should return correct structure."""
        response = await authenticated_client.get("/ws/status")
        assert response.status_code == 200

        data = response.json()
        assert "total_connections" in data
        assert "connections_by_store" in data
        assert isinstance(data["total_connections"], int)
        assert isinstance(data["connections_by_store"], dict)

    @pytest.mark.asyncio
    async def test_websocket_status_with_mock_connections(self, authenticated_client: AsyncClient):
        """Status should reflect mocked active connections."""
        # Clear and add mock connections
        ws_manager.active_connections.clear()

        # Mock some connections (we use None as placeholder since we're not testing actual WS)
        ws_manager.active_connections[1] = {object(), object()}  # Store 1 has 2 connections
        ws_manager.active_connections[2] = {object()}  # Store 2 has 1 connection

        response = await authenticated_client.get("/ws/status")
        assert response.status_code == 200

        data = response.json()
        assert data["total_connections"] == 3
        assert "1" in data["connections_by_store"]
        assert "2" in data["connections_by_store"]
        assert data["connections_by_store"]["1"] == 2
        assert data["connections_by_store"]["2"] == 1

        # Clean up
        ws_manager.active_connections.clear()


class TestWebSocketPermissions:
    """Tests for WebSocket permission and authentication logic."""

    @pytest.mark.asyncio
    async def test_user_can_access_store_operator_own_store(
        self, test_user: User, test_store: Store
    ):
        """User should have access to their own store."""
        from app.websocket.router import user_can_access_store

        assert test_user.role == "user"
        assert test_user.store_id == test_store.id

        can_access = await user_can_access_store(test_user, test_store.id)
        assert can_access is True

    @pytest.mark.asyncio
    async def test_user_can_access_store_operator_different_store(
        self, test_user: User, second_store: Store
    ):
        """User should not have access to a different store."""
        from app.websocket.router import user_can_access_store

        assert test_user.role == "user"
        assert test_user.store_id != second_store.id

        can_access = await user_can_access_store(test_user, second_store.id)
        assert can_access is False

    @pytest.mark.asyncio
    async def test_user_can_access_store_owner_any_store(
        self, test_owner: User, test_store: Store, second_store: Store
    ):
        """Owner should have access to any store."""
        from app.websocket.router import user_can_access_store

        assert test_owner.role == "owner"

        # Owner can access any store
        can_access_1 = await user_can_access_store(test_owner, test_store.id)
        can_access_2 = await user_can_access_store(test_owner, second_store.id)

        assert can_access_1 is True
        assert can_access_2 is True

    @pytest.mark.asyncio
    async def test_user_can_access_store_supervisor_own_store(
        self, test_user: User, test_store: Store, db_session
    ):
        """User should have access to their own store (supervisor role removed)."""
        from app.websocket.router import user_can_access_store

        assert test_user.store_id == test_store.id

        can_access = await user_can_access_store(test_user, test_store.id)
        assert can_access is True

    @pytest.mark.asyncio
    async def test_user_can_access_store_supervisor_different_store(
        self, test_user: User, second_store: Store, db_session
    ):
        """User should not access a store they don't belong to (supervisor role removed)."""
        from app.websocket.router import user_can_access_store

        assert test_user.store_id != second_store.id

        can_access = await user_can_access_store(test_user, second_store.id)
        assert can_access is False

    @pytest.mark.asyncio
    async def test_verify_websocket_token_valid(self, test_user: User):
        """Valid access token should be verified successfully."""
        from app.websocket.router import verify_websocket_token

        token, _ = create_access_token({"sub": str(test_user.id)})
        payload = await verify_websocket_token(token)

        assert payload is not None
        assert payload["sub"] == str(test_user.id)
        assert payload["type"] == "access"

    @pytest.mark.asyncio
    async def test_verify_websocket_token_invalid(self):
        """Invalid token should fail verification."""
        from app.websocket.router import verify_websocket_token

        payload = await verify_websocket_token("invalid.token.here")
        assert payload is None

    @pytest.mark.asyncio
    async def test_verify_websocket_token_refresh_type(self, test_user: User):
        """Refresh token should fail verification (wrong type)."""
        from app.core.security import create_refresh_token
        from app.websocket.router import verify_websocket_token

        refresh_token, _ = create_refresh_token({"sub": str(test_user.id)})
        payload = await verify_websocket_token(refresh_token)

        # Should return None because type is not "access"
        assert payload is None

    @pytest.mark.asyncio
    async def test_verify_websocket_token_expired(self, test_user: User):
        """Expired token should fail verification."""
        from datetime import timedelta

        from app.websocket.router import verify_websocket_token

        expired_token, _ = create_access_token(
            {"sub": str(test_user.id)}, expires_delta=timedelta(seconds=-1)
        )
        payload = await verify_websocket_token(expired_token)
        assert payload is None

    @pytest.mark.asyncio
    async def test_user_can_access_store_unknown_role(self, test_user: User, test_store: Store):
        """Unknown role should be denied access."""
        from app.websocket.router import user_can_access_store

        # Temporarily change user role to something unknown
        original_role = test_user.role
        test_user.role = "unknown_role"
        can_access = await user_can_access_store(test_user, test_store.id)
        assert can_access is False
        test_user.role = original_role

    @pytest.mark.asyncio
    async def test_profile_store_grants_ws_access_without_direct_store_id(
        self, db_session, test_user: User, test_store: Store
    ):
        """
        Usuário de perfil (users.store_id NULL) conecta ao canal da loja DO PERFIL.
        Sem isso o WS recusava com 4003 e o frontend ficava em loop de reconexão.
        """
        from app.modules.access_profiles.models import AccessProfile
        from app.websocket.router import user_can_access_store

        profile = AccessProfile(name="Perfil WS Loja", is_active=True)
        profile.stores.append(test_store)
        db_session.add(profile)
        test_user.role = "user"
        test_user.store_id = None
        test_user.access_profiles.append(profile)
        await db_session.commit()
        await db_session.refresh(test_user)

        assert await user_can_access_store(test_user, test_store.id) is True
        assert await user_can_access_store(test_user, test_store.id + 999) is False


class TestGetUserFromToken:
    """Tests for get_user_from_token function."""

    @pytest.mark.asyncio
    async def test_valid_token_returns_user(self, test_user: User, db_session):
        """Valid access token should return the user."""
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.websocket.router import get_user_from_token

        token, _ = create_access_token({"sub": str(test_user.id)})

        # Mock AsyncSessionLocal to use our test db_session
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = test_user
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("app.websocket.router.AsyncSessionLocal", return_value=mock_session):
            user = await get_user_from_token(token)

        assert user is not None
        assert user.id == test_user.id

    @pytest.mark.asyncio
    async def test_invalid_token_returns_none(self):
        """Invalid token should return None."""
        from app.websocket.router import get_user_from_token

        user = await get_user_from_token("invalid-token")
        assert user is None

    @pytest.mark.asyncio
    async def test_no_sub_in_payload_returns_none(self):
        """Token without sub claim should return None."""
        from unittest.mock import AsyncMock, patch

        from app.websocket.router import get_user_from_token

        # Create a token without sub
        token, _ = create_access_token({})

        # verify_websocket_token will return payload without 'sub'
        with patch(
            "app.websocket.router.verify_websocket_token",
            new_callable=AsyncMock,
            return_value={"type": "access"},
        ):
            user = await get_user_from_token(token)
        assert user is None

    @pytest.mark.asyncio
    async def test_user_not_found_returns_none(self, test_user: User):
        """Token for nonexistent user should return None."""
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.websocket.router import get_user_from_token

        token, _ = create_access_token({"sub": "99999"})

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("app.websocket.router.AsyncSessionLocal", return_value=mock_session):
            user = await get_user_from_token(token)
        assert user is None


class TestWebSocketEndpoints:
    """Tests for WebSocket endpoint connections via mocked get_user_from_token."""

    @pytest.mark.asyncio
    async def test_ws_store_invalid_token(self, client: AsyncClient):
        """Token inválido → conexão ACEITA e fechada com code=4001 (não HTTP 403),
        para o navegador receber o código e o guard anti-loop parar a reconexão."""
        from unittest.mock import AsyncMock, patch

        from fastapi import WebSocketDisconnect
        from starlette.testclient import TestClient

        from app.main import app as fastapi_app

        with patch(
            "app.websocket.router.get_user_from_token",
            new_callable=AsyncMock,
            return_value=None,
        ):
            test_client = TestClient(fastapi_app)
            with pytest.raises(WebSocketDisconnect) as exc:
                with test_client.websocket_connect("/ws/1?token=bad") as ws:
                    ws.receive_text()
            assert exc.value.code == 4001

    @pytest.mark.asyncio
    async def test_ws_all_invalid_token(self, client: AsyncClient):
        """WebSocket /ws/all com token inválido → fechado com code=4001."""
        from unittest.mock import AsyncMock, patch

        from fastapi import WebSocketDisconnect
        from starlette.testclient import TestClient

        from app.main import app as fastapi_app

        with patch(
            "app.websocket.router.get_user_from_token",
            new_callable=AsyncMock,
            return_value=None,
        ):
            test_client = TestClient(fastapi_app)
            with pytest.raises(WebSocketDisconnect) as exc:
                with test_client.websocket_connect("/ws/all?token=bad") as ws:
                    ws.receive_text()
            assert exc.value.code == 4001

    @pytest.mark.asyncio
    async def test_ws_all_non_owner_rejected(self, test_user: User):
        """Não-owner rejeitado de /ws/all → fechado com code=4003 (não HTTP 403)."""
        from unittest.mock import AsyncMock, patch

        from fastapi import WebSocketDisconnect
        from starlette.testclient import TestClient

        from app.main import app as fastapi_app

        with patch(
            "app.websocket.router.get_user_from_token",
            new_callable=AsyncMock,
            return_value=test_user,
        ):
            test_client = TestClient(fastapi_app)
            with pytest.raises(WebSocketDisconnect) as exc:
                with test_client.websocket_connect("/ws/all?token=fake") as ws:
                    ws.receive_text()
            assert exc.value.code == 4003

    @pytest.mark.asyncio
    async def test_ws_store_access_denied(self, test_user: User, second_store: Store):
        """Usuário sem acesso à loja → fechado com code=4003 (não HTTP 403), para o
        cliente receber o código e PARAR de reconectar (bug do loop em /ws/<loja>)."""
        from unittest.mock import AsyncMock, patch

        from fastapi import WebSocketDisconnect
        from starlette.testclient import TestClient

        from app.main import app as fastapi_app

        with patch(
            "app.websocket.router.get_user_from_token",
            new_callable=AsyncMock,
            return_value=test_user,
        ):
            test_client = TestClient(fastapi_app)
            with pytest.raises(WebSocketDisconnect) as exc:
                with test_client.websocket_connect(f"/ws/{second_store.id}?token=fake") as ws:
                    ws.receive_text()
            assert exc.value.code == 4003

    @pytest.mark.asyncio
    async def test_ws_store_success_and_ping(self, test_user: User, test_store: Store):
        """Operator should connect to own store and handle ping/pong."""
        import json
        from unittest.mock import AsyncMock, patch

        from starlette.testclient import TestClient

        from app.main import app as fastapi_app

        with patch(
            "app.websocket.router.get_user_from_token",
            new_callable=AsyncMock,
            return_value=test_user,
        ):
            test_client = TestClient(fastapi_app)
            with test_client.websocket_connect(f"/ws/{test_store.id}?token=fake") as ws:
                # Send ping
                ws.send_text(json.dumps({"type": "ping", "timestamp": "123"}))
                response = ws.receive_text()
                data = json.loads(response)
                assert data["type"] == "pong"
                assert data["timestamp"] == "123"

                # Send non-JSON (should be silently ignored)
                ws.send_text("not json")

    @pytest.mark.asyncio
    async def test_ws_all_owner_success_and_ping(self, test_owner: User):
        """Owner should connect to /ws/all and handle ping/pong."""
        import json
        from unittest.mock import AsyncMock, patch

        from starlette.testclient import TestClient

        from app.main import app as fastapi_app

        with patch(
            "app.websocket.router.get_user_from_token",
            new_callable=AsyncMock,
            return_value=test_owner,
        ):
            test_client = TestClient(fastapi_app)
            with test_client.websocket_connect("/ws/all?token=fake") as ws:
                ws.send_text(json.dumps({"type": "ping", "timestamp": "456"}))
                response = ws.receive_text()
                data = json.loads(response)
                assert data["type"] == "pong"
                assert data["timestamp"] == "456"

                # Non-JSON is silently ignored
                ws.send_text("garbage data")


class TestWebSocketManagerIntegration:
    """Tests for ConnectionManager integration with routes."""

    def test_manager_singleton(self):
        """Verify that manager is a singleton across imports."""
        from app.websocket.manager import manager as manager1
        from app.websocket.router import manager as manager2

        # Both should be the same instance
        assert manager1 is manager2

    def test_manager_connection_tracking(self):
        """Test that manager properly tracks connections."""
        ws_manager.active_connections.clear()

        # Manually add some mock connections
        ws_manager.active_connections[1] = {object()}
        ws_manager.active_connections[2] = {object(), object()}

        assert ws_manager.get_connection_count(1) == 1
        assert ws_manager.get_connection_count(2) == 2
        assert ws_manager.get_connection_count() == 3

        # Clean up
        ws_manager.active_connections.clear()

    def test_manager_message_format(self):
        """Test that manager formats messages correctly."""
        event = "test_event"
        data = {"key": "value", "number": 123}
        store_id = 1

        message = ws_manager._format_message(event, data, store_id)

        assert message["event"] == event
        assert message["data"] == data
        assert message["store_id"] == store_id
        assert "timestamp" in message
        assert isinstance(message["timestamp"], str)

    def test_manager_broadcast_message_format(self):
        """Test broadcast message format (no specific store)."""
        event = "global_event"
        data = {"message": "System update"}

        message = ws_manager._format_message(event, data, None)

        assert message["event"] == event
        assert message["data"] == data
        assert message["store_id"] is None
        assert "timestamp" in message


class TestSendToUser:
    """
    Testes para send_to_user — entrega pessoal sem vazamento para owners.

    F1: notificação pessoal deve chegar à conexão do usuário destinatário.
    F2: notificação pessoal NÃO deve vazar para a room 'all' (owners).
    """

    @pytest.mark.asyncio
    async def test_send_to_user_delivers_to_target_user(self):
        """
        F1 — send_to_user entrega a mensagem à conexão registrada
        sob o user_id do destinatário.
        """
        import json
        from unittest.mock import AsyncMock

        from app.websocket.manager import manager as ws_manager

        ws_manager.active_connections.clear()
        ws_manager.user_connections.clear()

        mock_ws = AsyncMock()
        user_id = 42
        ws_manager.user_connections[user_id] = {mock_ws}

        await ws_manager.send_to_user(
            user_id, "notification", {"id": 1, "title": "Olá", "body": "Teste"}
        )

        mock_ws.send_text.assert_called_once()
        payload = json.loads(mock_ws.send_text.call_args[0][0])
        assert payload["event"] == "notification"
        assert payload["data"]["id"] == 1

        ws_manager.active_connections.clear()
        ws_manager.user_connections.clear()

    @pytest.mark.asyncio
    async def test_send_to_user_does_not_leak_to_all_room(self):
        """
        F2 — send_to_user NÃO repassa a mensagem para a room 'all' (owners),
        mesmo quando o user_id não tem conexões ativas.
        """
        from unittest.mock import AsyncMock

        from app.websocket.manager import manager as ws_manager

        ws_manager.active_connections.clear()
        ws_manager.user_connections.clear()

        # Simulamos um owner conectado na room 'all'
        owner_ws = AsyncMock()
        ws_manager.active_connections["all"] = {owner_ws}

        # user_id 99 não tem conexão ativa
        await ws_manager.send_to_user(99, "notification", {"id": 2, "title": "Privado"})

        # Owner NÃO deve receber esta mensagem pessoal
        owner_ws.send_text.assert_not_called()

        ws_manager.active_connections.clear()
        ws_manager.user_connections.clear()

    @pytest.mark.asyncio
    async def test_send_to_user_no_delivery_when_no_connection(self):
        """
        F1/F2 — quando o destinatário não tem conexão WebSocket ativa,
        send_to_user não levanta exceção (a notificação já está no banco).
        """
        from app.websocket.manager import manager as ws_manager

        ws_manager.active_connections.clear()
        ws_manager.user_connections.clear()

        # Não deve levantar exceção mesmo sem conexão
        await ws_manager.send_to_user(999, "notification", {"id": 3, "title": "Sem conexão"})

        ws_manager.active_connections.clear()
        ws_manager.user_connections.clear()

    @pytest.mark.asyncio
    async def test_create_notification_calls_send_to_user_not_send_to_store(
        self, db_session, test_user
    ):
        """
        F1 — create_notification deve chamar ws_manager.send_to_user (não
        send_to_store com 'user:{id}'), garantindo que a mensagem chegue
        à conexão pessoal do destinatário.
        """
        from unittest.mock import AsyncMock, patch

        from app.modules.notifications.schemas import NotificationType
        from app.modules.notifications.service import create_notification

        # O ws_manager é importado via import local dentro de create_notification.
        # Patchamos o objeto singleton em app.websocket.manager.
        with patch("app.websocket.manager.manager") as mock_ws_manager:
            mock_ws_manager.send_to_user = AsyncMock()
            mock_ws_manager.send_to_store = AsyncMock()

            await create_notification(
                db_session,
                user_id=test_user.id,
                type=NotificationType.ORDER_CREATED,
                title="Teste F1",
                body="Corpo da notificação",
            )

        # send_to_user deve ter sido chamado com o user_id correto
        mock_ws_manager.send_to_user.assert_called_once()
        call_args = mock_ws_manager.send_to_user.call_args[0]
        assert call_args[0] == test_user.id
        assert call_args[1] == "notification"
        assert call_args[2]["title"] == "Teste F1"
        assert call_args[2]["body"] == "Corpo da notificação"
        assert call_args[2]["type"] == NotificationType.ORDER_CREATED.value

        # send_to_store NÃO deve ter sido chamado
        mock_ws_manager.send_to_store.assert_not_called()

    @pytest.mark.asyncio
    async def test_connect_registers_user_connection(self):
        """
        Ao conectar via manager.connect(ws, store_id, user_id=...), a conexão
        deve ser registrada também em user_connections[user_id].
        """
        from unittest.mock import AsyncMock

        from app.websocket.manager import ConnectionManager

        m = ConnectionManager()
        mock_ws = AsyncMock()  # AsyncMock para suportar await ws.accept()

        await m.connect(mock_ws, 1, user_id=7)

        assert 7 in m.user_connections
        assert mock_ws in m.user_connections[7]

    @pytest.mark.asyncio
    async def test_disconnect_removes_user_connection(self):
        """
        manager.disconnect deve remover a conexão de user_connections.
        """
        from unittest.mock import AsyncMock

        from app.websocket.manager import ConnectionManager

        m = ConnectionManager()
        mock_ws = AsyncMock()  # AsyncMock para suportar await ws.accept()

        await m.connect(mock_ws, 1, user_id=8)
        m.disconnect(mock_ws, 1, user_id=8)

        assert 8 not in m.user_connections

    @pytest.mark.asyncio
    async def test_disconnect_one_tab_keeps_other(self):
        """Duas abas do mesmo usuário: desconectar uma NÃO derruba a outra."""
        from unittest.mock import AsyncMock

        from app.websocket.manager import ConnectionManager

        m = ConnectionManager()
        ws_a = AsyncMock()
        ws_b = AsyncMock()

        await m.connect(ws_a, 1, user_id=8)
        await m.connect(ws_b, 1, user_id=8)
        m.disconnect(ws_a, 1, user_id=8)

        assert m.user_connections[8] == {ws_b}
