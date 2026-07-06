"""
Seed de consultores a partir de consultores-sistema.xlsx.

Colunas (linha 1 = cabeçalho ignorado):
  A = Nome          → name (Title Case)
  B = Loja          → store_id (busca por nome exato)
  C = Telefone      → phone
  D = E-mail        → email
  E = PIX           → pix_key
  F = Banco         → bank_name
  G = Agência       → bank_agency
  H = Conta         → bank_account
  I = Tipo Conta    → bank_account_type
  J = Status        → is_active ("ativo" = True, demais = False)

Unicidade: (name, store_id) — duplicata ignorada silenciosamente.
dealership_id: resolvido pelo store_id via tabela dealerships.

Execução:
  python scripts/seed_consultants.py
  python scripts/seed_consultants.py caminho/para/consultores-sistema.xlsx

  DRY_RUN = True  → preview sem inserir
  DRY_RUN = False → inserir de verdade
"""
import asyncio
import pathlib
import sys

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
from app.modules.brands.models import Brand  # noqa: F401
from app.modules.stores.models import Store
from app.modules.dealerships.models import Dealership
from app.modules.consultants.models import Consultant
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

DEFAULT_XLSX = "data/consultores-sistema.xlsx"


def _str(val) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


def _title(val) -> str:
    raw = str(val).strip()
    return " ".join(p.title() for p in raw.split())


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

    # ── 1. Carregar lojas e dealerships ──────────────────────────────────────
    async with async_session() as session:
        result = await session.execute(select(Store).order_by(Store.id))
        stores_by_name: dict[str, Store] = {
            s.name.strip().lower(): s for s in result.scalars().all()
        }
        stores_by_id: dict[int, Store] = {
            s.id: s for s in stores_by_name.values()
        }

        result = await session.execute(select(Dealership))
        dealerships_by_store: dict[int, int] = {
            d.store_id: d.id for d in result.scalars().all()
        }

    sep = "=" * 60
    print(sep)
    print("LOJAS NO BANCO:")
    print(sep)
    for store in sorted(stores_by_id.values(), key=lambda s: s.id):
        print(f"  {store.id:4}  {store.name}")
    print(f"{sep}\n")

    # ── 2. Parsear planilha ───────────────────────────────────────────────────
    inserted = 0
    duplicates = 0
    skipped_loja = 0
    skipped_dealership = 0
    errors = 0

    async with async_session() as session:
        result = await session.execute(select(Consultant.name, Consultant.store_id))
        existing: set[tuple] = {(r.name, r.store_id) for r in result}

        print(f"{'DRY RUN — nada será alterado' if DRY_RUN else 'MODO DE INSERÇÃO ATIVO'}\n")

        for i, row in enumerate(rows, start=2):
            nome_raw      = row[0] if len(row) > 0 else None
            loja_raw      = row[1] if len(row) > 1 else None
            phone_raw     = row[2] if len(row) > 2 else None
            email_raw     = row[3] if len(row) > 3 else None
            pix_raw       = row[4] if len(row) > 4 else None
            banco_raw     = row[5] if len(row) > 5 else None
            agencia_raw   = row[6] if len(row) > 6 else None
            conta_raw     = row[7] if len(row) > 7 else None
            tipo_raw      = row[8] if len(row) > 8 else None
            status_raw    = row[9] if len(row) > 9 else None

            if nome_raw is None or str(nome_raw).strip() == "":
                continue

            nome = _title(nome_raw)

            if loja_raw is None or str(loja_raw).strip() == "":
                print(f"  [AVISO] Linha {i}: '{nome}' — coluna Loja vazia, pulando")
                skipped_loja += 1
                continue

            loja_key = str(loja_raw).strip().lower()
            store = stores_by_name.get(loja_key)
            if store is None:
                print(f"  [AVISO] Linha {i}: '{nome}' — loja '{loja_raw}' não encontrada, pulando")
                skipped_loja += 1
                continue

            dealership_id = dealerships_by_store.get(store.id)
            if dealership_id is None:
                print(
                    f"  [AVISO] Linha {i}: '{nome}' — nenhuma dealership para loja"
                    f" '{store.name}' (id={store.id}), pulando"
                )
                skipped_dealership += 1
                continue

            is_active = (
                str(status_raw).strip().lower() == "ativo"
                if status_raw is not None
                else True
            )

            phone          = _str(phone_raw)
            email          = _str(email_raw)
            pix_key        = _str(pix_raw)
            bank_name      = _str(banco_raw)
            bank_agency    = _str(agencia_raw)
            bank_account   = _str(conta_raw)
            bank_account_type = _str(tipo_raw)

            key = (nome, store.id)
            if key in existing:
                duplicates += 1
                continue

            if DRY_RUN:
                status_label = "ativo" if is_active else "inativo"
                print(
                    f"  [DRY] {nome} | loja={store.name} | status={status_label}"
                    f" | phone={phone} | email={email}"
                )
                existing.add(key)
                inserted += 1
                continue

            try:
                session.add(Consultant(
                    name=nome,
                    store_id=store.id,
                    dealership_id=dealership_id,
                    is_active=is_active,
                    phone=phone,
                    email=email,
                    pix_key=pix_key,
                    bank_name=bank_name,
                    bank_agency=bank_agency,
                    bank_account=bank_account,
                    bank_account_type=bank_account_type,
                ))
                existing.add(key)
                inserted += 1
            except Exception as exc:
                print(f"  [ERRO] Linha {i}: '{nome}' — {exc}")
                errors += 1

        if not DRY_RUN:
            await session.commit()

    print(f"\n{'DRY RUN — nada foi alterado' if DRY_RUN else 'Inserção concluída'}")
    print(f"  Inseridos:                    {inserted}")
    print(f"  Duplicatas ignoradas:         {duplicates}")
    print(f"  Pulados (loja não encontrada):{skipped_loja}")
    print(f"  Pulados (sem dealership):     {skipped_dealership}")
    print(f"  Erros:                        {errors}")

    await engine.dispose()


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_XLSX
    asyncio.run(main(path))
