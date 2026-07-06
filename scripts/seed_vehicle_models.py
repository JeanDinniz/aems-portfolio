"""
Script de seed para cadastrar modelos de veículos a partir de planilha Excel.

Colunas esperadas:
  A = Nome do Modelo
  B = Marca
  C = Status  → só importa linhas com Status == "Ativo"

Execução:
  python scripts/seed_vehicle_models.py
  python scripts/seed_vehicle_models.py /outro/caminho/modelos.xlsx

  DRY_RUN = True  → preview sem inserir
  DRY_RUN = False → inserir de verdade
"""
import asyncio
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import openpyxl
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
from app.modules.stores.models import Store  # noqa: F401
from app.modules.dealerships.models import Dealership  # noqa: F401
from app.modules.consultants.models import Consultant  # noqa: F401
from app.modules.employees.models import Employee  # noqa: F401
from app.modules.notifications.models import Notification  # noqa: F401
from app.modules.service_orders.models import (  # noqa: F401
    ServiceOrder, ServiceOrderItem, ServiceOrderWorker, StatusHistory,
)
from app.modules.services.models import Service  # noqa: F401
from app.modules.vehicle_models.models import VehicleModel
from app.modules.inventory.models import (  # noqa: F401
    FilmType, FilmTypeService, FilmRoll, FilmConsumption,
)
from app.modules.suppliers.models import Supplier  # noqa: F401
from app.core.audit import AuditLog  # noqa: F401

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURAÇÃO
# ─────────────────────────────────────────────────────────────────────────────

DRY_RUN = False

EXCEL_PATH = pathlib.Path(
    "data/modelos-sistema.xlsx"
)


async def main() -> None:
    excel_path = EXCEL_PATH
    if len(sys.argv) > 1:
        excel_path = pathlib.Path(sys.argv[1])
    if not excel_path.exists():
        print(f"ERRO: arquivo não encontrado: {excel_path}")
        sys.exit(1)

    settings = get_settings()
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False)

    # ── 1. Parsear planilha ───────────────────────────────────────────────────
    print(f"Lendo: {excel_path}")
    wb = openpyxl.load_workbook(excel_path, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    print(f"Total de linhas na planilha: {len(rows)}")

    parsed: list[dict] = []
    skipped_inactive = 0

    for row in rows:
        raw_name   = row[0]
        raw_brand  = row[1]
        raw_status = row[2]

        if not raw_name or not str(raw_name).strip():
            continue

        status = str(raw_status).strip() if raw_status else ""
        if status != "Ativo":
            skipped_inactive += 1
            continue

        parsed.append({
            "name":       str(raw_name).strip(),
            "brand_name": str(raw_brand).strip() if raw_brand else "",
        })

    # ── 2. Carregar marcas do banco ───────────────────────────────────────────
    async with async_session() as session:
        result = await session.execute(select(Brand))
        brands_by_name: dict[str, Brand] = {
            b.name.lower(): b for b in result.scalars().all()
        }

    sep = "=" * 60
    print(f"\n{sep}")
    print("MARCAS NO BANCO:")
    print(sep)
    for name_lower, brand in sorted(brands_by_name.items()):
        print(f"  {brand.code:<12}  id={brand.id}  nome={brand.name}")
    print(sep)

    # ── 3. Validar marcas da planilha ─────────────────────────────────────────
    missing_brands: set[str] = set()
    to_insert: list[dict] = []

    for item in parsed:
        brand = brands_by_name.get(item["brand_name"].lower())
        if brand is None:
            missing_brands.add(item["brand_name"])
        else:
            to_insert.append({
                "name":       item["name"],
                "brand_id":   brand.id,
                "brand_name": brand.name,
            })

    if missing_brands:
        print(f"\nERRO: marcas não encontradas no banco: {sorted(missing_brands)}")
        print("Cadastre as marcas antes de rodar este seed.")
        await engine.dispose()
        sys.exit(1)

    # ── 4. Resumo ─────────────────────────────────────────────────────────────
    print(f"\n{'DRY RUN — nada será alterado' if DRY_RUN else 'MODO DE INSERÇÃO ATIVO'}")
    print(f"  Ativos a processar: {len(to_insert)}")
    print(f"  Ignorados (inativos): {skipped_inactive}\n")

    if DRY_RUN:
        current_brand = None
        for i, m in enumerate(to_insert, 1):
            if m["brand_name"] != current_brand:
                current_brand = m["brand_name"]
                print(f"\n  [{current_brand}]")
            print(f"    {i:>3}. {m['name']}")
        print(f"\nTotal: {len(to_insert)} modelos seriam inseridos.")
        print("Para inserir, ajuste DRY_RUN = False e execute novamente.")
        await engine.dispose()
        return

    # ── 5. Inserir no banco ───────────────────────────────────────────────────
    inserted = 0
    duplicates = 0

    async with async_session() as session:
        result = await session.execute(select(VehicleModel.brand_id, VehicleModel.name))
        existing: set[tuple] = {(r.brand_id, r.name) for r in result}

        for m in to_insert:
            key = (m["brand_id"], m["name"])
            if key in existing:
                duplicates += 1
                continue
            session.add(VehicleModel(
                brand_id=m["brand_id"],
                name=m["name"],
                is_active=True,
            ))
            existing.add(key)
            inserted += 1

        await session.commit()

    print(f"Inseridos:            {inserted}")
    print(f"Já existentes:        {duplicates}")
    print(f"Ignorados (inativos): {skipped_inactive}")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
