"""
Script de migração histórica — Ordens de Serviço de Junho 2026

Lê a planilha os-junho.xlsx e insere as O.S. diretamente no banco via
SQLAlchemy async, preservando datas históricas e status "completed".

Uso:
    python scripts/migrate_os_junho.py <caminho_excel> <placeholder_photo_url>

Exemplo:
    python scripts/migrate_os_junho.py "data/os-junho.xlsx" "http://localhost:8000/uploads/placeholder.jpg"
"""
import asyncio
import json
import pathlib
import sys
from datetime import datetime, date, timedelta, timezone
from decimal import Decimal

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import openpyxl
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import get_settings

# Importar TODOS os models para que o SQLAlchemy resolva relationships
from app.db.base import Base  # noqa: F401
from app.modules.auth.models import AccessLog, User  # noqa: F401
from app.modules.access_profiles.models import (  # noqa: F401
    AccessProfile,
    AccessProfileModulePermission,
    access_profile_stores,
    access_profile_users,
)
from app.modules.brands.models import Brand  # noqa: F401
from app.modules.stores.models import Store
from app.modules.dealerships.models import Dealership  # noqa: F401
from app.modules.consultants.models import Consultant
from app.modules.employees.models import Employee  # noqa: F401
from app.modules.notifications.models import Notification  # noqa: F401
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem, StatusHistory
from app.modules.services.models import Service
from app.modules.vehicle_models.models import VehicleModel
from app.modules.inventory.models import (  # noqa: F401
    FilmType,
    FilmTypeService,
    FilmRoll,
    FilmConsumption,
)
from app.modules.suppliers.models import Supplier  # noqa: F401
from app.core.audit import AuditLog  # noqa: F401

# ---------------------------------------------------------------------------
# Constantes e mapeamentos
# ---------------------------------------------------------------------------

BRT = timezone(timedelta(hours=-3))

DEPT_MAP: dict[str, str] = {
    "VN": "vn",
    "VU": "vu",
    "Venda Direta": "vd",
    "Oficina": "workshop",
    "Funilaria": "bodywork",
}

MODEL_NORMALIZATION: dict[str, str] = {
    "Yaris Sedã": "Yaris Sedan",
    "HB20 Hatch": "HB20",
    "HB20 Sedan": "HB20",
    "KWID": "Kwid",
    "ONIX": "Onix",
}

COMMIT_BATCH_SIZE = 50


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def parse_service_datetime(date_str: str) -> tuple[datetime, date]:
    """Converte string 'DD/MM/YYYY' em (datetime com tz BRT às 08:00, date)."""
    d = datetime.strptime(date_str.strip(), "%d/%m/%Y")
    dt = datetime(d.year, d.month, d.day, 8, 0, 0, tzinfo=BRT)
    return dt, d.date()


def normalize_model_name(raw: str) -> str:
    """Aplica normalização de nomes de modelo conforme tabela de mapeamento."""
    stripped = raw.strip()
    return MODEL_NORMALIZATION.get(stripped, stripped)


def str_or_none(val) -> str | None:
    """Converte valor para string stripped ou None se vazio."""
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


# ---------------------------------------------------------------------------
# Carregamento de lookups
# ---------------------------------------------------------------------------


async def load_lookups(session) -> tuple[dict, dict, dict, dict]:
    """
    Carrega os 4 dicionários de lookup necessários para a migração.

    Retorna:
        store_map:   nome_loja → (store_id, brand_name)
        service_map: (code_upper, brand_name_lower, dept) → (service_id, base_price)
                     + fallback (code_upper, brand_name_lower) → (service_id, base_price)
        consultant_map: nome_lower_strip → consultant_id
        vehicle_model_map: nome_lower_strip → vehicle_model_id
    """
    # --- Lojas ---
    result = await session.execute(
        select(Store, Brand).join(Brand, Store.brand_id == Brand.id)
    )
    store_map: dict[str, tuple[int, str]] = {}
    for store, brand in result.all():
        store_map[store.name.strip()] = (store.id, brand.name)

    # --- Serviços ---
    result = await session.execute(
        select(Service, Brand).join(Brand, Service.brand_id == Brand.id)
    )
    service_map: dict[tuple, tuple[int, Decimal]] = {}
    service_fallback_brand: dict[tuple, tuple[int, Decimal]] = {}  # (code, brand)
    service_fallback_any: dict[str, tuple[int, Decimal]] = {}      # code only (último recurso)

    for service, brand in result.all():
        if not service.code:
            continue
        code_upper = service.code.strip().upper()
        brand_lower = brand.name.strip().lower()
        dept = service.department

        key_full = (code_upper, brand_lower, dept)
        if key_full not in service_map:
            service_map[key_full] = (service.id, service.base_price)

        key_fb = (code_upper, brand_lower)
        if key_fb not in service_fallback_brand:
            service_fallback_brand[key_fb] = (service.id, service.base_price)

        if code_upper not in service_fallback_any:
            service_fallback_any[code_upper] = (service.id, service.base_price)

    combined_service_map = {**service_map, **service_fallback_brand}
    combined_service_map["_any"] = service_fallback_any  # type: ignore[assignment]

    # --- Consultores ---
    result = await session.execute(select(Consultant))
    consultant_map: dict[str, int] = {}
    for consultant in result.scalars().all():
        key = consultant.name.strip().lower()
        if key not in consultant_map:
            consultant_map[key] = consultant.id

    # --- Modelos de veículo ---
    result = await session.execute(select(VehicleModel))
    vehicle_model_map: dict[str, int] = {}
    for vm in result.scalars().all():
        key = vm.name.strip().lower()
        if key not in vehicle_model_map:
            vehicle_model_map[key] = vm.id

    return store_map, combined_service_map, consultant_map, vehicle_model_map


