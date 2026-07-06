"""
Script de seed para cadastrar funcionários a partir da planilha funcionarios.xlsx.

Execução:
  1. Deixar DRY_RUN = True (padrão) → preview da lista completa
  2. Revisar a tabela exibida
  3. Setar DRY_RUN = False e rodar novamente para inserir de verdade

  python scripts/seed_employees.py
  python scripts/seed_employees.py /outro/caminho/funcionarios.xlsx

Lojas mapeadas (IDs reais após seed_owner — AEMS ocupa id=1 via migration):
  ADMINISTRAÇÃO / Matriz / Jovem Aprendiz → Toyota Unidade 01 (id=3)
  Galpão Central   → Galpão Central (criado automaticamente se não existir, id=15)
  Hyundai Unidade 09 → id=11
  Fiat Unidade 12    → id=14
  Unidade 03   → Toyota Unidade 03 → id=5
  BYD Unidade 07          → id=9
  BYD Unidade 05  → BYD Unidade 05 → id=7
  BYD Unidade 04         → id=6
  Toyota Unidade 02        → id=4
  Hyundai Unidade 10       → id=12

  Ignoradas: Loja Central, Filial Externa, Fiat e BYD Unidade 08,
             Afastado pelo INSS
"""
import asyncio
import datetime
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import openpyxl
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import get_settings
from app.db.base import Base  # noqa: F401

# Importar TODOS os models para que o SQLAlchemy resolva os relacionamentos
from app.modules.auth.models import AccessLog, User  # noqa: F401
from app.modules.access_profiles.models import (  # noqa: F401
    AccessProfile, AccessProfileModulePermission,
    access_profile_stores, access_profile_users,
)
from app.modules.brands.models import Brand  # noqa: F401
from app.modules.stores.models import Store
from app.modules.dealerships.models import Dealership  # noqa: F401
from app.modules.consultants.models import Consultant  # noqa: F401
from app.modules.services.models import Service  # noqa: F401
from app.modules.service_orders.models import (  # noqa: F401
    ServiceOrder, ServiceOrderItem, ServiceOrderWorker, StatusHistory,
)
from app.modules.employees.models import Employee
from app.modules.notifications.models import Notification  # noqa: F401
from app.modules.vehicle_models.models import VehicleModel  # noqa: F401
from app.modules.inventory.models import (  # noqa: F401
    FilmType, FilmTypeService, FilmRoll, FilmConsumption,
)
from app.modules.suppliers.models import Supplier  # noqa: F401
from app.core.audit import AuditLog  # noqa: F401

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURAÇÃO
# ─────────────────────────────────────────────────────────────────────────────

DRY_RUN = False  # Mudar para False para inserir de verdade

EXCEL_PATH = pathlib.Path(
    "data/funcionarios.xlsx"
)

# Seções mapeadas para store_id do banco.
# "Galpão Central" recebe None aqui — o script cria a loja automaticamente
# se não existir e preenche o id em runtime.
STORE_MAPPING: dict[str, int | None] = {
    "ADMINISTRAÇÃO":        3,    # Toyota Unidade 01
    "Matriz":           3,    # Toyota Unidade 01
    "Jovem Aprendiz":       3,    # Toyota Unidade 01
    "Galpão Central":      None, # "Galpão Central" — criado automaticamente pelo script
    "Hyundai Unidade 09": 11,
    "Fiat Unidade 12":    14,
    "Unidade 03":   5,
    "BYD Unidade 07":          9,
    "BYD Unidade 05":  7,
    "BYD Unidade 04":         6,
    "Toyota Unidade 02":        4,
    "Hyundai Unidade 10":       12,
    "Loja Central":         1,    # AEMS
}

# Seções ignoradas por completo (não cadastrar)
SKIP_SECTIONS: set[str] = {
    "Afastado pelo INSS",
    "119  funcionários",
    "Filial Externa",
    "Fiat e BYD Unidade 08",
}

# Funcionários dessas seções recebem works_in_galpon = True
GALPON_SECTIONS: set[str] = {"Galpão Central"}

