"""
Pytest fixtures for AEMS tests.
Configura banco de testes em memória e fixtures comuns.
"""

import os

# Configurar variáveis de ambiente ANTES de qualquer import do app
# (get_settings() usa @lru_cache, então precisa estar configurado antes do primeiro uso)
if "SECRET_KEY" not in os.environ:
    os.environ["SECRET_KEY"] = "test-secret-key-with-at-least-32-characters-for-testing-purposes"
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["CSRF_ENABLED"] = "false"
# DEBUG=true desliga o cache de leitura dos Indicadores (analytics/router._cached):
# sem isso o cache (Redis, TTL 30s) é reutilizado entre testes que compartilham
# período+escopo+filtros e contamina resultados (flakiness). É o modo que o próprio
# _cached documenta para a suíte. Só relaxa o validador de origens de produção.
os.environ["DEBUG"] = "true"

from collections.abc import AsyncGenerator  # noqa: E402

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.security import get_password_hash  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.modules.access_profiles.models import (  # noqa: E402
    AccessProfile,
    AccessProfileModulePermission,
    access_profile_users,
)
from app.modules.auth.models import User  # noqa: E402
from app.modules.brands.models import Brand  # noqa: E402
from app.modules.stores.models import Store  # noqa: E402

# Use SQLite in-memory for tests
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

# Strong password constants that satisfy validate_password_strength
# (uppercase, lowercase, digit, special character, >= 8 chars)
VALID_TEST_PASSWORD = "TestPass123!@"
VALID_OWNER_PASSWORD = "OwnerPass123!@"


def _register_sqlite_functions(dbapi_connection, connection_record):
    """Register PostgreSQL-compatible functions for SQLite test engine."""
    dbapi_connection.create_function("to_char", 2, lambda dt, fmt: dt[:7] if dt else None)


@pytest_asyncio.fixture(scope="function")
async def db_engine():
    """Create test database engine."""
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
    )

    from sqlalchemy import event

    event.listen(engine.sync_engine, "connect", _register_sqlite_functions)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def db_session(db_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create test database session."""
    async_session = async_sessionmaker(
        bind=db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

    async with async_session() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Create test HTTP client with database override."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def test_brand(db_session: AsyncSession) -> Brand:
    """Create a test brand (Toyota)."""
    brand = Brand(
        name="Toyota",
        code="toyota",
        is_active=True,
    )
    db_session.add(brand)
    await db_session.commit()
    await db_session.refresh(brand)
    return brand


@pytest_asyncio.fixture
async def test_store(db_session: AsyncSession, test_brand: Brand) -> Store:
    """Create a test store."""
    store = Store(
        name="Loja Teste 01",
        code="LJ01",
        address="Rua Teste, 123",
        phone="11999999999",
        is_active=True,
        brand_id=test_brand.id,
    )
    db_session.add(store)
    await db_session.commit()
    await db_session.refresh(store)
    return store


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession, test_store: Store) -> User:
    """Create a test user."""
    user = User(
        email="user@test.com",
        hashed_password=get_password_hash(VALID_TEST_PASSWORD),
        full_name="Test User",
        role="user",
        store_id=test_store.id,
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_user_profile(db_session: AsyncSession, test_user: User, test_store: Store):
    """Create an access profile with full service_orders permission for test_user."""
    profile = AccessProfile(
        name="Test Profile",
        is_active=True,
    )
    db_session.add(profile)
    await db_session.flush()

    permission = AccessProfileModulePermission(
        profile_id=profile.id,
        module_group="OPERACIONAL",
        sub_module="service_orders",
        can_view=True,
        can_edit=True,
        can_delete=True,
    )
    db_session.add(permission)
    await db_session.flush()

    await db_session.execute(
        access_profile_users.insert().values(profile_id=profile.id, user_id=test_user.id)
    )
    await db_session.commit()
    return profile


@pytest_asyncio.fixture
async def test_owner(db_session: AsyncSession) -> User:
    """Create a test owner user."""
    user = User(
        email="owner@test.com",
        hashed_password=get_password_hash(VALID_OWNER_PASSWORD),
        full_name="Test Owner",
        role="owner",
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def authenticated_client(
    client: AsyncClient, test_user: User, test_user_profile
) -> AsyncClient:
    """Create authenticated client with user token and access profile."""
    response = await client.post(
        "/api/v1/auth/login",
        data={"username": "user@test.com", "password": VALID_TEST_PASSWORD},
    )
    token = response.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"
    return client


@pytest_asyncio.fixture
async def owner_client(client: AsyncClient, test_owner: User) -> AsyncClient:
    """Create authenticated client with owner user token."""
    response = await client.post(
        "/api/v1/auth/login",
        data={"username": "owner@test.com", "password": VALID_OWNER_PASSWORD},
    )
    token = response.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"
    return client


@pytest_asyncio.fixture
async def test_employee(db_session: AsyncSession, test_store: Store):
    """Create a test employee (physical worker, no system login)."""
    from app.modules.employees.models import Employee

    employee = Employee(
        name="João Instalador",
        store_id=test_store.id,
        is_active=True,
    )
    db_session.add(employee)
    await db_session.commit()
    await db_session.refresh(employee)
    return employee


@pytest_asyncio.fixture
async def second_store(db_session: AsyncSession, test_brand: Brand) -> Store:
    """Create a second test store."""
    store = Store(
        name="Loja Teste 02",
        code="LJ02",
        address="Rua Teste 2, 456",
        phone="11888888888",
        is_active=True,
        brand_id=test_brand.id,
    )
    db_session.add(store)
    await db_session.commit()
    await db_session.refresh(store)
    return store


@pytest.fixture
def sync_client(db_session: AsyncSession):
    """Create synchronous test client for WebSocket testing."""
    from contextlib import contextmanager

    from fastapi.testclient import TestClient

    # Override get_db dependency for sync client
    @contextmanager
    def override_get_db():
        # Yield the async session directly - TestClient will handle the async context
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
