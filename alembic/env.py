"""
Alembic environment configuration.
Configura migrations assíncronas com SQLAlchemy.
"""

import asyncio
from logging.config import fileConfig

import sqlalchemy as sa
from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.config import get_settings
from app.db.base import Base

# Import all models to ensure they are registered with Base.metadata
from app.core.audit import AuditLog  # noqa: F401
from app.modules.auth.models import AccessLog, User  # noqa: F401
from app.modules.brands.models import Brand  # noqa: F401
from app.modules.access_profiles.models import (  # noqa: F401
    AccessProfile,
    AccessProfileModulePermission,
    access_profile_stores,
    access_profile_users,
)
from app.modules.consultants.models import Consultant  # noqa: F401
from app.modules.dealerships.models import Dealership  # noqa: F401
from app.modules.employees.models import Employee  # noqa: F401
from app.modules.notifications.models import Notification  # noqa: F401
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem, ServiceOrderWorker, StatusHistory  # noqa: F401
from app.modules.services.models import Service  # noqa: F401
from app.modules.stores.models import Store  # noqa: F401
from app.modules.vehicle_models.models import VehicleModel  # noqa: F401
from app.modules.inventory.models import FilmType, FilmTypeService, FilmRoll, FilmConsumption  # noqa: F401

# this is the Alembic Config object
config = context.config

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Set target metadata for 'autogenerate' support
target_metadata = Base.metadata

# Get database URL from settings
settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        version_table_pk_type=sa.String(64),
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations in 'online' mode with async engine."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
