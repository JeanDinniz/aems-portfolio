"""
Database session configuration.
Configura o engine async e session factory do SQLAlchemy.
"""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

settings = get_settings()

# Engine assíncrono do SQLAlchemy
engine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=settings.DATABASE_POOL_SIZE,
    max_overflow=settings.DATABASE_MAX_OVERFLOW,
    echo=settings.DEBUG,  # Log SQL queries in debug mode
    pool_recycle=3600,  # recycle connections after 1 hour
    pool_timeout=30,  # timeout to acquire connection from pool
    pool_pre_ping=True,  # test connection before using it
)

# Session factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency para injetar sessão do banco nas rotas.

    Uso:
        @router.get("/items")
        async def get_items(db: AsyncSession = Depends(get_db)):
            ...
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
            # Bump pós-commit: só dispara se algum service marcou a flag
            # (session.info["bump_analytics"]) durante a transação. Centraliza
            # a invalidação do cache de analytics aqui — depois do commit real
            # (não do commit interno de um service) — para nunca invalidar
            # antes do dado estar persistido. Import local evita ciclo.
            if session.info.pop("bump_analytics", False):
                from app.core.redis import bump_analytics_cache

                await bump_analytics_cache()
            # Mesmo mecanismo para o cache dos catálogos de referência (tipos de
            # película, consultores, funcionários) consumidos pelo editor de O.S.
            if session.info.pop("bump_catalogs", False):
                from app.core.redis import bump_catalogs_cache

                await bump_catalogs_cache()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
