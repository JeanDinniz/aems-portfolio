"""
Script to create initial owner user and stores.
Run: python scripts/seed_owner.py
"""

import asyncio
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings
from app.core.security import get_password_hash
from app.db.base import Base

# Import ALL models to ensure SQLAlchemy can resolve relationships
from app.modules.auth.models import AccessLog, User  # noqa: F401
from app.modules.brands.models import Brand  # noqa: F401
from app.modules.access_profiles.models import AccessProfile, AccessProfileModulePermission, access_profile_stores, access_profile_users  # noqa: F401
from app.modules.consultants.models import Consultant  # noqa: F401
from app.modules.dealerships.models import Dealership  # noqa: F401
from app.modules.employees.models import Employee  # noqa: F401
from app.modules.notifications.models import Notification  # noqa: F401
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem, ServiceOrderWorker, StatusHistory  # noqa: F401
from app.modules.services.models import Service  # noqa: F401
from app.modules.stores.models import Store
from app.modules.vehicle_models.models import VehicleModel  # noqa: F401
from app.modules.inventory.models import FilmType, FilmTypeService, FilmRoll, FilmConsumption  # noqa: F401
from app.modules.suppliers.models import Supplier  # noqa: F401
from app.core.audit import AuditLog  # noqa: F401
settings = get_settings()

# Store names mapping by store number
STORE_NAMES = {
    1: "Toyota Unidade 01",
    2: "Toyota Unidade 02",
    3: "Toyota Unidade 03",
    4: "BYD Unidade 04",
    5: "BYD Unidade 05",
    6: "BYD Unidade 06",
    7: "BYD Unidade 07",
    8: "BYD Unidade 08",
    9: "Hyundai Unidade 09",
    10: "Hyundai Unidade 10",
    11: "Fiat Unidade 11",
    12: "Fiat Unidade 12",
}

# Lojas adicionais que não são concessionárias (sem dealership vinculado)
EXTRA_STORES = [
    {
        "name": "Galpão Central",
        "code": "GP01",
        "brand": "Toyota",
        "is_galpon_store": True,
        "address": "Central",
    },
]

# Dealership data: extract brand from store name
DEALERSHIP_DATA = {
    1: {"brand": "Toyota", "name": "Concessionária Toyota Unidade 01"},
    2: {"brand": "Toyota", "name": "Concessionária Toyota Unidade 02"},
    3: {"brand": "Toyota", "name": "Concessionária Toyota Unidade 03"},
    4: {"brand": "BYD", "name": "Concessionária BYD Unidade 04"},
    5: {"brand": "BYD", "name": "Concessionária BYD Unidade 05"},
    6: {"brand": "BYD", "name": "Concessionária BYD Unidade 06"},
    7: {"brand": "BYD", "name": "Concessionária BYD Unidade 07"},
    8: {"brand": "BYD", "name": "Concessionária BYD Unidade 08"},
    9: {"brand": "Hyundai", "name": "Concessionária Hyundai Unidade 09"},
    10: {"brand": "Hyundai", "name": "Concessionária Hyundai Unidade 10"},
    11: {"brand": "Fiat", "name": "Concessionária Fiat Unidade 11"},
    12: {"brand": "Fiat", "name": "Concessionária Fiat Unidade 12"},
}


async def seed_database():
    """Seed database with initial data."""
    engine = create_async_engine(settings.DATABASE_URL, echo=True)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async_session = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with async_session() as session:
        # Check if owner already exists
        result = await session.execute(
            select(User).where(User.role == "owner")
        )
        if result.scalar_one_or_none():
            print("Owner user already exists. Skipping seed.")
            return

        # Create brands first (required FK for stores) — skip if already exist
        brand_data = [
            {"name": "Toyota", "code": "toyota"},
            {"name": "BYD", "code": "byd"},
            {"name": "Hyundai", "code": "hyundai"},
            {"name": "Fiat", "code": "fiat"},
        ]
        brands_map: dict[str, Brand] = {}
        for bd in brand_data:
            result = await session.execute(select(Brand).where(Brand.name == bd["name"]))
            existing = result.scalar_one_or_none()
            if existing:
                brands_map[bd["name"]] = existing
            else:
                brand = Brand(name=bd["name"], code=bd["code"], is_active=True)
                session.add(brand)
                brands_map[bd["name"]] = brand

        await session.flush()
        print(f"Brands ready: {list(brands_map.keys())}")

        # Determine brand for each store from its name
        def get_brand(store_name: str) -> Brand:
            for brand_name in brands_map:
                if store_name.startswith(brand_name):
                    return brands_map[brand_name]
            raise ValueError(f"No brand found for store: {store_name}")

        # Create initial stores (12 dealership stores as per spec)
        stores = []
        for i in range(1, 13):
            name = STORE_NAMES[i]
            store = Store(
                name=name,
                code=f"LJ{i:02d}",
                address=f"Endereço da Loja {i:02d}",
                is_active=True,
                brand_id=get_brand(name).id,
            )
            stores.append(store)
            session.add(store)

        await session.flush()
        print(f"Created {len(stores)} stores (12 dealership)")

        # Create extra non-dealership stores (galpão, wash center, etc.)
        for extra in EXTRA_STORES:
            brand_obj = brands_map.get(extra["brand"])
            if not brand_obj:
                continue
            extra_store = Store(
                name=extra["name"],
                code=extra["code"],
                address=extra.get("address"),
                is_galpon_store=extra.get("is_galpon_store", False),
                brand_id=brand_obj.id,
                is_active=True,
            )
            session.add(extra_store)
        await session.flush()
        print(f"Created {len(EXTRA_STORES)} extra stores")

        # Create dealerships for each dealership store
        dealerships = []
        for i in range(1, 13):
            store = stores[i - 1]
            dealership_info = DEALERSHIP_DATA[i]
            dealership = Dealership(
                name=dealership_info["name"],
                store_id=store.id,
                brand=dealership_info["brand"],
                address=f"Endereço da {dealership_info['name']}",
                is_active=True,
            )
            dealerships.append(dealership)
            session.add(dealership)

        await session.flush()
        print(f"Created {len(dealerships)} dealerships")

        # Create owner user
        owner = User(
            email="admin@aems.com.br",
            hashed_password=get_password_hash("Admin@123"),
            full_name="Administrador AEMS",
            role="owner",
            is_active=True,
            must_change_password=True,
        )
        session.add(owner)

        # Create a sample user (perfil-based)
        sample_user = User(
            email="usuario@aems.com.br",
            hashed_password=get_password_hash("User@123"),
            full_name="Usuario Exemplo",
            role="user",
            is_active=True,
            must_change_password=True,
        )
        session.add(sample_user)

        await session.commit()
        print("Seed completed successfully!")
        print("\nUsuários criados:")
        print("=" * 50)
        print("Owner:   admin@aems.com.br   / Admin@123")
        print("Usuario: usuario@aems.com.br / User@123")
        print("=" * 50)
        print("\nTodos os usuários devem trocar a senha no primeiro login.")
        print("Vincule perfis de acesso ao 'Usuario Exemplo' via /admin/profiles.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed_database())
