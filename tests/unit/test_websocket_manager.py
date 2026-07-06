"""
Unit tests for WebSocket ConnectionManager.
"""

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.websocket.manager import ConnectionManager


class TestConnectionManager:
    """Tests for ConnectionManager class."""

    @pytest.fixture
    def manager(self):
        """Create a fresh ConnectionManager instance for each test."""
        return ConnectionManager()

    @pytest.fixture
    def mock_websocket(self):
        """Create a mock WebSocket connection."""
        ws = MagicMock()
        ws.accept = AsyncMock()
        ws.send_text = AsyncMock()
        ws.close = AsyncMock()
        return ws

    @pytest.fixture
    def mock_websocket_2(self):
        """Create a second mock WebSocket connection."""
        ws = MagicMock()
        ws.accept = AsyncMock()
        ws.send_text = AsyncMock()
        ws.close = AsyncMock()
        return ws

    @pytest.mark.asyncio
    async def test_connect_single_client(self, manager, mock_websocket):
        """Connect a single client to a store."""
        store_id = 1

        await manager.connect(mock_websocket, store_id)

        # WebSocket should be accepted
        mock_websocket.accept.assert_called_once()

        # Store should have one connection
        assert store_id in manager.active_connections
        assert mock_websocket in manager.active_connections[store_id]
        assert len(manager.active_connections[store_id]) == 1

    @pytest.mark.asyncio
    async def test_connect_multiple_clients_same_store(
        self, manager, mock_websocket, mock_websocket_2
    ):
        """Connect multiple clients to the same store."""
        store_id = 1

        await manager.connect(mock_websocket, store_id)
        await manager.connect(mock_websocket_2, store_id)

        # Both connections should be accepted
        mock_websocket.accept.assert_called_once()
        mock_websocket_2.accept.assert_called_once()

        # Store should have two connections
        assert len(manager.active_connections[store_id]) == 2
        assert mock_websocket in manager.active_connections[store_id]
        assert mock_websocket_2 in manager.active_connections[store_id]

    @pytest.mark.asyncio
    async def test_connect_clients_different_stores(
        self, manager, mock_websocket, mock_websocket_2
    ):
        """Connect clients to different stores."""
        await manager.connect(mock_websocket, 1)
        await manager.connect(mock_websocket_2, 2)

        # Both stores should exist
        assert 1 in manager.active_connections
        assert 2 in manager.active_connections

        # Each store should have one connection
        assert len(manager.active_connections[1]) == 1
        assert len(manager.active_connections[2]) == 1

    @pytest.mark.asyncio
    async def test_connect_owner_to_all_stores(self, manager, mock_websocket):
        """Connect owner client to 'all' stores channel."""
        await manager.connect(mock_websocket, "all")

        # "all" channel should exist
        assert "all" in manager.active_connections
        assert mock_websocket in manager.active_connections["all"]

    def test_disconnect_client(self, manager, mock_websocket):
        """Disconnect a client from a store."""
        store_id = 1

        # Manually add connection (bypassing async connect)
        manager.active_connections[store_id] = {mock_websocket}

        # Disconnect
        manager.disconnect(mock_websocket, store_id)

        # Connection should be removed and store_id should be cleaned up
        assert store_id not in manager.active_connections

    def test_disconnect_one_of_multiple_clients(
        self, manager, mock_websocket, mock_websocket_2
    ):
        """Disconnect one client when multiple are connected to same store."""
        store_id = 1

        # Add both connections
        manager.active_connections[store_id] = {mock_websocket, mock_websocket_2}

        # Disconnect first client
        manager.disconnect(mock_websocket, store_id)

        # Store should still exist with one connection
        assert store_id in manager.active_connections
        assert mock_websocket not in manager.active_connections[store_id]
        assert mock_websocket_2 in manager.active_connections[store_id]
        assert len(manager.active_connections[store_id]) == 1

    def test_disconnect_nonexistent_client(self, manager, mock_websocket):
        """Disconnect a client that doesn't exist should not raise error."""
        # This should not raise any exception
        manager.disconnect(mock_websocket, 999)

        # Manager should still be functional
        assert 999 not in manager.active_connections

    def test_disconnect_from_nonexistent_store(self, manager, mock_websocket):
        """Disconnect from a store that doesn't exist should not raise error."""
        # This should not raise any exception
        manager.disconnect(mock_websocket, 999)

        assert len(manager.active_connections) == 0

    @pytest.mark.asyncio
    async def test_send_to_store_single_connection(self, manager, mock_websocket):
        """Send message to a store with single connection."""
        store_id = 1
        manager.active_connections[store_id] = {mock_websocket}

        event = "test_event"
        data = {"message": "Hello", "value": 123}

        await manager.send_to_store(store_id, event, data)

        # Message should be sent
        mock_websocket.send_text.assert_called_once()
        sent_message = json.loads(mock_websocket.send_text.call_args[0][0])

        assert sent_message["event"] == event
        assert sent_message["data"] == data
        assert sent_message["store_id"] == store_id
        assert "timestamp" in sent_message

    @pytest.mark.asyncio
    async def test_send_to_store_multiple_connections(
        self, manager, mock_websocket, mock_websocket_2
    ):
        """Send message to multiple connections in same store."""
        store_id = 1
        manager.active_connections[store_id] = {mock_websocket, mock_websocket_2}

        event = "test_event"
        data = {"message": "Broadcast"}

        await manager.send_to_store(store_id, event, data)

        # Both connections should receive the message
        mock_websocket.send_text.assert_called_once()
        mock_websocket_2.send_text.assert_called_once()

    @pytest.mark.asyncio
    async def test_send_to_store_includes_owner_connections(
        self, manager, mock_websocket, mock_websocket_2
    ):
        """Send to store should also send to owner 'all' connections."""
        store_id = 1
        manager.active_connections[store_id] = {mock_websocket}
        manager.active_connections["all"] = {mock_websocket_2}

        event = "test_event"
        data = {"message": "Test"}

        await manager.send_to_store(store_id, event, data)

        # Both store and "all" connections should receive message
        mock_websocket.send_text.assert_called_once()
        mock_websocket_2.send_text.assert_called_once()

    @pytest.mark.asyncio
    async def test_send_to_nonexistent_store(self, manager):
        """Send to nonexistent store should not raise error."""
        # This should not raise any exception
        await manager.send_to_store(999, "event", {"data": "test"})

        # No connections should exist
        assert 999 not in manager.active_connections

    @pytest.mark.asyncio
    async def test_send_to_store_handles_dead_connection(self, manager, mock_websocket):
        """Dead connection should be cleaned up when send fails."""
        store_id = 1
        manager.active_connections[store_id] = {mock_websocket}

        # Make send_text raise exception (simulating dead connection)
        mock_websocket.send_text.side_effect = Exception("Connection closed")

        event = "test_event"
        data = {"message": "Test"}

        await manager.send_to_store(store_id, event, data)

        # Dead connection should be removed
        assert store_id not in manager.active_connections

    @pytest.mark.asyncio
    async def test_send_removes_only_dead_connections(
        self, manager, mock_websocket, mock_websocket_2
    ):
        """Only dead connections should be removed, not all connections."""
        store_id = 1
        manager.active_connections[store_id] = {mock_websocket, mock_websocket_2}

        # First connection fails, second succeeds
        mock_websocket.send_text.side_effect = Exception("Connection closed")
        mock_websocket_2.send_text = AsyncMock()

        await manager.send_to_store(store_id, "event", {"data": "test"})

        # Store should still exist with one connection
        assert store_id in manager.active_connections
        assert mock_websocket not in manager.active_connections[store_id]
        assert mock_websocket_2 in manager.active_connections[store_id]

    @pytest.mark.asyncio
    async def test_broadcast_to_all(
        self, manager, mock_websocket, mock_websocket_2
    ):
        """Broadcast should send to all stores and 'all' connections."""
        manager.active_connections[1] = {mock_websocket}
        manager.active_connections["all"] = {mock_websocket_2}

        event = "global_event"
        data = {"message": "System announcement"}

        await manager.broadcast_to_all(event, data)

        # All connections should receive message
        mock_websocket.send_text.assert_called_once()
        mock_websocket_2.send_text.assert_called_once()

        # Check message format
        sent_message = json.loads(mock_websocket.send_text.call_args[0][0])
        assert sent_message["event"] == event
        assert sent_message["data"] == data
        assert sent_message["store_id"] is None  # Broadcast doesn't have specific store_id

    @pytest.mark.asyncio
    async def test_broadcast_to_all_multiple_stores(self, manager):
        """Broadcast to multiple stores with multiple connections each."""
        ws1 = AsyncMock()
        ws2 = AsyncMock()
        ws3 = AsyncMock()

        manager.active_connections[1] = {ws1}
        manager.active_connections[2] = {ws2, ws3}

        await manager.broadcast_to_all("event", {"data": "test"})

        # All connections should receive message
        ws1.send_text.assert_called_once()
        ws2.send_text.assert_called_once()
        ws3.send_text.assert_called_once()

    def test_get_connection_count_single_store(self, manager, mock_websocket):
        """Get connection count for a specific store."""
        store_id = 1
        manager.active_connections[store_id] = {mock_websocket}

        count = manager.get_connection_count(store_id)
        assert count == 1

    def test_get_connection_count_multiple_stores(
        self, manager, mock_websocket, mock_websocket_2
    ):
        """Get total connection count across all stores."""
        manager.active_connections[1] = {mock_websocket}
        manager.active_connections[2] = {mock_websocket_2}

        total_count = manager.get_connection_count()
        assert total_count == 2

    def test_get_connection_count_nonexistent_store(self, manager):
        """Get connection count for nonexistent store should return 0."""
        count = manager.get_connection_count(999)
        assert count == 0

    def test_get_connection_count_empty_manager(self, manager):
        """Get connection count with no connections should return 0."""
        count = manager.get_connection_count()
        assert count == 0

    def test_format_message_with_store_id(self, manager):
        """Format message should include all required fields."""
        event = "test_event"
        data = {"key": "value"}
        store_id = 1

        message = manager._format_message(event, data, store_id)

        assert message["event"] == event
        assert message["data"] == data
        assert message["store_id"] == store_id
        assert "timestamp" in message
        # Timestamp should be ISO format
        assert "T" in message["timestamp"]

    def test_format_message_without_store_id(self, manager):
        """Format message for broadcast should have None store_id."""
        event = "global_event"
        data = {"message": "broadcast"}

        message = manager._format_message(event, data, None)

        assert message["event"] == event
        assert message["data"] == data
        assert message["store_id"] is None
        assert "timestamp" in message

    @pytest.mark.asyncio
    async def test_concurrent_connections_same_store(self, manager):
        """Test multiple concurrent connections to same store."""
        store_id = 1
        connections = [AsyncMock() for _ in range(5)]

        # Connect all clients concurrently
        for ws in connections:
            await manager.connect(ws, store_id)

        # All should be connected
        assert len(manager.active_connections[store_id]) == 5

        # Disconnect all
        for ws in connections:
            manager.disconnect(ws, store_id)

        # Store should be cleaned up
        assert store_id not in manager.active_connections