def lookup_service(
    code: str,
    brand_name: str,
    dept: str,
    service_map: dict,
) -> tuple[int, Decimal] | None:
    """
    Busca serviço por (code, brand, dept) com fallback para (code, brand).
    Retorna (service_id, base_price) ou None.
    """
    code_upper = code.strip().upper()
    brand_lower = brand_name.strip().lower()

    # Tentativa 1: lookup completo com departamento
    result = service_map.get((code_upper, brand_lower, dept))
    if result:
        return result

    # Tentativa 2: fallback sem departamento (mesma marca)
    result = service_map.get((code_upper, brand_lower))
    if result:
        return result

    # Tentativa 3: fallback cross-brand (qualquer marca com esse código)
    any_map: dict = service_map.get("_any", {})  # type: ignore[arg-type]
    result = any_map.get(code_upper)
    if result:
        return result

    return None


# ---------------------------------------------------------------------------
# Processamento de linha
# ---------------------------------------------------------------------------


def process_row(
    row: tuple,
    row_num: int,
    store_map: dict,
    service_map: dict,
    consultant_map: dict,
    vehicle_model_map: dict,
    placeholder_photo: str,
) -> tuple[ServiceOrder, list[ServiceOrderItem], StatusHistory] | None:
    """
    Processa uma linha do Excel e retorna (ServiceOrder, [items], StatusHistory)
    ou None em caso de erro irrecuperável na linha.

    Warnings de itens não encontrados são logados mas não abortam a linha.
    """
    try:
        # --- Coluna 0: LOJA ---
        loja_raw = str_or_none(row[0])
        if not loja_raw:
            print(f"  [LINHA {row_num}] AVISO: coluna LOJA vazia — linha ignorada.")
            return None

        store_info = store_map.get(loja_raw)
        if not store_info:
            print(f"  [LINHA {row_num}] AVISO: loja '{loja_raw}' não encontrada no banco — linha ignorada.")
            return None
        store_id, brand_name = store_info

        # --- Coluna 1: CORTESIA/RETORNO ---
        cortesia_raw = str_or_none(row[1])
        is_courtesy = (cortesia_raw == "Cortesia") if cortesia_raw else False

        # --- Coluna 2: GALPÃO ---
        galpao_raw = str_or_none(row[2])
        is_galpon = (galpao_raw == "Galpão") if galpao_raw else False

        # --- Coluna 3: DEPARTAMENTO ---
        dept_raw = str_or_none(row[3])
        if not dept_raw:
            print(f"  [LINHA {row_num}] AVISO: coluna DEPARTAMENTO vazia — linha ignorada.")
            return None

        dept_enum = DEPT_MAP.get(dept_raw)
        if not dept_enum:
            print(f"  [LINHA {row_num}] AVISO: departamento '{dept_raw}' desconhecido — linha ignorada.")
            return None

        # --- Coluna 4: DATA DO SERVIÇO ---
        date_raw = str_or_none(row[4])
        if not date_raw:
            print(f"  [LINHA {row_num}] AVISO: coluna DATA vazia — linha ignorada.")
            return None

        try:
            service_dt, service_date = parse_service_datetime(date_raw)
        except ValueError as exc:
            print(f"  [LINHA {row_num}] AVISO: data inválida '{date_raw}' ({exc}) — linha ignorada.")
            return None

        entry_time = service_dt
        start_time = service_dt + timedelta(minutes=1)
        completion_time = service_dt + timedelta(minutes=2)

        # --- Coluna 6: Nº OS CONCESSIONÁRIA ---
        external_os_number = str_or_none(row[6])

        # --- Coluna 7: PLACA/CHASSI ---
        plate_raw = str_or_none(row[7])
        if not plate_raw:
            print(f"  [LINHA {row_num}] AVISO: coluna PLACA/CHASSI vazia — linha ignorada.")
            return None
        vehicle_plate = plate_raw.upper()

        # --- Coluna 8: MODELO ---
        model_raw = str_or_none(row[8])
        vehicle_model_str: str | None = None
        vehicle_model_id: int | None = None
        if model_raw:
            vehicle_model_str = normalize_model_name(model_raw)
            vehicle_model_id = vehicle_model_map.get(vehicle_model_str.lower())

        # --- Coluna 9: COR ---
        vehicle_color = str_or_none(row[9])

        # --- Coluna 10: CONSULTOR ---
        consultant_raw = str_or_none(row[10])
        consultant_id: int | None = None
        if consultant_raw:
            consultant_id = consultant_map.get(consultant_raw.strip().lower())

        # --- Coluna 11: SERVIÇOS ---
        services_raw = str_or_none(row[11])
        service_codes: list[str] = []
        if services_raw:
            service_codes = [c.strip() for c in services_raw.split(",") if c.strip()]

        # --- Colunas 14 e 16: OBSERVAÇÕES ---
        notes = str_or_none(row[14])
        internal_notes = str_or_none(row[16])

        # --- Montar ServiceOrder ---
        os_obj = ServiceOrder(
            store_id=store_id,
            department=dept_enum,
            vehicle_plate=vehicle_plate,
            vehicle_model=vehicle_model_str,
            vehicle_model_id=vehicle_model_id,
            vehicle_color=vehicle_color,
            is_galpon=is_galpon,
            is_courtesy=is_courtesy,
            external_os_number=external_os_number,
            is_return=False,
            status="completed",
            entry_time=entry_time,
            start_time=start_time,
            completion_time=completion_time,
            service_date=service_date,
            photos=json.dumps([placeholder_photo]),
            damage_photos=json.dumps([]),
            notes=notes,
            internal_notes=internal_notes,
            consultant_name=consultant_raw,
            consultant_id=consultant_id,
            created_by_id=None,
            dealership_id=None,
            is_verified=False,
            requires_invoice=False,
        )

        # --- Montar itens de serviço ---
        items: list[ServiceOrderItem] = []
        missing_codes: list[str] = []

        for code in service_codes:
            svc_result = lookup_service(code, brand_name, dept_enum, service_map)
            if svc_result is None:
                missing_codes.append(code)
                continue
            svc_id, base_price = svc_result
            items.append(
                ServiceOrderItem(
                    service_id=svc_id,
                    unit_price=base_price,
                    quantity=1,
                )
            )

        if missing_codes:
            print(
                f"  [LINHA {row_num}] AVISO: código(s) de serviço não encontrado(s) "
                f"para loja '{loja_raw}' ({brand_name}) dept '{dept_enum}': "
                f"{', '.join(missing_codes)} — item(ns) ignorado(s)."
            )

        # --- Montar StatusHistory ---
        history = StatusHistory(
            from_status=None,
            to_status="completed",
            changed_by_id=None,
            changed_at=completion_time,
            notes="Migração histórica — junho 2026",
        )

        return os_obj, items, history

    except Exception as exc:
        print(f"  [LINHA {row_num}] ERRO inesperado: {exc} — linha ignorada.")
        return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