CARGO_MAPPING: dict[str, str] = {
    "Asistente ADM":           "Assistente ADM",
    "Auxiliar ADM (TI)":       "Auxiliar ADM (TI)",
    "Encarregado":             "Encarregado",
    "Gerente Financeira":      "Gerente Financeira",
    "Gerente Operacional":     "Gerente Operacional",
    "Higienizador":            "Higienizador",
    "Higienizador (tem CNH)":  "Higienizador",
    "Inst. de película":       "Instalador de Película",
    "Jovem Aprendiz":          "Jovem Aprendiz",
    "Lav a seco":              "Lavador a Seco",
    "Lavador":                 "Lavador",
    "Lavador agua":            "Lavador com Água",
    "Lavador com agua":        "Lavador com Água",
    "Lavador/ Encarregado":    "Lavador/Encarregado",
    "Manobrista":              "Manobrista",
    "Martelinho Ouro":         "Martelinho de Ouro",
    "PPF e Pelicula":          "PPF e Película",
    "Polidor":                 "Polidor",
    "Polidor Funilaria":       "Polidor de Funilaria",
    "Prom. Vendas":            "Promotor de Vendas",
    "Prom. vendas":            "Promotor de Vendas",
    "Promotora":               "Promotor de Vendas",
    "Sub gerente":             "Sub-Gerente",
    "Supervisor de película":  "Supervisor de Película",
    "Supervisor estetica":     "Supervisor de Estética",
}

# Preposições que não devem ser usadas como sobrenome isolado
_PREP = {"da", "de", "do", "dos", "das", "e", "di"}

# ─────────────────────────────────────────────────────────────────────────────
# Funções auxiliares
# ─────────────────────────────────────────────────────────────────────────────

def clean_name(raw: str) -> str:
    """Remove sufixos entre parênteses e normaliza espaços."""
    s = re.sub(r'\s*\([^)]*\)', '', raw).strip()
    return re.sub(r'\s+', ' ', s)


def split_name(full_name: str, used_surnames: set[str]) -> tuple[str, str]:
    """
    Divide o nome completo em (nome, sobrenome) de forma que o sobrenome
    não se repita com outro funcionário já processado no mesmo batch.
    Tenta sobrenomes de trás pra frente, pulando preposições.
    """
    clean = clean_name(full_name)
    parts = clean.split()
    if not parts:
        return full_name, ""
    first = parts[0]
    for part in reversed(parts[1:]):
        key = part.lower()
        if key not in _PREP and key not in used_surnames:
            used_surnames.add(key)
            return first, part
    return first, " ".join(parts[1:])


def parse_date(val) -> datetime.date | None:
    """Converte valor da célula Excel para datetime.date."""
    if val is None:
        return None
    if isinstance(val, datetime.datetime):
        return val.date()
    if isinstance(val, datetime.date):
        return val
    if isinstance(val, str):
        v = val.strip()
        if not v or v.upper() == "XXX":
            return None
        m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{2,4})$', v)
        if m:
            day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if year < 100:
                year += 2000
            try:
                return datetime.date(year, month, day)
            except ValueError:
                return None
    return None


def is_xxx_date(val) -> bool:
    """Retorna True se a data for 'XXX' — indica funcionário a ser pulado."""
    return isinstance(val, str) and val.strip().upper() == "XXX"


def parse_spreadsheet(ws) -> list[dict]:
    """
    Extrai funcionários dos dois grupos de colunas da planilha:
      Esquerda: A=nº  B=nome  C=função  D=data
      Direita:  F=nº  G=nome  H=função  I=data
    """
    employees: list[dict] = []
    left_section: str | None = None
    right_section: str | None = None

    for row in ws.iter_rows(values_only=True):
        row = list(row)
        while len(row) < 9:
            row.append(None)

        _a, b, c, d = row[0], row[1], row[2], row[3]
        _f, g, h, i = row[5], row[6], row[7], row[8]

        is_left_hdr  = isinstance(c, str) and c.strip() == "Função"
        is_right_hdr = isinstance(h, str) and h.strip() == "Função"

        if is_left_hdr and isinstance(b, str) and b.strip():
            left_section = b.strip()

        if is_right_hdr and isinstance(g, str) and g.strip():
            right_section = g.strip()

        # Funcionário lado esquerdo
        if (
            not is_left_hdr
            and isinstance(b, str) and b.strip()
            and left_section
            and left_section not in SKIP_SECTIONS
        ):
            employees.append({
                "full_name": b.strip(),
                "function":  c.strip() if isinstance(c, str) else None,
                "date_raw":  d,
                "section":   left_section,
            })

        # Funcionário lado direito
        if (
            not is_right_hdr
            and isinstance(g, str) and g.strip()
            and right_section
            and right_section not in SKIP_SECTIONS
        ):
            employees.append({
                "full_name": g.strip(),
                "function":  h.strip() if isinstance(h, str) else None,
                "date_raw":  i,
                "section":   right_section,
            })

    return employees


