"""
FastAPI application entry point.
Configura a aplicação, middlewares, CORS e routers.
"""

import asyncio
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.exceptions import AEMSException
from app.core.logging import get_logger, setup_logging
from app.core.middleware import (
    CSRFProtectionMiddleware,
    RequestIDMiddleware,
    SecurityHeadersMiddleware,
)
from app.core.rate_limit import limiter
from app.db.session import get_db

# Import routers - Phase 6 (New modules)
from app.modules.access_profiles.router import me_router as access_profiles_me_router
from app.modules.access_profiles.router import router as access_profiles_router
from app.modules.analytics.router import router as analytics_router
from app.modules.audit_logs.router import router as audit_logs_router

# Import routers - Phase 1
from app.modules.auth.router import router as auth_router
from app.modules.brands.router import router as brands_router
from app.modules.consultants.router import router as consultants_router
from app.modules.dealerships.router import router as dealerships_router
from app.modules.ebook.router import router as ebook_router
from app.modules.employees.router import router as employees_router
from app.modules.epi.router import router as epi_router
from app.modules.holidays.router import router as holidays_router
from app.modules.installer_performance.router import router as installer_performance_router
from app.modules.inventory.router import film_types_router, inventory_router
from app.modules.material_requests.router import router as material_requests_router
from app.modules.notifications.router import router as notifications_router
from app.modules.push.router import router as push_router
from app.modules.scheduling.router import router as scheduling_router
from app.modules.service_orders.router import router as service_orders_router
from app.modules.services.router import router as services_router
from app.modules.settings.router import router as settings_router
from app.modules.stores.router import router as stores_router
from app.modules.time_clock.router import router as time_clock_router
from app.modules.upload.router import router as upload_router
from app.modules.users.router import router as users_router
from app.modules.vehicle_models.router import router as vehicle_models_router

settings = get_settings()
logger = get_logger(__name__)


