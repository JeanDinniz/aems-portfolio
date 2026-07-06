"""
Script de seed para cadastrar marcas, lojas e concessionárias.

Idempotente: verifica existência antes de inserir.

Execução:
  python scripts/seed_stores.py

  DRY_RUN = True  → preview sem inserir
  DRY_RUN = False → inserir de verdade
"""
import asyncio
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import get_settings
from app.db.base import Base  # noqa: F401
from app.modules.auth.models import AccessLog, User  # noqa: F401
from app.modules.access_profiles.models import (  # noqa: F401
    AccessProfile, AccessProfileModulePermission,
    access_profile_stores, access_profile_users,
)
from app.modules.brands.models import Brand
from app.modules.stores.models import Store
from app.modules.dealerships.models import Dealership
from app.modules.consultants.models import Consultant  # noqa: F401
from app.modules.employees.models import Employee  # noqa: F401
from app.modules.notifications.models import Notification  # noqa: F401
from app.modules.service_orders.models import (  # noqa: F401
    ServiceOrder, ServiceOrderItem, ServiceOrderWorker, StatusHistory,
)
from app.modules.services.models import Service  # noqa: F401
from app.modules.vehicle_models.models import VehicleModel  # noqa: F401
from app.modules.inventory.models import (  # noqa: F401
    FilmType, FilmTypeService, FilmRoll, FilmConsumption,
)
from app.modules.suppliers.models import Supplier  # noqa: F401
from app.core.audit import AuditLog  # noqa: F401

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURAÇÃO
# ─────────────────────────────────────────────────────────────────────────────

DRY_RUN = False

# (name, code)
BRANDS: list[tuple[str, str]] = [
    ("Toyota",  "toyota"),
    ("BYD",     "byd"),
    ("Hyundai", "hyundai"),
    ("Fiat",    "fiat"),
]

# (code, name, brand_name, address, is_galpon_store)
# Dealership criado apenas para as 12 lojas principais (não GP01, não WC01)
STORES: list[tuple[str, str, str, str, bool]] = [
    ("LJ01", "Toyota Unidade 01",           "Toyota",  "Endereço da Loja 01",       False),
    ("LJ02", "Toyota Unidade 02",             "Toyota",  "Endereço da Loja 02",       False),
    ("LJ03", "Toyota Unidade 03", "Toyota",  "Endereço da Loja 03",       False),
    ("LJ04", "BYD Unidade 04",              "BYD",     "Endereço da Loja 04",       False),
    ("LJ05", "BYD Unidade 05",                 "BYD",     "Endereço da Loja 05",       False),
    ("LJ06", "BYD Unidade 06",           "BYD",     "Endereço da Loja 06",       False),
    ("LJ07", "BYD Unidade 07",               "BYD",     "Endereço da Loja 07",       False),
    ("LJ08", "BYD Unidade 08",           "BYD",     "Endereço da Loja 08",       False),
    ("LJ09", "Hyundai Unidade 09",      "Hyundai", "Endereço da Loja 09",       False),
    ("LJ10", "Hyundai Unidade 10",            "Hyundai", "Endereço da Loja 10",       False),
    ("LJ11", "Fiat Unidade 11",          "Fiat",    "Endereço da Loja 11",       False),
    ("LJ12", "Fiat Unidade 12",         "Fiat",    "Endereço da Loja 12",       False),
    ("GP01", "Galpão Central",            "Toyota",  "Central",                  True),
    ("WC01", "AEMS",               "Toyota",  "Endereço da AEMS",   False),
]

# Apenas lojas com código LJ* recebem Dealership
_DEALERSHIP_CODES = {code for code, *_ in STORES if code.startswith("LJ")}


async def main() -> None:
    settings = get_settings()
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False)

    sep = "=" * 60

    if DRY_RUN:
        print(f"\n{sep}")
        print("DRY RUN — nada será alterado")
        print(f"{sep}")
        print(f"\n  Marcas a criar: {len(BRANDS)}")
        for name, code in BRANDS:
            print(f"    [{code}] {name}")
        print(f"\n  Lojas a criar: {len(STORES)}")
        for code, name, brand_name, address, is_galpon in STORES:
            dealership_flag = " + Dealership" if code in _DEALERSHIP_CODES else ""
            galpon_flag = " [GALPÃO]" if is_galpon else ""
            print(f"    {code}  {name}  ({brand_name}){galpon_flag}{dealership_flag}")
        print(f"\nPara inserir, ajuste DRY_RUN = False e execute novamente.")
        await engine.dispose()
        return

    print(f"\n{sep}")
    print("MODO DE INSERÇÃO ATIVO")
    print(f"{sep}")

    async with async_session() as session:
        # ── 1. Marcas ─────────────────────────────────────────────────────────
        result = await session.execute(select(Brand))
        existing_brands: dict[str, Brand] = {b.code: b for b in result.scalars().all()}

        brands_inserted = 0
        for name, code in BRANDS:
            if code in existing_brands:
                continue
            brand = Brand(name=name, code=code, is_active=True)
            session.add(brand)
            existing_brands[code] = brand
            brands_inserted += 1

        await session.flush()  # garante brand.id disponível para as lojas

        # ── 2. Lojas ──────────────────────────────────────────────────────────
        result = await session.execute(select(Store))
        existing_store_codes: set[str] = {s.code for s in result.scalars().all()}

        stores_inserted = 0
        stores_by_code: dict[str, Store] = {}

        for code, name, brand_name, address, is_galpon in STORES:
            # Busca brand pelo nome (case-insensitive)
            brand_match = next(
                (b for b in existing_brands.values() if b.name.lower() == brand_name.lower()),
                None,
            )
            if brand_match is None:
                print(f"ERRO: marca '{brand_name}' não encontrada para a loja {code}. Abortando.")
                await engine.dispose()
                sys.exit(1)

            if code in existing_store_codes:
                # Carrega para uso na criação do dealership
                result2 = await session.execute(select(Store).where(Store.code == code))
                stores_by_code[code] = result2.scalar_one()
                continue

            store = Store(
                code=code,
                name=name,
                brand_id=brand_match.id,
                address=address,
                is_galpon_store=is_galpon,
                is_active=True,
            )
            session.add(store)
            stores_by_code[code] = store
            existing_store_codes.add(code)
            stores_inserted += 1

        await session.flush()  # garante store.id disponível para dealerships

        # ── 3. Dealerships ────────────────────────────────────────────────────
        result = await session.execute(select(Dealership.store_id))
        existing_dealership_store_ids: set[int] = {r for (r,) in result}

        dealerships_inserted = 0
        for code, name, brand_name, _, _ in STORES:
            if code not in _DEALERSHIP_CODES:
                continue
            store = stores_by_code.get(code)
            if store is None or store.id is None:
                continue
            if store.id in existing_dealership_store_ids:
                continue

            dealership = Dealership(
                name=f"Concessionária {name}",
                store_id=store.id,
                brand=brand_name,
                is_active=True,
            )
            session.add(dealership)
            existing_dealership_store_ids.add(store.id)
            dealerships_inserted += 1

        await session.commit()

    print(f"\nMarcas inseridas:         {brands_inserted}")
    print(f"Lojas inseridas:          {stores_inserted}")
    print(f"Dealerships inseridos:    {dealerships_inserted}")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