async def ensure_galpon_store(session, name: str, code: str, brand_id: int) -> int:
    """Localiza ou cria a loja Galpão Central e retorna seu id."""
    result = await session.execute(select(Store).where(Store.name == name))
    store = result.scalar_one_or_none()
    if store:
        return store.id
    store = Store(
        name=name,
        code=code,
        is_galpon_store=True,
        brand_id=brand_id,
        is_active=True,
        address="Central",
    )
    session.add(store)
    await session.flush()
    print(f"  [+] Loja '{name}' criada com id={store.id}")
    return store.id


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

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

    # ── 1. Garantir loja Galpão Central e resolver store_ids ────────────────
    async with async_session() as session:
        # Busca brand Toyota (id=1) como padrão para o galpão
        result = await session.execute(select(Brand).where(Brand.code == "toyota"))
        toyota = result.scalar_one_or_none()
        galpon_brand_id = toyota.id if toyota else 1

        galpon_id = await ensure_galpon_store(
            session, "Galpão Central", "GP01", galpon_brand_id
        )
        STORE_MAPPING["Galpão Central"] = galpon_id
        await session.commit()

    # ── 2. Listar lojas disponíveis ───────────────────────────────────────────
    async with async_session() as session:
        result = await session.execute(select(Store).order_by(Store.id))
        stores: list[Store] = list(result.scalars().all())

    store_name_by_id = {s.id: s.name for s in stores}
    valid_ids = set(store_name_by_id)

    sep = "=" * 60
    print(f"\n{sep}")
    print("LOJAS NO BANCO:")
    print(sep)
    for s in stores:
        galpon_flag = " [GALPÃO]" if s.is_galpon_store else ""
        print(f"  {s.id:4}  {s.name}{galpon_flag}")
    print(sep)

    # ── 3. Validar STORE_MAPPING ──────────────────────────────────────────────
    invalid_ids = [
        (sec, sid)
        for sec, sid in STORE_MAPPING.items()
        if sid is not None and sid not in valid_ids
    ]
    if invalid_ids:
        print("ERRO: store_ids inválidos no STORE_MAPPING:")
        for sec, sid in invalid_ids:
            print(f"  '{sec}': {sid}")
        await engine.dispose()
        sys.exit(1)

    # ── 4. Parsear planilha ───────────────────────────────────────────────────
    print(f"\nLendo: {excel_path}")
    wb = openpyxl.load_workbook(excel_path, data_only=True)
    ws = wb[wb.sheetnames[0]]
    raw = parse_spreadsheet(ws)
    print(f"Registros encontrados na planilha: {len(raw)}")

    # ── 5. Filtrar e processar ────────────────────────────────────────────────
    used_surnames: set[str] = set()
    to_insert: list[dict] = []
    skipped_xxx:      list[str] = []
    skipped_no_store: list[tuple[str, str]] = []
    skipped_no_name:  list[str] = []

    for emp in raw:
        fn       = emp["full_name"]
        section  = emp["section"]
        date_raw = emp["date_raw"]
        function = emp.get("function")

        if is_xxx_date(date_raw):
            skipped_xxx.append(fn)
            continue

        store_id = STORE_MAPPING.get(section)
        if store_id is None:
            skipped_no_store.append((fn, section))
            continue

        clean = clean_name(fn)
        if not clean:
            skipped_no_name.append(fn)
            continue

        name, last_name = split_name(fn, used_surnames)
        entry_date  = parse_date(date_raw)
        cargo       = CARGO_MAPPING.get(function, function) if function else None
        in_galpon   = section in GALPON_SECTIONS

        to_insert.append({
            "name":            name,
            "last_name":       last_name or None,
            "store_id":        store_id,
            "position":        cargo,
            "entry_date":      entry_date,
            "works_in_galpon": in_galpon,
            "section":         section,
            "original_name":   fn,
        })

    # ── 6. Resumo ─────────────────────────────────────────────────────────────
    print(f"\n{'DRY RUN — nada será alterado' if DRY_RUN else 'MODO DE INSERÇÃO ATIVO'}")
    print(f"  A inserir:                {len(to_insert)}")
    print(f"  Pulados (data XXX):       {len(skipped_xxx)}")
    print(f"  Pulados (ignorados):      {len(skipped_no_store)}")
    print(f"  Pulados (sem nome):       {len(skipped_no_name)}")

    if skipped_xxx:
        print(f"\nPulados por data XXX:")
        for fn in skipped_xxx:
            print(f"  {fn}")

    if skipped_no_store:
        seções = {}
        for fn, sec in skipped_no_store:
            seções.setdefault(sec, []).append(fn)
        print(f"\nIgnoradas (seções não mapeadas):")
        for sec, nomes in seções.items():
            print(f"  [{sec}] {len(nomes)} funcionário(s)")

    # ── 7. Preview DRY_RUN ────────────────────────────────────────────────────
    if DRY_RUN:
        W = (4, 24, 24, 32, 6, 12)
        header = (
            f"{'#':>{W[0]}}  {'Nome':<{W[1]}}  {'Sobrenome':<{W[2]}}  "
            f"{'Cargo':<{W[3]}}  {'Loja':>{W[4]}}  {'Entrada':<{W[5]}}  Seção"
        )
        line = "-" * (sum(W) + len(W) * 2 + 20)
        print(f"\n{line}\n{header}\n{line}")
        for i, emp in enumerate(to_insert, 1):
            entry    = emp["entry_date"].isoformat() if emp["entry_date"] else "(sem data)"
            galpon   = " [G]" if emp["works_in_galpon"] else ""
            print(
                f"{i:>{W[0]}}  {emp['name']:<{W[1]}}  {(emp['last_name'] or ''):<{W[2]}}  "
                f"{(emp['position'] or ''):<{W[3]}}  {emp['store_id']:>{W[4]}}  "
                f"{entry:<{W[5]}}  [{emp['section']}]{galpon}"
            )
        print(line)
        print(f"\nTotal: {len(to_insert)} funcionários seriam inseridos.")
        print("Para inserir de verdade, ajuste DRY_RUN = False e execute novamente.")
        await engine.dispose()
        return

    # ── 8. Inserir no banco ───────────────────────────────────────────────────
    inserted  = 0
    duplicates = 0
    errors: list[tuple[str, str]] = []

    async with async_session() as session:
        result = await session.execute(select(Employee.name, Employee.store_id))
        existing: set[tuple] = {(r.name, r.store_id) for r in result}

        for emp in to_insert:
            key = (emp["name"], emp["store_id"])
            if key in existing:
                duplicates += 1
                continue
            try:
                db_emp = Employee(
                    name=emp["name"],
                    last_name=emp["last_name"],
                    store_id=emp["store_id"],
                    position=emp["position"],
                    entry_date=emp["entry_date"],
                    works_in_galpon=emp["works_in_galpon"],
                    is_active=True,
                )
                session.add(db_emp)
                existing.add(key)
                inserted += 1
            except Exception as exc:
                errors.append((emp["original_name"], str(exc)))

        if errors:
            await session.rollback()
            print(f"\nABORTADO: {len(errors)} erro(s) encontrado(s) antes do commit:")
            for name, err in errors:
                print(f"  {name}: {err}")
            await engine.dispose()
            sys.exit(1)

        await session.commit()

    print(f"\nInseridos:  {inserted}")
    print(f"Duplicatas: {duplicates} (ja existiam, ignorados)")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