import os as _os

API_URL = _os.getenv("MIGRATION_API_URL", "https://aems.example.com")
OWNER_EMAIL = "admin@aems.com.br"
OWNER_PASSWORD = "Matteo@2026"


async def _upload_placeholder_photo(file_path: pathlib.Path) -> str:
    """Faz upload de um arquivo de foto via API e retorna a URL."""
    import httpx
    suffix = file_path.suffix.lower()
    content_type = "image/jpeg" if suffix in {".jpg", ".jpeg"} else f"image/{suffix[1:]}"

    print(f"Fazendo upload da foto placeholder: {file_path}")
    async with httpx.AsyncClient(base_url=API_URL, timeout=30) as client:
        resp = await client.post(
            "/api/v1/auth/login",
            data={"username": OWNER_EMAIL, "password": OWNER_PASSWORD},
        )
        if resp.status_code != 200:
            print(f"ERRO no login: {resp.status_code}")
            sys.exit(1)
        token = resp.json()["access_token"]

        with open(file_path, "rb") as f:
            files = {"file": (file_path.name, f, content_type)}
            resp = await client.post(
                "/api/v1/upload/photo",
                files=files,
                headers={"Authorization": f"Bearer {token}"},
            )
        if resp.status_code != 200:
            print(f"ERRO no upload: {resp.status_code} — {resp.text}")
            sys.exit(1)

    url = resp.json()["url"]
    print(f"  Upload OK → {url}")
    return url


