"""
Auth router - API endpoints for authentication.
"""

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.permissions import UserRole, require_roles
from app.core.rate_limit import limiter
from app.core.security import (
    get_client_ip,
    get_current_user,
    get_user_agent,
    oauth2_scheme,
)
from app.db.session import get_db
from app.modules.auth import service
from app.modules.auth.schemas import (
    ForgotPasswordRequest,
    LoginResponse,
    LogoutRequest,
    PasswordChange,
    PasswordReset,
    RefreshTokenRequest,
    UserCreate,
    UserMeResponse,
    UserResponse,
)


class ProfileUpdate(BaseModel):
    """Schema para atualizacao de perfil do usuario."""

    full_name: str | None = Field(None, min_length=2, max_length=255)
    phone: str | None = Field(None, max_length=30)


settings = get_settings()

router = APIRouter(prefix="/auth", tags=["Authentication"])


def _set_media_cookie(response: Response, login_result) -> None:
    """
    Emite o cookie httpOnly de acesso a mídia (fotos em /uploads).

    O Nginx valida este cookie via auth_request antes de servir cada imagem —
    fecha o acesso público às fotos (ALTO-2 da auditoria) sem mudar nenhuma
    URL: <img> envia cookie automaticamente no mesmo domínio.
    """
    from app.core.security import create_media_token, decode_token

    user_id = int(decode_token(login_result.access_token)["sub"])
    response.set_cookie(
        key="aems_media",
        value=create_media_token(user_id),
        max_age=settings.MEDIA_TOKEN_EXPIRE_HOURS * 3600,
        path="/uploads",
        httponly=True,
        secure=not settings.DEBUG,
        samesite="lax",
    )


@router.post("/login", response_model=LoginResponse)
@limiter.limit(settings.RATE_LIMIT_LOGIN)
async def login(
    request: Request,
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    """
    Autenticação com email e senha.

    - Valida credenciais
    - Protegido por rate-limit por IP (RATE_LIMIT_LOGIN); tentativas falhas são
      apenas contabilizadas para auditoria (não há bloqueio automático da conta)
    - Retorna JWT access token (8h) + refresh token (7d)

    Usar OAuth2PasswordRequestForm:
    - username: email do usuário
    - password: senha
    """
    result = await service.authenticate(
        db=db,
        email=form_data.username,
        password=form_data.password,
        ip_address=get_client_ip(request),
        user_agent=get_user_agent(request),
    )
    _set_media_cookie(response, result)
    return result


@router.post("/refresh", response_model=LoginResponse)
@limiter.limit(settings.RATE_LIMIT_REFRESH)
async def refresh_token(
    request: Request,
    response: Response,
    data: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Renova access token usando refresh token válido.

    Enviar no body:
    - refresh_token: token de refresh obtido no login
    """
    result = await service.refresh_access_token(db=db, refresh_token=data.refresh_token)
    _set_media_cookie(response, result)
    return result


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    request_data: LogoutRequest = LogoutRequest(),
    token: str = Depends(oauth2_scheme),
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Revoga tokens do usuário e registra logout.
    Requer autenticação (Bearer token).

    Body opcional:
    - refresh_token: se fornecido, o refresh token também é adicionado à blacklist.
    """
    result = await service.logout(
        db=db,
        user=current_user,
        token=token,
        refresh_token=request_data.refresh_token,
        ip_address=get_client_ip(request),
        user_agent=get_user_agent(request),
    )
    response.delete_cookie(key="aems_media", path="/uploads")
    return result


@router.post("/change-password")
async def change_password(
    request: Request,
    data: PasswordChange,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Troca de senha do usuário autenticado.

    - Obrigatória no primeiro acesso (must_change_password=true)
    - Pode ser feita voluntariamente a qualquer momento
    - Nova senha deve ter no mínimo 8 caracteres
    """
    return await service.change_password(
        db=db,
        user=current_user,
        data=data,
        ip_address=get_client_ip(request),
        user_agent=get_user_agent(request),
    )


@router.get("/me", response_model=UserMeResponse)
async def get_current_user_info(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Retorna informações do usuário autenticado.

    Inclui:
    - Dados básicos do usuário
    - Nome da loja (se vinculado)
    - Lista de permissões baseadas no role
    """
    user_data = await service.get_user_with_stores(db, current_user)
    return UserMeResponse(**user_data)


@router.post("/forgot-password", summary="Solicitar redefinicao de senha")
@limiter.limit(settings.RATE_LIMIT_LOGIN)
async def forgot_password(
    request: Request,
    data: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Inicia o fluxo de recuperacao de senha.

    - Gera token UUID, armazena no Redis com TTL de 1h
    - Nao revela se o email existe por seguranca
    """
    return await service.forgot_password(db=db, email=data.email)


@router.post("/reset-password", summary="Redefinir senha com token")
@limiter.limit(settings.RATE_LIMIT_LOGIN)
async def reset_password(
    request: Request,
    data: PasswordReset,
    db: AsyncSession = Depends(get_db),
):
    """
    Redefine a senha usando o token recebido.

    - Valida token no Redis
    - Atualiza senha com hash bcrypt
    - Invalida token apos uso
    """
    return await service.reset_password_with_token(
        db=db, token=data.token, new_password=data.new_password
    )


@router.patch("/profile", response_model=UserMeResponse, summary="Atualizar perfil")
async def update_profile(
    data: ProfileUpdate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Atualiza dados do perfil do usuario autenticado.

    Campos atualizaveis: full_name, phone.
    Email nao pode ser alterado aqui por seguranca.

    Body (JSON):
    - full_name (str, opcional)
    - phone (str, opcional)
    """
    user_data = await service.update_profile(
        db=db,
        user=current_user,
        full_name=data.full_name,
        phone=data.phone,
    )
    return UserMeResponse(**user_data)


# User management endpoints (for admin/owner)
@router.post(
    "/users",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(UserRole.OWNER))],
)
async def create_user(
    data: UserCreate,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Cria um novo usuário.

    Apenas owners podem criar usuários.
    O novo usuário receberá must_change_password=true.
    """
    return await service.create_user(
        db=db,
        data=data,
        created_by=current_user,
    )
