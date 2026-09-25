"""
Custom exceptions for AEMS application.
Exceções personalizadas com suporte a códigos HTTP apropriados.
"""

from fastapi import HTTPException, status


class AEMSException(HTTPException):
    """Base exception for all AEMS errors."""

    def __init__(
        self,
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail: str = "Erro interno do servidor",
        headers: dict[str, str] | None = None,
    ):
        super().__init__(status_code=status_code, detail=detail, headers=headers)


class AuthenticationError(AEMSException):
    """Erro de autenticação - credenciais inválidas ou token expirado."""

    def __init__(self, detail: str = "Credenciais inválidas"):
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        )


class AuthorizationError(AEMSException):
    """Erro de autorização - usuário não tem permissão para o recurso."""

    def __init__(self, detail: str = "Acesso não autorizado"):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
        )


class NotFoundError(AEMSException):
    """Recurso não encontrado."""

    def __init__(self, resource: str = "Recurso", detail: str | None = None):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail or f"{resource} não encontrado",
        )


class ValidationError(AEMSException):
    """Erro de validação de dados."""

    def __init__(self, detail: str = "Dados inválidos"):
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail,
        )


class ConflictError(AEMSException):
    """Conflito - recurso já existe ou operação inválida."""

    def __init__(self, detail: str = "Conflito com recurso existente"):
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail,
        )


class ServiceUnavailableError(AEMSException):
    """Serviço externo temporariamente indisponível (ex: Redis, e-mail)."""

    def __init__(self, detail: str = "Serviço temporariamente indisponível"):
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=detail,
        )