async def main() -> None:
    if len(sys.argv) < 3:
        print("Uso:")
        print("  python scripts/migrate_os_junho.py <caminho_excel> <foto_ou_url>")
        print()
        print("  <foto_ou_url> pode ser:")
        print("    - Caminho de um arquivo de imagem (jpg/png) → faz upload automático")
        print("    - URL já existente no sistema")
        print()
        print("Exemplo:")
        print('  python scripts/migrate_os_junho.py "os-junho.xlsx" "C:/Users/Jean/foto.jpg"')
        sys.exit(1)

    excel_path = pathlib.Path(sys.argv[1])
    photo_arg = sys.argv[2].strip()

    if not excel_path.exists():
        print(f"ERRO: arquivo Excel não encontrado: {excel_path}")
        sys.exit(1)

    # Se o segundo argumento for um arquivo local, faz upload
    photo_path = pathlib.Path(photo_arg)
    if photo_path.exists() and photo_path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
        placeholder_photo = await _upload_placeholder_photo(photo_path)
    else:
        placeholder_photo = photo_arg
        print(f"Usando URL de foto: {placeholder_photo}")

    print(f"Lendo planilha: {excel_path}")
    wb = openpyxl.load_workbook(str(excel_path), data_only=True)
    ws = wb[wb.sheetnames[0]]

    # Coletar todas as linhas de dados (pular cabeçalho na linha 1)
    rows = [row for row in ws.iter_rows(min_row=2, values_only=True) if any(c is not None for c in row)]
    total_rows = len(rows)
    print(f"Total de linhas de dados encontradas: {total_rows}")

    settings = get_settings()
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, expire_on_commit=False)

    # Carregar lookups
    print("Carregando lookups do banco de dados...")
    async with async_session() as session:
        store_map, service_map, consultant_map, vehicle_model_map = await load_lookups(session)

    print(f"  Lojas carregadas:           {len(store_map)}")
    print(f"  Serviços carregados:        {len([k for k in service_map if len(k) == 3])}")
    print(f"  Consultores carregados:     {len(consultant_map)}")
    print(f"  Modelos de veículo:         {len(vehicle_model_map)}")
    print()

    # Contadores
    total_inseridas = 0
    total_erros = 0
    total_itens_sem_servico = 0

    # Processar em batches
    batch: list[tuple[ServiceOrder, list[ServiceOrderItem], StatusHistory]] = []

    async def flush_batch(session_inner, current_batch):
        nonlocal total_inseridas, total_itens_sem_servico
        for os_obj, items, history in current_batch:
            session_inner.add(os_obj)
            await session_inner.flush()  # obtém os_obj.id

            for item in items:
                item.service_order_id = os_obj.id
                session_inner.add(item)

            history.service_order_id = os_obj.id
            session_inner.add(history)

            total_inseridas += 1
            if not items:
                total_itens_sem_servico += 1

        await session_inner.commit()

    for idx, row in enumerate(rows):
        row_num = idx + 2  # linha real no Excel (cabeçalho na linha 1)

        if (idx + 1) % 50 == 0 or idx == 0:
            print(f"Processando {idx + 1}/{total_rows}...")

        result = process_row(
            row=row,
            row_num=row_num,
            store_map=store_map,
            service_map=service_map,
            consultant_map=consultant_map,
            vehicle_model_map=vehicle_model_map,
            placeholder_photo=placeholder_photo,
        )

        if result is None:
            total_erros += 1
            continue

        batch.append(result)

        if len(batch) >= COMMIT_BATCH_SIZE:
            async with async_session() as session:
                await flush_batch(session, batch)
            batch.clear()

    # Flush do batch restante
    if batch:
        async with async_session() as session:
            await flush_batch(session, batch)
        batch.clear()

    await engine.dispose()

    print()
    print("=== MIGRAÇÃO CONCLUÍDA ===")
    print(f"Total processadas:     {total_rows}")
    print(f"Inseridas com sucesso: {total_inseridas}")
    print(f"Erros (puladas):       {total_erros}")
    print(f"O.S. sem nenhum item:  {total_itens_sem_servico}")


if __name__ == "__main__":
    asyncio.run(main())
