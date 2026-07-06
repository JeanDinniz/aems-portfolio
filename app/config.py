"""
Configurações da aplicação usando pydantic-settings.
Carrega variáveis de ambiente do arquivo .env.
"""

from functools import lru_cache

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configurações globais da aplicação."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # App
    APP_NAME: str = "AEMS API"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"

    # Database
    DATABASE_URL: str
    DATABASE_POOL_SIZE: int = 10
    DATABASE_MAX_OVERFLOW: int = 20

    # Redis
    REDIS_URL: str = "redis://localhost:6380/0"

    # Auth - SECRET_KEY é obrigatória e deve ser definida via variável de ambiente
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30  # 30 minutes (production safe default)
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ALGORITHM: str = "HS256"

    # Login Security
    MAX_LOGIN_ATTEMPTS: int = 5
    LOCKOUT_DURATION_MINUTES: int = 30

    # Rate Limiting
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_DEFAULT: str = "100/minute"
    RATE_LIMIT_LOGIN: str = "5/minute"
    RATE_LIMIT_REFRESH: str = "10/minute"

    # URL base da aplicação (usada para construir URLs absolutas de uploads locais)
    BASE_URL: str = "http://localhost:8000"

    # Storage (S3/MinIO)
    S3_BUCKET: str = "aems-files"
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_ENDPOINT: str | None = None
    # URL pública do MinIO/S3 (usada para gerar links acessíveis pelo browser).
    # Em dev com Docker: http://localhost:9000. Em prod: URL pública do bucket.
    # Se não definida, usa S3_ENDPOINT como fallback.
    S3_PUBLIC_URL: str | None = None

    # Email
    SENDGRID_API_KEY: str = ""
    FROM_EMAIL: str = "noreply@aems.com.br"

    # Firebase (opcional)
    FIREBASE_CREDENTIALS_PATH: str | None = None

    # Expo Push Notifications
    EXPO_PUSH_URL: str = "https://exp.host/--/api/v2/push/send"
    EXPO_ACCESS_TOKEN: str | None = None
    PUSH_ENABLED: bool = True

    # CORS
    ALLOWED_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ]

    # CSRF Protection
    # Validates Origin/Referer headers on state-changing requests.
    # Can be set to False in test environments via CSRF_ENABLED=false env var.
    CSRF_ENABLED: bool = True

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        """
        Valida que SECRET_KEY não está usando valores padrão inseguros.

        Raises:
            ValueError: Se SECRET_KEY estiver vazia ou usar valor padrão.
        """
        if not v or len(v.strip()) == 0:
            raise ValueError(
                "SECRET_KEY não pode estar vazia. Defina SECRET_KEY como variável de ambiente."
            )

        # Lista de valores padrão/inseguros conhecidos (em lowercase)
        insecure_values = {
            "change-this-secret-key-in-production",
            "development-secret-key-change-in-production",
            "sua-chave-secreta-aqui-mude-em-producao",
            "secret",
            "secret-key",
            "secretkey",
            "mysecret",
            "change-me",
            "changeme",
        }

        if v.lower() in insecure_values:
            raise ValueError(
                f"SECRET_KEY está usando um valor padrão inseguro: '{v}'. "
                "Gere uma chave segura com: "
                'python -c "import secrets; print(secrets.token_urlsafe(32))"'
            )

        # Sempre exigir no mínimo 32 caracteres para segurança
        if len(v) < 32:
            raise ValueError(
                "SECRET_KEY deve ter no mínimo 32 caracteres. "
                f"Tamanho atual: {len(v)} caracteres. "
                "Gere uma chave segura com: "
                'python -c "import secrets; print(secrets.token_urlsafe(32))"'
            )

        return v

    @model_validator(mode="after")
    def validate_origins_not_localhost_in_production(self) -> "Settings":
        """
        Bloqueia origens de desenvolvimento (localhost/127.0.0.1) quando DEBUG=False.

        Raises:
            ValueError: Se ALLOWED_ORIGINS contiver localhost ou 127.0.0.1 em produção.
        """
        if not self.DEBUG:
            dev_origins = [o for o in self.ALLOWED_ORIGINS if "localhost" in o or "127.0.0.1" in o]
            if dev_origins:
                raise ValueError(
                    "ALLOWED_ORIGINS contém origens de desenvolvimento "
                    "(localhost/127.0.0.1) com DEBUG=False. "
                    "Configure origens de produção."
                )
        return self


@lru_cache
def get_settings() -> Settings:
    """
    Retorna instância cacheada das configurações.
    Usar @lru_cache garante que as configurações são carregadas apenas uma vez.
    """
    return Settings()
