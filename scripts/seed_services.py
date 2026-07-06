"""
Seed de serviços a partir de servicos-sistema.xlsx.

Colunas (linha 1 = cabeçalho ignorado):
  A = Nome          → name
  B = Código        → code (pode ser vazio)
  C = Departamento  → department (mapeado via DEPT_MAP)
  D = Categoria     → category (mapeado via CAT_MAP, opcional)
  E = Marca         → brand (busca por nome exato, case-insensitive)
  F = Valor         → base_price / has_variable_price

Unicidade: (code, brand_id, department) — duplicata ignorada silenciosamente.

Execução:
  python scripts/seed_services.py
  python scripts/seed_services.py caminho/para/servicos-sistema.xlsx

  DRY_RUN = True  → preview sem inserir
  DRY_RUN = False → inserir de verdade
"""
import asyncio
import pathlib
import sys
from decimal import Decimal, InvalidOperation

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

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
from app.modules.services.models import Service
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

DEFAULT_XLSX = "data/servicos-sistema.xlsx"

DEPT_MAP = {
    "Funilaria":             "bodywork",
    "Oficina":               "workshop",
    "Película":              "film",
    "PPF":                   "ppf",
    "VN (Veículos Novos)":   "vn",
    "VU (Veículos Usados)":  "vu",
    "Venda Direta":          "vd",
}

CAT_MAP = {
    "Estética":              "estetica",
    "PPF":                   "ppf",
    "Película":              "insulfilm",
    "Película de Segurança": "pelicula_seguranca",
}


def parse_price(valor) -> tuple[Decimal, bool]:
    if valor is None or str(valor).strip() == "":
        return Decimal("0"), True
    s = str(valor).strip()
    if s.lower() in ("variável", "variavel"):
        return Decimal("0"), True
    try:
        return Decimal(s.replace(",", ".")), False
    except InvalidOperation:
        return Decimal("0"), True


async def main(xlsx_path: str) -> None:
    try:
        import openpyxl
    except ImportError:
        print("ERRO: instale openpyxl → pip install openpyxl")
        sys.exit(1)

    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    print(f"Arquivo carregado: {xlsx_path}")
    print(f"Linhas de dados: {len(rows)}\n")

    settings = get_settings()
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False)

    async with async_session() as session:
        result = await session.execute(select(Brand))
        brands_by_name: dict[str, Brand] = {
            b.name.lower(): b for b in result.scalars().all()
        }

    sep = "=" * 60
    print(sep)
    print("MARCAS NO BANCO:")
    print(sep)
    for nome_lower, brand in sorted(brands_by_name.items()):
        print(f"  id={brand.id}  nome={brand.name}")
    print(f"{sep}\n")

    inserted = 0
    duplicates = 0
    errors = 0

    async with async_session() as session:
        result = await session.execute(
            select(Service.code, Service.brand_id, Service.department)
        )
        existing: set[tuple] = {
            (r.code, r.brand_id, r.department) for r in result
        }

        for i, row in enumerate(rows, start=2):
            nome_raw   = row[0] if len(row) > 0 else None
            codigo_raw = row[1] if len(row) > 1 else None
            dept_raw   = row[2] if len(row) > 2 else None
            cat_raw    = row[3] if len(row) > 3 else None
            marca_raw  = row[4] if len(row) > 4 else None
            valor_raw  = row[5] if len(row) > 5 else None

            if nome_raw is None or str(nome_raw).strip() == "":
                continue

            nome   = str(nome_raw).strip()
            codigo = str(codigo_raw).strip() if codigo_raw is not None else None
            if not codigo:
                codigo = None

            if dept_raw is None or str(dept_raw).strip() not in DEPT_MAP:
                print(f"  [ERRO] Linha {i}: departamento inválido ou ausente → '{dept_raw}'")
                errors += 1
                continue

            dept = DEPT_MAP[str(dept_raw).strip()]

            cat: str | None = None
            if cat_raw and str(cat_raw).strip() in CAT_MAP:
                cat = CAT_MAP[str(cat_raw).strip()]
            elif cat_raw and str(cat_raw).strip() != "":
                print(f"  [AVISO] Linha {i}: categoria desconhecida '{cat_raw}' — será None")

            # Película de Segurança é um departamento próprio (HML-186), mesmo
            # que a planilha a classifique sob "Película".
            if cat == "pelicula_seguranca":
                dept = "security_film"

            if marca_raw is None or str(marca_raw).strip() == "":
                print(f"  [ERRO] Linha {i}: coluna Marca (E) vazia")
                errors += 1
                continue

            marca_key = str(marca_raw).strip().lower()
            brand = brands_by_name.get(marca_key)
            if brand is None:
                print(f"  [ERRO] Linha {i}: marca '{marca_raw}' não encontrada no banco — abortando")
                await engine.dispose()
                sys.exit(1)

            base_price, has_variable_price = parse_price(valor_raw)

            key = (codigo, brand.id, dept)
            if key in existing:
                duplicates += 1
                continue

            if DRY_RUN:
                print(
                    f"  [DRY] {nome} | cod={codigo} | dept={dept} | cat={cat}"
                    f" | marca={brand.name} | preço={base_price} | variável={has_variable_price}"
                )
                existing.add(key)
                inserted += 1
                continue

            session.add(Service(
                name=nome,
                code=codigo,
                department=dept,
                category=cat,
                base_price=base_price,
                has_variable_price=has_variable_price,
                brand_id=brand.id,
                is_active=True,
            ))
            existing.add(key)
            inserted += 1

        if not DRY_RUN:
            await session.commit()

    print(f"\n{'DRY RUN — nada foi alterado' if DRY_RUN else 'Inserção concluída'}")
    print(f"  Inseridos:            {inserted}")
    print(f"  Duplicatas ignoradas: {duplicates}")
    print(f"  Linhas com erro:      {errors}")

    await engine.dispose()


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_XLSX
    asyncio.run(main(path))
