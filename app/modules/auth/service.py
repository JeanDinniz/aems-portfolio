"""
Auth service - Business logic for authentication.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.core.audit import log_audit
from app.core.exceptions import (
    AccountLockedError,
    AuthenticationError,
    ConflictError,
    ValidationError,
)
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    revoke_token_jti,
    verify_password,
)
from app.modules.auth.models import AccessLog, User
from app.modules.auth.schemas import (
    LoginResponse,
    PasswordChange,
    UserCreate,
    UserResponse,
)

settings = get_settings()


async def log_access(
    db: AsyncSession,
    user_id: int | None,
    action: str,
    success: bool = True,
    ip_address: str | None = None,
    user_agent: str | None = None,
    details: dict | None = None,
) -> None:
    """Registra um log de acesso."""
    log = AccessLog(
        user_id=user_id,
        action=action,
        success=success,
        ip_address=ip_address,
        user_agent=user_agent,
        details=details,
    )
    db.add(log)
    await db.flush()


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    """Busca usuário por email."""
    result = await db.execute(select(User).where(User.email == email.lower()))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: int) -> User | None:
    """Busca usuário por ID."""
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def authenticate(
    db: AsyncSession,
    email: str,
    password: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> LoginResponse:
    """
    Autentica usuário com email e senha.

    Args:
        db: Sessão do banco de dados
        email: Email do usuário
        password: Senha em texto plano
        ip_address: IP do cliente
        user_agent: User-Agent do cliente

    Returns:
        LoginResponse com tokens JWT

    Raises:
        AuthenticationError: Credenciais inválidas
        AccountLockedError: Conta bloqueada
    """
    user = await get_user_by_email(db, email)

    # Usuário não encontrado
    if not user:
        await log_access(
            db,
            user_id=None,
            action="login_failed",
            success=False,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"email": email, "reason": "user_not_found"},
        )
        raise AuthenticationError(detail="Email ou senha inválidos")

    # Verificar se a conta está bloqueada
    if user.locked_until and user.locked_until > datetime.now(UTC):
        minutes_remaining = int((user.locked_until - datetime.now(UTC)).total_seconds() / 60)
        raise AccountLockedError(minutes_remaining=max(1, minutes_remaining))

    # Verificar se o usuário está ativo
    if not user.is_active:
        await log_access(
            db,
            user_id=user.id,
            action="login_failed",
            success=False,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"reason": "user_inactive"},
        )
        raise AuthenticationError(detail="Usuário desativado")

    # Verificar senha
    if not verify_password(password, user.hashed_password):
        # Incrementar tentativas falhas
        user.failed_login_attempts += 1

        # Bloquear após MAX_LOGIN_ATTEMPTS tentativas
        if user.failed_login_attempts >= settings.MAX_LOGIN_ATTEMPTS:
            user.locked_until = datetime.now(UTC) + timedelta(
                minutes=settings.LOCKOUT_DURATION_MINUTES
            )
            await log_access(
                db,
                user_id=user.id,
                action="account_locked",
                success=False,
                ip_address=ip_address,
                user_agent=user_agent,
                details={"attempts": user.failed_login_attempts},
            )
            await db.commit()
            raise AccountLockedError(minutes_remaining=settings.LOCKOUT_DURATION_MINUTES)

        await log_access(
            db,
            user_id=user.id,
            action="login_failed",
            success=False,
            ip_address=ip_address,
            user_agent=user_agent,
            details={
                "reason": "invalid_password",
                "attempts": user.failed_login_attempts,
            },
        )
        await db.commit()
        raise AuthenticationError(detail="Email ou senha inválidos")

    # Login bem-sucedido - resetar tentativas
    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login = datetime.now(UTC)

    # Derivar store_id efetivo para o JWT (pode vir dos perfis de acesso)
    effective_store_id = user.store_id
    if user.role == "user":
        from sqlalchemy import func as _func

        from app.modules.access_profiles.models import (
            AccessProfile,
        )
        from app.modules.access_profiles.models import (
            access_profile_users as _apu,
        )

        # Consulta direta na junção para evitar cache da sessão SQLAlchemy
        active_count_result = await db.execute(
            select(_func.count())
            .select_from(AccessProfile)
            .join(_apu, _apu.c.profile_id == AccessProfile.id)
            .where(_apu.c.user_id == user.id, AccessProfile.is_active.is_(True))
        )
        if active_count_result.scalar_one() == 0:
            raise AuthenticationError(
                detail="Usuário sem perfil de acesso configurado. Contate o administrador do sistema."
            )

        if effective_store_id is None:
            prof_result = await db.execute(
                select(User)
                .options(selectinload(User.access_profiles).selectinload(AccessProfile.stores))
                .where(User.id == user.id)
            )
            user_with_profiles = prof_result.scalar_one()
            for profile in user_with_profiles.access_profiles:
                if profile.is_active and profile.stores:
                    effective_store_id = profile.stores[0].id
                    break

    # Criar tokens
    token_data = {"sub": str(user.id), "role": user.role, "store_id": effective_store_id}
    access_token, access_jti = create_access_token(token_data)
    refresh_token, refresh_jti = create_refresh_token(token_data)

    # Registrar sessão ativa no Redis (substitui sessão anterior do mesmo usuário)
    try:
        import json

        import redis.asyncio as aioredis

        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        await _redis.setex(
            f"user_active_session:{user.id}",
            settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
            json.dumps({"access_jti": access_jti, "refresh_jti": refresh_jti}),
        )
        await _redis.aclose()
    except Exception as _e:
        import logging

        logging.getLogger(__name__).warning("Redis unavailable for session tracking: %s", str(_e))

    await log_access(
        db,
        user_id=user.id,
        action="login",
        success=True,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    await log_audit(
        db=db,
        action="login",
        resource_type="auth",
        user_id=user.id,
        resource_id=user.id,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    await db.flush()

    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        must_change_password=user.must_change_password,
    )


async def refresh_access_token(
    db: AsyncSession,
    refresh_token: str,
) -> LoginResponse:
    """
    Renova access token usando refresh token.

    Args:
        db: Sessão do banco de dados
        refresh_token: Refresh token válido

    Returns:
        LoginResponse com novos tokens

    Raises:
        AuthenticationError: Token inválido
    """
    payload = decode_token(refresh_token)

    if payload.get("type") != "refresh":
        raise AuthenticationError(detail="Token de refresh inválido")

    # Verificar blacklist e sessão ativa (conexão Redis única)
    jti = payload.get("jti")
    user_id = payload.get("sub")
    if not user_id:
        raise AuthenticationError(detail="Token inválido")

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
                if active.get("refresh_jti") != jti:
                    raise AuthenticationError(detail="Sessão encerrada. Faça login novamente.")
        except AuthenticationError:
            raise
        except Exception as e:
            import logging

            logging.getLogger(__name__).warning(
                "Redis unavailable for refresh token check: %s", str(e)
            )

    user = await get_user_by_id(db, int(user_id))
    if not user or not user.is_active:
        raise AuthenticationError(detail="Usuário não encontrado ou inativo")

    # Criar novos tokens e atualizar sessão ativa
    token_data = {"sub": str(user.id), "role": user.role, "store_id": user.store_id}
    new_access_token, new_access_jti = create_access_token(token_data)
    new_refresh_token, new_refresh_jti = create_refresh_token(token_data)

    try:
        import json

        import redis.asyncio as aioredis

        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        await _redis.setex(
            f"user_active_session:{user_id}",
            settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
            json.dumps({"access_jti": new_access_jti, "refresh_jti": new_refresh_jti}),
        )
        await _redis.aclose()
    except Exception as _e:
        import logging

        logging.getLogger(__name__).warning("Redis unavailable for session update: %s", str(_e))

    return LoginResponse(
        access_token=new_access_token,
        refresh_token=new_refresh_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        must_change_password=user.must_change_password,
    )


async def logout(
    db: AsyncSession,
    user: User,
    token: str,
    refresh_token: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> dict:
    """
    Revoga o access token JWT no Redis, opcionalmente revoga o refresh token,
    e registra o logout do usuário.
    """
    import redis.asyncio as aioredis
    from jose import JWTError

    try:
        redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)

        # Revogar access token
        try:
            payload = decode_token(token)
            jti = payload.get("jti")
            exp = payload.get("exp")
            if jti:
                ttl = max(1, int(exp - datetime.now(UTC).timestamp())) if exp else 3600
                await revoke_token_jti(redis_client, jti, ttl)
        except Exception:
            pass  # Melhor esforço: falha na revogação não impede o logout

        # Revogar refresh token se fornecido
        if refresh_token:
            try:
                from jose import jwt as jose_jwt

                rt_payload = jose_jwt.decode(
                    refresh_token,
                    settings.SECRET_KEY,
                    algorithms=[settings.ALGORITHM],
                )
                rt_jti = rt_payload.get("jti")
                rt_exp = rt_payload.get("exp")
                if rt_jti:
                    rt_ttl = (
                        max(1, int(rt_exp - datetime.now(UTC).timestamp()))
                        if rt_exp
                        else settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400
                    )
                    await revoke_token_jti(redis_client, rt_jti, rt_ttl)
            except (JWTError, Exception):
                pass  # Token inválido ou expirado: ignorar silenciosamente

        # Remover sessão ativa — libera o usuário para novo login limpo
        await redis_client.delete(f"user_active_session:{user.id}")

        await redis_client.aclose()
    except Exception:
        pass  # Redis indisponível: não bloquear o logout

    await log_access(
        db,
        user_id=user.id,
        action="logout",
        success=True,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    await log_audit(
        db=db,
        action="logout",
        resource_type="auth",
        user_id=user.id,
        resource_id=user.id,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    return {"message": "Logout realizado com sucesso"}


async def change_password(
    db: AsyncSession,
    user: User,
    data: PasswordChange,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> dict:
    """
    Altera a senha do usuário.

    Args:
        db: Sessão do banco de dados
        user: Usuário atual
        data: Dados da troca de senha

    Returns:
        Mensagem de sucesso

    Raises:
        AuthenticationError: Senha atual incorreta
        ValidationError: Nova senha igual à atual
    """
    # Verificar senha atual
    if not verify_password(data.current_password, user.hashed_password):
        await log_access(
            db,
            user_id=user.id,
            action="password_change_failed",
            success=False,
            ip_address=ip_address,
            user_agent=user_agent,
            details={"reason": "invalid_current_password"},
        )
        raise AuthenticationError(detail="Senha atual incorreta")

    # Verificar se a nova senha é diferente da atual
    if verify_password(data.new_password, user.hashed_password):
        raise ValidationError(detail="Nova senha deve ser diferente da atual")

    # Atualizar senha
    user.hashed_password = get_password_hash(data.new_password)
    user.must_change_password = False

    await log_access(
        db,
        user_id=user.id,
        action="password_change",
        success=True,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    await db.flush()

    return {"message": "Senha alterada com sucesso"}


async def create_user(
    db: AsyncSession,
    data: UserCreate,
    created_by: User,
) -> UserResponse:
    """
    Cria um novo usuário.

    Args:
        db: Sessão do banco de dados
        data: Dados do novo usuário
        created_by: Usuário que está criando

    Returns:
        UserResponse com dados do usuário criado

    Raises:
        ConflictError: Email já existe
    """
    # Verificar se email já existe
    existing = await get_user_by_email(db, data.email)
    if existing:
        raise ConflictError(detail=f"Email {data.email} já cadastrado")

    # Usuários com role "user" precisam de store_id
    if data.role.value == "user" and not data.store_id:
        from app.core.exceptions import ValidationError

        raise ValidationError(detail="store_id é obrigatório para usuários com role 'user'")

    # Criar usuário
    user = User(
        email=data.email.lower(),
        hashed_password=get_password_hash(data.password),
        full_name=data.full_name,
        role=data.role.value,
        store_id=data.store_id,
        must_change_password=True,
    )
    db.add(user)
    await db.flush()

    await db.refresh(user)

    # Construir response
    return UserResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        store_id=user.store_id,
        supervised_store_ids=data.supervised_store_ids,
        last_login=user.last_login,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


async def forgot_password(db: AsyncSession, email: str) -> dict:
    """
    Inicia o fluxo de recuperacao de senha.

    - Busca usuario por email
    - Gera token UUID com TTL de 1h no Redis
    - Nao revela se email existe (seguranca)

    Args:
        db: Sessao do banco de dados
        email: Email do usuario

    Returns:
        Dict com mensagem
    """
    from app.core.exceptions import ServiceUnavailableError

    user = await get_user_by_email(db, email)
    # Nao revelamos se o email existe
    if not user:
        return {"message": "Se o email existir, voce recebera as instrucoes"}

    token = uuid.uuid4().hex

    try:
        import redis.asyncio as aioredis

        redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        redis_key = f"password_reset:{token}"
        await redis_client.setex(redis_key, 3600, str(user.id))
        await redis_client.aclose()
    except Exception as e:
        raise ServiceUnavailableError(
            detail="Servico de recuperacao de senha temporariamente indisponivel"
        ) from e

    return {"message": "Se o email existir, voce recebera as instrucoes"}


async def reset_password_with_token(db: AsyncSession, token: str, new_password: str) -> dict:
    """
    Redefine a senha usando um token de reset.

    - Valida token no Redis
    - Atualiza senha com hash bcrypt
    - Invalida token apos uso

    Args:
        db: Sessao do banco de dados
        token: Token de reset gerado em forgot_password
        new_password: Nova senha em texto plano

    Returns:
        Dict com mensagem de sucesso

    Raises:
        AuthenticationError: Token invalido ou expirado
    """
    user_id: int | None = None

    # Tentar buscar token no Redis
    try:
        import redis.asyncio as aioredis

        redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
        redis_key = f"password_reset:{token}"
        user_id_str = await redis_client.get(redis_key)

        if not user_id_str:
            await redis_client.aclose()
            raise AuthenticationError(detail="Token invalido ou expirado")

        user_id = int(user_id_str)
        # Invalidar token imediatamente
        await redis_client.delete(redis_key)
        await redis_client.aclose()
    except AuthenticationError:
        raise
    except Exception as err:
        raise AuthenticationError(detail="Token invalido ou expirado") from err

    user = await get_user_by_id(db, user_id)
    if not user or not user.is_active:
        raise AuthenticationError(detail="Usuario nao encontrado ou inativo")

    user.hashed_password = get_password_hash(new_password)
    user.must_change_password = False
    user.failed_login_attempts = 0
    user.locked_until = None

    await db.commit()

    return {"message": "Senha redefinida com sucesso"}


async def update_profile(
    db: AsyncSession,
    user: User,
    full_name: str | None = None,
    phone: str | None = None,
) -> dict:
    """
    Atualiza dados do perfil do usuario autenticado.

    Args:
        db: Sessao do banco de dados
        user: Usuario atual (autenticado)
        full_name: Novo nome completo (opcional)

    Returns:
        Dict com dados atualizados do usuario
    """
    result = await db.execute(
        select(User).options(selectinload(User.store)).where(User.id == user.id)
    )
    db_user = result.scalar_one()

    if full_name is not None:
        db_user.full_name = full_name

    await db.commit()

    return await get_user_with_stores(db, db_user)


async def get_user_with_stores(db: AsyncSession, user: User) -> dict:
    """
    Obtém usuário com informações de lojas.
    """
    from app.modules.access_profiles.models import AccessProfile

    result = await db.execute(
        select(User)
        .options(
            selectinload(User.store),
            selectinload(User.access_profiles).selectinload(AccessProfile.stores),
        )
        .where(User.id == user.id)
    )
    user = result.scalar_one()

    supervised_ids = [s.id for s in user.supervised_stores]

    # Derivar store_id e lojas acessíveis a partir dos perfis de acesso
    store_id = user.store_id
    store_name = user.store.name if user.store else None
    accessible_store_ids: list[int] = []

    if user.role == "user":
        for profile in user.access_profiles:
            if profile.is_active:
                for store in profile.stores:
                    if store.id not in accessible_store_ids:
                        accessible_store_ids.append(store.id)

        # Se não há store_id direto, usar a primeira loja dos perfis ativos
        if store_id is None and accessible_store_ids:
            store_id = accessible_store_ids[0]
            for profile in user.access_profiles:
                if profile.is_active:
                    for store in profile.stores:
                        if store.id == store_id:
                            store_name = store.name
                            break

    from app.core.permissions import UserRole, get_role_permissions

    permissions = get_role_permissions(UserRole(user.role))

    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "is_active": user.is_active,
        "must_change_password": user.must_change_password,
        "store_id": store_id,
        "store_name": store_name,
        "supervised_store_ids": supervised_ids,
        "accessible_store_ids": accessible_store_ids,
        "last_login": user.last_login,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
        "permissions": permissions,
    }
