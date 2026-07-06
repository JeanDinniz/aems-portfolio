"""
Security utilities - JWT tokens, password hashing, authentication dependencies.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Annotated

if TYPE_CHECKING:
    from app.modules.auth.models import User

from fastapi import Depends, Request
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.exceptions import AccountLockedError, AuthenticationError
from app.db.session import get_db

settings = get_settings()

# Password hashing context
# Usamos argon2 (recomendado pela OWASP) - mais seguro e sem limite de 72 bytes
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

# OAuth2 scheme for token extraction
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_PREFIX}/auth/login")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifica se a senha em texto plano corresponde ao hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Gera hash bcrypt da senha."""
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> tuple[str, str]:
    """
    Cria um JWT access token.

    Args:
        data: Dados a serem codificados no token (ex: {"sub": user_id})
        expires_delta: Tempo de expiração customizado

    Returns:
        Tupla (token JWT codificado, jti)
    """
    to_encode = data.copy()
    expire = datetime.now(UTC) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    jti = str(uuid.uuid4())
    to_encode.update({"exp": expire, "type": "access", "jti": jti})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM), jti


def create_refresh_token(data: dict, expires_delta: timedelta | None = None) -> tuple[str, str]:
    """
    Cria um JWT refresh token.

    Args:
        data: Dados a serem codificados no token
        expires_delta: Tempo de expiração customizado

    Returns:
        Tupla (token JWT codificado, jti)
    """
    to_encode = data.copy()
    expire = datetime.now(UTC) + (
        expires_delta or timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    )
    jti = str(uuid.uuid4())
    to_encode.update({"exp": expire, "type": "refresh", "jti": jti})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM), jti


async def revoke_token_jti(redis_client, jti: str, ttl: int) -> None:
    """
    Armazena o JTI do token na blacklist do Redis com o TTL fornecido.

    Args:
        redis_client: Cliente Redis assíncrono já conectado.
        jti: JWT ID único do token a revogar.
        ttl: Tempo em segundos até o token expirar naturalmente.
    """
    await redis_client.setex(f"token_blacklist:{jti}", ttl, "1")


def decode_token(token: str) -> dict:
    """
    Decodifica e valida um JWT token.

    Args:
        token: Token JWT a ser decodificado

    Returns:
        Payload do token

    Raises:
        AuthenticationError: Se o token for inválido ou expirado
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError as e:
        raise AuthenticationError(detail=f"Token inválido: {str(e)}") from e


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> "User":
    """
    Dependency para obter o usuário atual a partir do token JWT.

    Uso:
        @router.get("/me")
        async def get_me(current_user: User = Depends(get_current_user)):
            return current_user
    """
    # Import here to avoid circular imports
    from app.modules.auth.models import User

    payload = decode_token(token)

    # Verificar tipo do token
    if payload.get("type") != "access":
        raise AuthenticationError(detail="Tipo de token inválido")

    jti = payload.get("jti")
    user_id = payload.get("sub")
    if user_id is None:
        raise AuthenticationError(detail="Token inválido: user_id não encontrado")

    # Verificar blacklist e sessão ativa no Redis (conexão única)
    if jti:
        try:
            import json

            import redis.asyncio as aioredis

            redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            is_revoked = await redis_client.get(f"token_blacklist:{jti}")
            active_raw = await redis_client.get(f"user_active_session:{user_id}")
            await redis_client.aclose()

            if is_revoked:
                raise AuthenticationError(detail="Token revogado")

            if active_raw:
                active = json.loads(active_raw)
                if active.get("access_jti") != jti:
                    raise AuthenticationError(
                        detail="Sessão encerrada. Outro dispositivo realizou login."
                    )
        except AuthenticationError:
            raise
        except Exception as e:
            import logging

            logging.getLogger(__name__).warning("Redis unavailable for token check: %s", str(e))

    # Buscar usuário no banco (com perfis de acesso para filtro de lojas)
    from sqlalchemy.orm import selectinload as _selectinload

    from app.modules.access_profiles.models import AccessProfile

    result = await db.execute(
        select(User)
        .options(_selectinload(User.access_profiles).selectinload(AccessProfile.stores))
        .where(User.id == int(user_id))
    )
    user = result.scalar_one_or_none()

    if user is None:
        raise AuthenticationError(detail="Usuário não encontrado")

    if not user.is_active:
        raise AuthenticationError(detail="Usuário desativado")

    # Verificar se a conta está bloqueada
    if user.locked_until and user.locked_until > datetime.now(UTC):
        minutes_remaining = int((user.locked_until - datetime.now(UTC)).total_seconds() / 60)
        raise AccountLockedError(minutes_remaining=max(1, minutes_remaining))

    return user


def get_client_ip(request: Request) -> str:
    """Extrai o IP real do cliente, considerando proxies."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def get_user_agent(request: Request) -> str:
    """Extrai o User-Agent do request."""
    return request.headers.get("User-Agent", "unknown")[:500]
