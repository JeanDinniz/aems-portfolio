"""
Integration tests for WebSocket endpoints.

Note: Due to async session limitations with synchronous WebSocket testing,
these tests focus on authentication/authorization logic and the /ws/status endpoint.
Full WebSocket connection behavior is validated through the manager unit tests.
"""

from datetime import UTC

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
    async def test_user_can_access_store_unknown_role(
        self, test_user: User, test_store: Store
    ):
        """Unknown role should be denied access."""
        from app.websocket.router import user_can_access_store

        # Temporarily change user role to something unknown
        original_role = test_user.role
        test_user.role = "unknown_role"
        can_access = await user_can_access_store(test_user, test_store.id)
        assert can_access is False
        test_user.role = original_role


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

    @pytest.mark.asyncio
    async def test_locked_user_returns_none(self, test_user: User):
        """Locked user should return None."""
        from datetime import datetime, timedelta
        from unittest.mock import AsyncMock, MagicMock, patch

        from app.websocket.router import get_user_from_token

        token, _ = create_access_token({"sub": str(test_user.id)})

        # Set user as locked
        test_user.locked_until = datetime.now(UTC) + timedelta(hours=1)

        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = test_user
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        with patch("app.websocket.router.AsyncSessionLocal", return_value=mock_session):
            user = await get_user_from_token(token)
        assert user is None

        # Reset
        test_user.locked_until = None


class TestWebSocketEndpoints:
    """Tests for WebSocket endpoint connections via mocked get_user_from_token."""

    @pytest.mark.asyncio
    async def test_ws_store_invalid_token(self, client: AsyncClient):
        """WebSocket with invalid token should be closed with 4001."""
        from unittest.mock import AsyncMock, patch

        from starlette.testclient import TestClient

        from app.main import app as fastapi_app

        with patch(
            "app.websocket.router.get_user_from_token",
            new_callable=AsyncMock,
            return_value=None,
        ):
            test_client = TestClient(fastapi_app)
            with pytest.raises(Exception):
                with test_client.websocket_connect("/ws/1?token=bad"):
                    pass  # Should fail on connect

    @pytest.mark.asyncio
    async def test_ws_all_invalid_token(self, client: AsyncClient):
        """WebSocket /ws/all with invalid token should be closed."""
        from unittest.mock import AsyncMock, patch

        from starlette.testclient import TestClient

        from app.main import app as fastapi_app

        with patch(
            "app.websocket.router.get_user_from_token",
            new_callable=AsyncMock,
            return_value=None,
        ):
            test_client = TestClient(fastapi_app)
            with pytest.raises(Exception):
                with test_client.websocket_connect("/ws/all?token=bad"):
                    pass

    @pytest.mark.asyncio
    async def test_ws_all_non_owner_rejected(self, test_user: User):
        """Non-owner should be rejected from /ws/all."""
        from unittest.mock import AsyncMock, patch

        from starlette.testclient import TestClient

        from app.main import app as fastapi_app

        with patch(
            "app.websocket.router.get_user_from_token",
            new_callable=AsyncMock,
            return_value=test_user,
        ):
            test_client = TestClient(fastapi_app)
            with pytest.raises(Exception):
                with test_client.websocket_connect("/ws/all?token=fake"):
                    pass

    @pytest.mark.asyncio
    async def test_ws_store_access_denied(self, test_user: User, second_store: Store):
        """Operator should be denied access to a store they don't belong to."""
        from unittest.mock import AsyncMock, patch

        from starlette.testclient import TestClient

        from app.main import app as fastapi_app

        with patch(
            "app.websocket.router.get_user_from_token",
            new_callable=AsyncMock,
            return_value=test_user,
        ):
            test_client = TestClient(fastapi_app)
            with pytest.raises(Exception):
                with test_client.websocket_connect(
                    f"/ws/{second_store.id}?token=fake"
                ):
                    pass

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
            with test_client.websocket_connect(
                f"/ws/{test_store.id}?token=fake"
            ) as ws:
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
