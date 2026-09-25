"""
Testes do ConferenceExcelWriter (export incremental da Conferência).

Garante que a escrita em lotes (add_orders chamado várias vezes) produz um
Excel byte-a-byte com o mesmo conteúdo de células que a chamada única
(generate_conference_excel) — regressão do refactor de carga em lotes.
"""

from datetime import UTC, date, datetime
from io import BytesIO
from types import SimpleNamespace

import openpyxl

from app.modules.service_orders.export import (
    ConferenceExcelWriter,
    generate_conference_excel,
)

# ---------------------------------------------------------------------------
# Helpers — objetos stub simples (SimpleNamespace), mesmo estilo do
# test_export_fechamento.py
# ---------------------------------------------------------------------------


def _svc(name: str, code: str = "") -> SimpleNamespace:
    return SimpleNamespace(name=name, code=code)


def _item(
    svc_name: str | None,
    unit_price: float = 100.0,
    quantity: int = 1,
    code: str = "",
    tonality: str = "",
    roll_code: str = "",
) -> SimpleNamespace:
    service = _svc(svc_name, code) if svc_name is not None else None
    return SimpleNamespace(
        service=service,
        unit_price=unit_price,
        quantity=quantity,
        tonality=tonality,
        roll_code=roll_code,
    )


def _order(order_id: int, department: str, items: list, **overrides) -> SimpleNamespace:
    defaults = dict(
        id=order_id,
        department=department,
        items=items,
        store=SimpleNamespace(name=f"Loja {order_id % 3 + 1}"),
        is_galpon=order_id % 2 == 0,
        service_date=date(2026, 7, (order_id % 28) + 1),
        entry_time=datetime(2026, 7, 1, 8, 0, tzinfo=UTC),
        external_os_number=f"EXT-{order_id}" if order_id % 2 else None,
        order_number=f"LJA-2607-{order_id:03d}",
        vehicle_plate=f"ABC{order_id:04d}",
        is_courtesy=order_id % 5 == 0,
        is_return=False,
        consultant=None,
        consultant_name=f"Consultor {order_id}",
        vehicle_brand="Toyota",
        vehicle_model="Corolla",
        vehicle_color="Prata",
        notes="",
        internal_notes=None,
        execution_notes=None,
        invoice_number=None,
        is_verified=order_id % 2 == 0,
        status="completed" if order_id % 2 == 0 else "waiting",
        workers=[],
        created_at=datetime(2026, 7, 1, 8, 0, tzinfo=UTC),
        updated_at=None,
        created_by=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _make_orders(n: int) -> list[SimpleNamespace]:
    orders = []
    for i in range(1, n + 1):
        items = (
            [
                _item("Película Premium", unit_price=350.0, code="PEL01", tonality="G20"),
                _item("Lavagem Simples", unit_price=50.0, code="LAV01"),
            ]
            if i % 3
            else []  # algumas O.S. sem itens (linha zerada)
        )
        orders.append(_order(i, "film" if i % 2 else "workshop", items))
    return orders


def _cell_values(content: bytes) -> list[list]:
    wb = openpyxl.load_workbook(BytesIO(content))
    ws = wb.active
    return [[c.value for c in row] for row in ws.iter_rows()]


# ---------------------------------------------------------------------------
# Testes
# ---------------------------------------------------------------------------


class TestConferenceWriterBatchEquivalence:
    def test_lotes_produzem_mesmo_conteudo_que_chamada_unica(self):
        orders = _make_orders(10)

        single = generate_conference_excel(orders)

        writer = ConferenceExcelWriter()
        writer.add_orders(orders[:4])
        writer.add_orders(orders[4:7])
        writer.add_orders(orders[7:])
        batched = writer.finish()

        assert _cell_values(single) == _cell_values(batched)

    def test_lote_vazio_nao_quebra(self):
        writer = ConferenceExcelWriter()
        writer.add_orders([])
        content = writer.finish()
        assert _cell_values(content) == _cell_values(generate_conference_excel([]))

    def test_linhas_por_item_e_sem_itens(self):
        # 1 O.S. com 2 itens (2 linhas) + 1 O.S. sem itens (1 linha) = 3 linhas de dados
        orders = [
            _order(1, "film", [_item("Película", code="P1"), _item("PPF", code="P2")]),
            _order(2, "workshop", []),
        ]
        rows = _cell_values(generate_conference_excel(orders))
        # linha 1 = cabeçalho do template; dados começam na linha 2
        data_rows = [r for r in rows[1:] if r[4]]  # coluna E: Placa preenchida
        assert len(data_rows) == 3

    def test_observacoes_internas_vao_para_obs_conferencia(self):
        """internal_notes da O.S. deve aparecer na coluna V (Obs Conferência)."""
        orders = [
            _order(1, "film", [_item("Película", code="P1")], internal_notes="Cliente reclamou"),
            _order(2, "workshop", [], internal_notes="Sem NF"),
        ]
        rows = _cell_values(generate_conference_excel(orders))
        data_rows = [r for r in rows[1:] if r[4]]  # coluna E: Placa preenchida
        # Coluna V = índice 21 (0-based); L (Briefing do Consultor) = índice 11
        assert data_rows[0][21] == "Cliente reclamou"
        assert data_rows[1][21] == "Sem NF"
        assert data_rows[0][11] in (None, "")  # notes (Briefing do Consultor) segue vazio

    def test_briefing_e_relato_tecnico_em_colunas_separadas(self):
        """notes (briefing do consultor) e execution_notes (relato do instalador)
        devem aparecer em colunas distintas — L e M respectivamente."""
        orders = [
            _order(
                1,
                "film",
                [_item("Película", code="P1")],
                notes="Cliente pediu cuidado com o para-choque",
                execution_notes="Aplicado sem bolhas, checado após 24h",
            ),
        ]
        rows = _cell_values(generate_conference_excel(orders))
        data_rows = [r for r in rows[1:] if r[4]]  # coluna E: Placa preenchida
        # L (Briefing do Consultor) = índice 11; M (Relato Técnico do Instalador) = índice 12
        assert data_rows[0][11] == "Cliente pediu cuidado com o para-choque"
        assert data_rows[0][12] == "Aplicado sem bolhas, checado após 24h"

    def test_relato_tecnico_ausente_fica_vazio(self):
        orders = [
            _order(1, "film", [_item("Película", code="P1")], execution_notes=None),
        ]
        rows = _cell_values(generate_conference_excel(orders))
        data_rows = [r for r in rows[1:] if r[4]]
        assert data_rows[0][12] in (None, "")
