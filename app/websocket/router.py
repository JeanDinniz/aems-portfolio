"""
WebSocket endpoints — conexões em tempo real por loja.
"""

import json
import logging
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
    from sqlalchemy.orm import selectinload

    from app.modules.access_profiles.models import AccessProfile
    from app.modules.auth.models import User

    payload = await verify_websocket_token(token)
    if not payload:
        return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(User)
            .options(
                # Perfis + lojas carregados aqui: user_can_access_store valida o
                # canal FORA desta sessão (a conexão WS vive além deste bloco)
                selectinload(User.access_profiles).selectinload(AccessProfile.stores)
            )
            .where(User.id == int(user_id))
        )
        user = result.scalar_one_or_none()

    if not user:
        return None

    return user


async def user_can_access_store(user: "User", store_id: int) -> bool:
    """
    Verifica se o usuário pode se conectar ao canal da loja.

    Considera o store_id direto E as lojas dos perfis de acesso ativos —
    usuário de perfil normalmente tem users.store_id NULL (o /auth/me deriva
    a loja do perfil), e comparar só o store_id fazia o WS recusar com 4003
    e o frontend ficar em loop eterno de reconexão (ícone laranja).
    """
    from app.core.permissions import PermissionChecker

    if user.role == "owner":
        return True
    if user.role != "user":
        return False  # role desconhecido/legado: nega por segurança
    return store_id in PermissionChecker.get_user_store_ids(user)


@router.websocket("/ws/all")
async def ws_all(
    websocket: WebSocket,
    token: str = Query(None),
) -> None:
    """Conexão WebSocket para owners — recebe eventos de todas as lojas."""
    user = await get_user_from_token(token or "")
    # Rejeições precisam de accept() ANTES do close(code=...): fechar sem aceitar
    # rejeita o handshake com HTTP 403, e o navegador recebe onclose code=1006
    # (não 4001/4003) → o guard anti-loop do cliente não dispara e ele reconecta
    # eternamente. Com accept()+close(code) o cliente recebe o código real e para.
    if not user:
        await websocket.accept()
        await websocket.close(code=4001)
        return

    if user.role != "owner":
        await websocket.accept()
        await websocket.close(code=4003)
        return

    await manager.connect(websocket, "all", user_id=user.id)
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
        manager.disconnect(websocket, "all", user_id=user.id)
        logger.info("WS/all disconnected: user=%s", user.id)


@router.websocket("/ws/{store_id}")
async def ws_store(
    websocket: WebSocket,
    store_id: int,
    token: str = Query(None),
) -> None:
    """Conexão WebSocket para usuários de uma loja específica."""
    user = await get_user_from_token(token or "")
    # accept() antes do close(code=...) nas rejeições — ver nota em ws_all.
    if not user:
        await websocket.accept()
        await websocket.close(code=4001)
        return

    if not await user_can_access_store(user, store_id):
        await websocket.accept()
        await websocket.close(code=4003)
        return

    await manager.connect(websocket, store_id, user_id=user.id)
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
        manager.disconnect(websocket, store_id, user_id=user.id)
        logger.info("WS disconnected: user=%s store=%s", user.id, store_id)


@router.get("/ws/status", tags=["WebSocket"])
async def ws_status() -> dict:
    """Retorna contagem de conexões WebSocket ativas por loja."""
    connections_by_store = {str(k): len(v) for k, v in manager.active_connections.items()}
    return {
        "total_connections": manager.get_connection_count(),
        "connections_by_store": connections_by_store,
    }
