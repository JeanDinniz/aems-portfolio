"""
Backfill do status "duplicate" para O.S. já existentes (conservador).

A detecção de duplicidade passou a ser um STATUS real, definido apenas no momento
do lançamento. Este script marca, de forma SEGURA, duplicados que já existiam antes
da mudança.

Critério (igual ao da criação):
    mesma Placa/Chassi + data no MESMO MÊS/ANO + ao menos 1 serviço (service_id) em comum.

Regras de segurança:
    - Só considera/altera O.S. com status = 'waiting' (nunca toca em in_progress,
      completed, cancelled, wrong ou já duplicate).
    - Em cada grupo duplicado, mantém a O.S. MAIS ANTIGA como original e marca as
      MAIS NOVAS (por created_at, depois id) como 'duplicate'.
    - Registra uma linha em status_history para cada O.S. alterada.

Uso:
    venv/Scripts/python.exe scripts/backfill_duplicate_status.py --dry-run
    venv/Scripts/python.exe scripts/backfill_duplicate_status.py
"""

import argparse
import asyncio
import pathlib
import sys
from datetime import UTC, datetime

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.modules.service_orders.models import ServiceOrder, ServiceOrderItem, StatusHistory


async def main(dry_run: bool) -> None:
    async with AsyncSessionLocal() as db:
        # Carrega O.S. 'waiting' com data de serviço definida + seus service_ids
        rows = (
            await db.execute(
                select(
                    ServiceOrder.id,
                    ServiceOrder.vehicle_plate,
                    ServiceOrder.service_date,
                    ServiceOrder.created_at,
                    ServiceOrderItem.service_id,
                )
                .join(ServiceOrderItem, ServiceOrderItem.service_order_id == ServiceOrder.id)
                .where(
                    ServiceOrder.status == "waiting",
                    ServiceOrder.service_date.is_not(None),
                )
            )
        ).all()

        # Agrupa por (placa, ano-mês): {key: {order_id: {"created_at", "services"}}}
        grouped: dict[tuple, dict[int, dict]] = {}
        for r in rows:
            key = (r.vehicle_plate, r.service_date.year, r.service_date.month)
            order = grouped.setdefault(key, {}).setdefault(
                r.id, {"created_at": r.created_at, "services": set()}
            )
            order["services"].add(r.service_id)

        to_mark: set[int] = set()
        for orders in grouped.values():
            if len(orders) < 2:
                continue
            # Ordena por created_at (depois id) — a mais antiga é a "original"
            ordered = sorted(
                orders.items(),
                key=lambda kv: (kv[1]["created_at"] or datetime.min.replace(tzinfo=UTC), kv[0]),
            )
            original_id, original = ordered[0]
            original_services = original["services"]
            seen_services = set(original_services)
            for order_id, info in ordered[1:]:
                # Só marca se compartilhar ao menos 1 serviço com alguma O.S. anterior do grupo
                if info["services"] & seen_services:
                    to_mark.add(order_id)
                seen_services |= info["services"]

        print(f"Grupos analisados: {len(grouped)} | O.S. a marcar como 'duplicate': {len(to_mark)}")
        if dry_run:
            print("DRY-RUN: nenhuma alteração gravada.")
            for oid in sorted(to_mark):
                print(f"  - O.S. #{oid}")
            return

        if not to_mark:
            print("Nada a fazer.")
            return

        now = datetime.now(UTC)
        objs = (
            await db.execute(select(ServiceOrder).where(ServiceOrder.id.in_(to_mark)))
        ).scalars().all()
        for so in objs:
            so.status = "duplicate"
            db.add(
                StatusHistory(
                    service_order_id=so.id,
                    from_status="waiting",
                    to_status="duplicate",
                    changed_by_id=None,
                    changed_at=now,
                    notes="Backfill: duplicidade detectada (script)",
                )
            )
        await db.commit()
        print(f"OK: {len(objs)} O.S. marcadas como 'duplicate'.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill conservador do status 'duplicate'.")
    parser.add_argument("--dry-run", action="store_true", help="Apenas simula, sem gravar.")
    args = parser.parse_args()
    asyncio.run(main(args.dry_run))