async def _queue_broadcast_loop() -> None:
    from app.websocket.manager import manager

    while True:
        await asyncio.sleep(30)
        # Sem clientes conectados não há quem receber — evita serializar/emitir à toa
        if manager.get_connection_count() == 0:
            continue
        await manager.broadcast_to_all("semaphore_updated", {})


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifecycle manager para a aplicação.
    Executado na inicialização e encerramento.
    """
    # Startup
    setup_logging(debug=settings.DEBUG)
    logger.info(f"Starting {settings.APP_NAME}...")
    broadcast_task = asyncio.create_task(_queue_broadcast_loop())
    yield
    # Shutdown
    broadcast_task.cancel()
    from app.core.redis import close_redis

    await close_redis()
    logger.info(f"Shutting down {settings.APP_NAME}...")


# Create FastAPI application
app = FastAPI(
    title=settings.APP_NAME,
    description="API do Sistema de Gestão para Rede de Estética Automotiva",
    version="1.0.0",
    docs_url=f"{settings.API_V1_PREFIX}/docs" if settings.DEBUG else None,
    redoc_url=f"{settings.API_V1_PREFIX}/redoc" if settings.DEBUG else None,
    openapi_url=f"{settings.API_V1_PREFIX}/openapi.json" if settings.DEBUG else None,
    lifespan=lifespan,
)

# Rate Limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# Security Headers Middleware
app.add_middleware(SecurityHeadersMiddleware)

# Request ID Middleware
app.add_middleware(RequestIDMiddleware)

# CSRF Protection Middleware (Origin/Referer validation for state-changing methods)
# Registered after CORS so that preflight OPTIONS requests are already handled
# before CSRF inspection runs.  Starlette applies middlewares in reverse
# registration order, meaning this middleware actually executes BEFORE
# SecurityHeaders and RequestID but AFTER CORSMiddleware at runtime.
app.add_middleware(
    CSRFProtectionMiddleware,
    allowed_origins=settings.ALLOWED_ORIGINS,
    debug=settings.DEBUG,
    enabled=settings.CSRF_ENABLED,
)

app.add_middleware(GZipMiddleware, minimum_size=500)


# Exception handlers
@app.exception_handler(AEMSException)
async def aems_exception_handler(request: Request, exc: AEMSException):
    """Handler para exceções customizadas do AEMS."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=exc.headers,
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handler para exceções não tratadas."""
    if settings.DEBUG:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": str(exc), "type": type(exc).__name__},
        )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Erro interno do servidor"},
    )


# Health check endpoint
@app.get("/health", tags=["Health"])
async def health_check(db: AsyncSession = Depends(get_db)):
    """Endpoint para verificação de saúde da API."""
    from sqlalchemy import text

    checks = {}

    # Verificar banco de dados
    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:
        checks["database"] = "error"

    # Verificar Redis (ping + pressão de memória)
    # Com maxmemory-policy=noeviction, encher a memória bloqueia escritas
    # (sessões novas, fila Celery) — reportar "degraded" a partir de 90% dá
    # sinal ANTES da falha, visível para uptime monitors que consultam /health.
    try:
        from app.core.redis import get_redis

        redis_client = get_redis()
        await redis_client.ping()  # type: ignore[misc]
        info = await redis_client.info("memory")
        used = int(info.get("used_memory", 0))
        maxmem = int(info.get("maxmemory", 0))
        if maxmem > 0:
            pct = round(used / maxmem * 100, 1)
            checks["redis_memory"] = f"{pct}%"
            checks["redis"] = "ok" if pct < 90 else "memory_pressure"
        else:
            checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "error"

    # redis_memory é informativo (percentual), não entra no veredito direto
    status_values = [v for k, v in checks.items() if k != "redis_memory"]
    overall = "healthy" if all(v == "ok" for v in status_values) else "degraded"
    return {"status": overall, "checks": checks}


# Root endpoint
@app.get("/", tags=["Root"])
async def root():
    """Endpoint raiz com informações básicas da API."""
    if not settings.DEBUG:
        return {"status": "ok"}
    return {
        "message": f"Bem-vindo ao {settings.APP_NAME}",
        "docs": f"{settings.API_V1_PREFIX}/docs",
        "version": "1.0.0",
    }


# Register routers - Phase 1
app.include_router(auth_router, prefix=settings.API_V1_PREFIX)
app.include_router(stores_router, prefix=settings.API_V1_PREFIX)
app.include_router(users_router, prefix=settings.API_V1_PREFIX)

# Register routers - Phase 2 (Service Orders)
app.include_router(dealerships_router, prefix=settings.API_V1_PREFIX)
app.include_router(consultants_router, prefix=settings.API_V1_PREFIX)
app.include_router(services_router, prefix=settings.API_V1_PREFIX)
app.include_router(service_orders_router, prefix=settings.API_V1_PREFIX)

# Register routers - Phase 6 (New modules)
app.include_router(upload_router, prefix=settings.API_V1_PREFIX)
app.include_router(analytics_router, prefix=settings.API_V1_PREFIX)
app.include_router(notifications_router, prefix=settings.API_V1_PREFIX)
app.include_router(push_router, prefix=settings.API_V1_PREFIX)
app.include_router(employees_router, prefix=settings.API_V1_PREFIX)
app.include_router(vehicle_models_router, prefix=settings.API_V1_PREFIX)
app.include_router(brands_router, prefix=settings.API_V1_PREFIX)
app.include_router(ebook_router, prefix=settings.API_V1_PREFIX)
app.include_router(epi_router, prefix=settings.API_V1_PREFIX)
app.include_router(installer_performance_router, prefix=settings.API_V1_PREFIX)
app.include_router(holidays_router, prefix=settings.API_V1_PREFIX)
app.include_router(time_clock_router, prefix=settings.API_V1_PREFIX)
app.include_router(access_profiles_router, prefix=settings.API_V1_PREFIX)
app.include_router(access_profiles_me_router, prefix=settings.API_V1_PREFIX)
app.include_router(settings_router, prefix=settings.API_V1_PREFIX)

# Register routers - Phase 7 (Inventory)
app.include_router(film_types_router, prefix=settings.API_V1_PREFIX)
app.include_router(inventory_router, prefix=settings.API_V1_PREFIX)
app.include_router(material_requests_router, prefix=settings.API_V1_PREFIX)

# Register routers - Phase 8 (Scheduling)
app.include_router(scheduling_router, prefix=settings.API_V1_PREFIX)

# Register routers - Auditoria
app.include_router(audit_logs_router, prefix=settings.API_V1_PREFIX)

# Register routers - Phase 9 (Suppliers)
from app.modules.suppliers.router import router as suppliers_router  # noqa: E402
from app.websocket.router import router as websocket_router  # noqa: E402

app.include_router(suppliers_router, prefix=settings.API_V1_PREFIX)

# WebSocket — sem prefixo de versão (rotas em /ws/... e /ws/status)
app.include_router(websocket_router)


# Serve arquivos de upload locais (dev e produção sem S3)
from pathlib import Path  # noqa: E402

from fastapi.staticfiles import StaticFiles  # noqa: E402

_uploads_dir = Path("uploads")
_uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")
