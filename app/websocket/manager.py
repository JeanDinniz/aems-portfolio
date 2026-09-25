"""
WebSocket ConnectionManager — gerencia conexões ativas e broadcast de eventos.
"""

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket


class ConnectionManager:
    """
    Gerencia conexões WebSocket por store_id e por user_id.

    Rooms:
    - active_connections[store_id: int]  → conexões da loja (int)
    - active_connections["all"]          → conexões de owners
    - user_connections[user_id: int]     → conexão pessoal de cada usuário

    A separação entre store_connections e user_connections é deliberada:
    send_to_user não tem o fallback owner-broadcast de send_to_store, evitando
    que notificações pessoais vazem para outros usuários.
    """

    def __init__(self) -> None:
        self.active_connections: dict[int | str, set[WebSocket]] = {}
        self.user_connections: dict[int, set[WebSocket]] = {}

    async def connect(
        self, websocket: WebSocket, store_id: int | str, *, user_id: int | None = None
    ) -> None:
        await websocket.accept()
        if store_id not in self.active_connections:
            self.active_connections[store_id] = set()
        self.active_connections[store_id].add(websocket)

        if user_id is not None:
            if user_id not in self.user_connections:
                self.user_connections[user_id] = set()
            self.user_connections[user_id].add(websocket)

    def disconnect(
        self, websocket: WebSocket, store_id: int | str, *, user_id: int | None = None
    ) -> None:
        if store_id in self.active_connections:
            self.active_connections[store_id].discard(websocket)
            if not self.active_connections[store_id]:
                del self.active_connections[store_id]

        if user_id is not None and user_id in self.user_connections:
            self.user_connections[user_id].discard(websocket)
            if not self.user_connections[user_id]:
                del self.user_connections[user_id]

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

    async def send_to_user(self, user_id: int, event: str, data: dict[str, Any]) -> None:
        """
        Entrega evento apenas às conexões WebSocket do usuário destinatário.

        Diferente de send_to_store, este método NÃO tem fallback para a room
        'all' — notificações pessoais nunca devem vazar para outros usuários.
        Se o usuário não tiver conexões ativas no momento, a mensagem é
        silenciosamente descartada (ela já está persistida no banco e aparecerá
        no próximo fetch de notificações).
        """
        connections = list(self.user_connections.get(user_id, set()))
        if not connections:
            return

        message = json.dumps(self._format_message(event, data, None))
        dead: list[WebSocket] = []

        for ws in connections:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)

        if dead and user_id in self.user_connections:
            for ws in dead:
                self.user_connections[user_id].discard(ws)
            if not self.user_connections[user_id]:
                del self.user_connections[user_id]

    async def broadcast_to_all(self, event: str, data: dict[str, Any]) -> None:
        """Envia evento para todas as conexões ativas (store_id=None na mensagem)."""
        if not self.active_connections:
            return
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
