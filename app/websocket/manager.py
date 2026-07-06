"""
WebSocket ConnectionManager — gerencia conexões ativas e broadcast de eventos.
"""

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket


class ConnectionManager:
    """
    Gerencia conexões WebSocket por store_id.
    "all" é usado para owners que recebem eventos de todas as lojas.
    """

    def __init__(self) -> None:
        self.active_connections: dict[int | str, set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, store_id: int | str) -> None:
        await websocket.accept()
        if store_id not in self.active_connections:
            self.active_connections[store_id] = set()
        self.active_connections[store_id].add(websocket)

    def disconnect(self, websocket: WebSocket, store_id: int | str) -> None:
        if store_id not in self.active_connections:
            return
        self.active_connections[store_id].discard(websocket)
        if not self.active_connections[store_id]:
            del self.active_connections[store_id]

    async def send_to_store(self, store_id: int | str, event: str, data: dict[str, Any]) -> None:
        """Envia evento para conexões da loja específica e para conexões 'all' (owners)."""
        message = json.dumps(self._format_message(event, data, store_id))
        dead: list[tuple[int | str, WebSocket]] = []

        for ws in list(self.active_connections.get(store_id, set())):
            try:
                await ws.send_text(message)
            except Exception:
                dead.append((store_id, ws))

        # Owners também recebem eventos de lojas específicas
        if store_id != "all":
            for ws in list(self.active_connections.get("all", set())):
                try:
                    await ws.send_text(message)
                except Exception:
                    dead.append(("all", ws))

        for key, ws in dead:
            if key in self.active_connections:
                self.active_connections[key].discard(ws)
                if not self.active_connections[key]:
                    del self.active_connections[key]

    async def broadcast_to_all(self, event: str, data: dict[str, Any]) -> None:
        """Envia evento para todas as conexões ativas (store_id=None na mensagem)."""
        message = json.dumps(self._format_message(event, data, None))
        dead: list[tuple[int | str, WebSocket]] = []

        for key, connections in list(self.active_connections.items()):
            for ws in list(connections):
                try:
                    await ws.send_text(message)
                except Exception:
                    dead.append((key, ws))

        for key, ws in dead:
            if key in self.active_connections:
                self.active_connections[key].discard(ws)
                if not self.active_connections[key]:
                    del self.active_connections[key]

    def get_connection_count(self, store_id: int | str | None = None) -> int:
        if store_id is not None:
            return len(self.active_connections.get(store_id, set()))
        return sum(len(conns) for conns in self.active_connections.values())

    def _format_message(
        self, event: str, data: dict[str, Any], store_id: int | str | None
    ) -> dict[str, Any]:
        return {
            "event": event,
            "data": data,
            "store_id": store_id,
            "timestamp": datetime.now(UTC).isoformat(),
        }


manager = ConnectionManager()
