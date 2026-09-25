"""
Auditoria: enriquecimento dos registros de bobina (film_roll) com dados
identificadores (tipo, tonalidade, data de recebimento e data de criação).
"""

from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditLog
from app.modules.inventory.models import FilmRoll, FilmType
from app.modules.stores.models import Store


@pytest.mark.asyncio
async def test_film_roll_audit_log_includes_roll_details(
    owner_client: AsyncClient,
    db_session: AsyncSession,
    test_store: Store,
):
    """Registro de auditoria de bobina traz tipo, tonalidade e datas no detalhe."""
    ft = FilmType(name="Poliester Auditoria", department="film", available_tonalities=["G20"])
    db_session.add(ft)
    await db_session.flush()

    roll = FilmRoll(
        store_id=test_store.id,
        film_type_id=ft.id,
        tonality="G20",
        total_meters=50.0,
        remaining_meters=0.0,
        receipt_date=date(2026, 7, 1),
        status="esgotada",
    )
    db_session.add(roll)
    await db_session.flush()

    db_session.add(
        AuditLog(
            action="exhaust",
            resource_type="film_roll",
            resource_id=roll.id,
            old_value={"status": "em_uso"},
            new_value={"status": "esgotada"},
        )
    )
    await db_session.commit()

    resp = await owner_client.get("/api/v1/audit-logs", params={"resource_type": "film_roll"})
    assert resp.status_code == 200, resp.text

    item = next(i for i in resp.json()["items"] if i["resource_id"] == roll.id)
    detail = item["resource_detail"]
    assert detail is not None
    assert detail["film_type_name"] == "Poliester Auditoria"
    assert detail["tonality"] == "G20"
    assert detail["receipt_date"] == "2026-07-01"
    assert detail["created_at"] is not None


@pytest.mark.asyncio
async def test_non_film_roll_audit_log_has_no_resource_detail(
    owner_client: AsyncClient,
    db_session: AsyncSession,
):
    """Registros que não são de bobina não recebem resource_detail."""
    db_session.add(
        AuditLog(
            action="update",
            resource_type="service_order",
            resource_id=999999,
            old_value={"status": "waiting"},
            new_value={"status": "completed"},
        )
    )
    await db_session.commit()

    resp = await owner_client.get("/api/v1/audit-logs", params={"resource_type": "service_order"})
    assert resp.status_code == 200, resp.text
    for item in resp.json()["items"]:
        assert item["resource_detail"] is None


# ─── Export CSV ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_export_csv_returns_csv_with_bom_header_and_rows(
    owner_client: AsyncClient,
    db_session: AsyncSession,
):
    """Export gera CSV com BOM UTF-8, cabeçalho e as linhas filtradas."""
    db_session.add(
        AuditLog(
            action="update",
            resource_type="service_order",
            resource_id=424242,
            old_value={"status": "waiting"},
            new_value={"status": "completed"},
            ip_address="10.0.0.1",
        )
    )
    await db_session.commit()

    resp = await owner_client.get(
        "/api/v1/audit-logs/export", params={"resource_type": "service_order"}
    )
    assert resp.status_code == 200, resp.text
    assert "text/csv" in resp.headers["content-type"]
    assert "attachment" in resp.headers["content-disposition"]
    assert ".csv" in resp.headers["content-disposition"]

    body = resp.text
    # BOM UTF-8 no início — faz o Excel abrir como UTF-8
    assert body.startswith("﻿")
    # Cabeçalho
    assert "created_at" in body
    assert "resource_type" in body
    # Linha de dados
    assert "service_order" in body
    assert "424242" in body


@pytest.mark.asyncio
async def test_export_csv_escapes_fields_with_commas_and_quotes(
    owner_client: AsyncClient,
    db_session: AsyncSession,
):
    """Campos com vírgula/aspas/quebra de linha são escapados conforme RFC 4180."""
    db_session.add(
        AuditLog(
            action="update",
            resource_type="service_order",
            resource_id=515151,
            new_value={"notes": 'texto com, vírgula e "aspas"'},
        )
    )
    await db_session.commit()

    resp = await owner_client.get(
        "/api/v1/audit-logs/export", params={"resource_id": 515151}
    )
    assert resp.status_code == 200, resp.text
    body = resp.text
    # O JSON serializado do new_value tem vírgula e aspas → o campo inteiro vem
    # entre aspas e cada aspa interna é duplicada (RFC 4180). A chave "notes"
    # aparece como ""notes"".
    assert '"{""notes""' in body


@pytest.mark.asyncio
async def test_export_csv_forbidden_for_non_owner(
    authenticated_client: AsyncClient,
):
    """Somente Owner pode exportar a auditoria."""
    resp = await authenticated_client.get("/api/v1/audit-logs/export")
    assert resp.status_code == 403
