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
    # Postura quando o Redis está indisponível na checagem de revogação/sessão:
    #  - False (padrão): fail-OPEN — autentica mesmo sem conseguir checar o Redis
    #    (disponibilidade acima de revogação; não transforma o Redis em SPOF de auth).
    #  - True: fail-CLOSED — nega o acesso se não der para checar a blacklist
    #    (revogação garantida; exige Redis em alta disponibilidade). Recomendado em
    #    produção com Redis HA.
    TOKEN_REVOCATION_FAIL_CLOSED: bool = False
    # Validade do token de mídia (servir fotos). Curto por padrão para limitar a
    # janela de um link de foto vazado (as URLs trafegam e podem ser logadas).
    MEDIA_TOKEN_EXPIRE_HOURS: int = 12

    # Rate Limiting
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_DEFAULT: str = "100/minute"
    RATE_LIMIT_LOGIN: str = "5/minute"
    RATE_LIMIT_REFRESH: str = "10/minute"

    # URL base da aplicação (usada para construir URLs absolutas de uploads locais)
    BASE_URL: str = "http://localhost:8000"

    # URL pública do frontend (usada para montar links de e-mail: reset de senha,
    # boas-vindas). Em dev: http://localhost:5173. Em prod/HML: URL do site.
    FRONTEND_URL: str = "http://localhost:5173"

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

    # Web Push (VAPID) — PWA. Gerar chaves: venv/Scripts/vapid.exe --gen
    # (ou: python -c "from py_vapid import Vapid; v=Vapid(); v.generate_keys(); ...")
    WEB_PUSH_ENABLED: bool = True
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_CLAIMS_EMAIL: str = "mailto:admin@aems.example.com"

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

    # Feature flags
    # Ponto eletrônico: desligado o módulo responde 404 e os lembretes do
    # Celery beat não disparam (usado para manter o ponto só no HML).
    TIME_CLOCK_ENABLED: bool = True
    # E-book: desligado o módulo responde 404 (usado para manter o e-book só no
    # HML enquanto está em teste). O frontend espelha via VITE_EBOOK_ENABLED.
    EBOOK_ENABLED: bool = True
    # EPI: desligado o módulo responde 404 (usado para manter o controle de EPIs
    # só no HML enquanto está em teste). O frontend espelha via VITE_EPI_ENABLED.
    EPI_ENABLED: bool = True

    # Ponto — dados do empregador para os arquivos fiscais AFD/AEJ (Portaria 671).
    # Este é um controle interno: o AFD/AEJ é gerado SEM assinatura ICP-Brasil.
    # Preencha para gerar arquivos com identificadores válidos; vazio → zero-fill
    # (arquivo estruturalmente compatível, porém com identificadores incompletos).
    EMPLOYER_ID_TYPE: str = "1"  # 1=CNPJ, 2=CPF
    EMPLOYER_CNPJ: str = ""  # 14 dígitos do empregador
    EMPLOYER_NAME: str = ""  # razão social/nome do empregador
    EMPLOYER_INPI: str = ""  # registro do programa no INPI (REP-P, Art. 91), se houver
    DEVELOPER_ID_TYPE: str = "1"  # 1=CNPJ, 2=CPF (desenvolvedor do programa)
    DEVELOPER_CNPJ: str = ""  # 14 dígitos do desenvolvedor

    # Ponto: tolerância de relógio para batidas offline (Opção A / REP-A).
    OFFLINE_CLOCK_SKEW_MINUTES: int = 5  # quanto o device pode adiantar do servidor
    OFFLINE_MAX_AGE_DAYS: int = 7  # atraso máximo aceito entre marcação e sync
    # Sinaliza no espelho quando o intervalo marcação→sync passa deste limite
    # (batida offline sincronizada muito depois — conferência do RH contra backdating).
    OFFLINE_SYNC_ALERT_HOURS: int = 24
    TIME_CLOCK_SYSTEM_ID: str = "AEMS-REP-A"  # identificador interno do sistema (sem INPI)

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
