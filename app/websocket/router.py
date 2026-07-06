"""
WebSocket endpoints — conexões em tempo real por loja.
"""

import json
import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from jose import JWTError, jwt
from sqlalchemy import select

from app.config import get_settings
from app.db.session import AsyncSessionLocal
from app.websocket.manager import manager

if TYPE_CHECKING:
    from app.modules.auth.models import User

settings = get_settings()
logger = logging.getLogger(__name__)
router = APIRouter()


async def verify_websocket_token(token: str) -> dict | None:
    """Verifica JWT; retorna payload apenas para access tokens válidos."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("type") != "access":
            return None
        return payload
    except JWTError:
        return None


async def get_user_from_token(token: str) -> "User | None":
    """Busca o usuário no banco a partir de um token JWT. Retorna None se inválido/bloqueado."""
    from app.modules.auth.models import User

    payload = await verify_websocket_token(token)
    if not payload:
        return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()

    if not user:
        return None

    if user.locked_until and user.locked_until > datetime.now(UTC):
        return None

    return user


async def user_can_access_store(user: "User", store_id: int) -> bool:
    """Verifica se o usuário pode se conectar ao canal da loja."""
    if user.role == "owner":
        return True
    # "user" é o role padrão para não-owners; acesso restrito à própria loja
    if user.role in ("user", "operator", "supervisor"):
        return user.store_id == store_id
    return False


@router.websocket("/ws/all")
async def ws_all(
    websocket: WebSocket,
    token: str = Query(None),
) -> None:
    """Conexão WebSocket para owners — recebe eventos de todas as lojas."""
    user = await get_user_from_token(token or "")
    if not user:
        await websocket.close(code=4001)
        return

    if user.role != "owner":
        await websocket.close(code=4003)
        return

    await manager.connect(websocket, "all")
    logger.info("WS/all connected: user=%s", user.id)

    try:
        while True:
            text = await websocket.receive_text()
            try:
                msg = json.loads(text)
                if msg.get("type") == "ping":
                    await websocket.send_text(
                        json.dumps({"type": "pong", "timestamp": msg.get("timestamp")})
                    )
            except (json.JSONDecodeError, Exception):
                pass
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket, "all")
        logger.info("WS/all disconnected: user=%s", user.id)


@router.websocket("/ws/{store_id}")
async def ws_store(
    websocket: WebSocket,
    store_id: int,
    token: str = Query(None),
) -> None:
    """Conexão WebSocket para usuários de uma loja específica."""
    user = await get_user_from_token(token or "")
    if not user:
        await websocket.close(code=4001)
        return

    if not await user_can_access_store(user, store_id):
        await websocket.close(code=4003)
        return

    await manager.connect(websocket, store_id)
    logger.info("WS connected: user=%s store=%s", user.id, store_id)

    try:
        while True:
            text = await websocket.receive_text()
            try:
                msg = json.loads(text)
                if msg.get("type") == "ping":
                    await websocket.send_text(
                        json.dumps({"type": "pong", "timestamp": msg.get("timestamp")})
                    )
            except (json.JSONDecodeError, Exception):
                pass  # mensagens não-JSON são silenciosamente ignoradas
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket, store_id)
        logger.info("WS disconnected: user=%s store=%s", user.id, store_id)


@router.get("/ws/status", tags=["WebSocket"])
async def ws_status() -> dict:
    """Retorna contagem de conexões WebSocket ativas por loja."""
    connections_by_store = {str(k): len(v) for k, v in manager.active_connections.items()}
    return {
        "total_connections": manager.get_connection_count(),
        "connections_by_store": connections_by_store,
    }
