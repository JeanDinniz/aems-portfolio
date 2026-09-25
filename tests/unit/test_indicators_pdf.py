"""
Testes do PDF (BI) da tela "Películas" (Indicadores de Películas).

``generate_peliculas_pdf`` é função pura (sem DB) — os testes constroem o
dataclass ``PeliculasPdfData`` diretamente com instâncias reais dos schemas
de ``app.modules.analytics.schemas``.
"""

from datetime import UTC, datetime

from fpdf import FPDF

from app.modules.analytics.indicators_pdf import (
    FiltersLabel,
    PeliculasPdfData,
    _brl,
    _clamp_margin_pct,
    _decimal_br,
    _delta_label,
    _fit_line,
    _margin_pipeline_color,
    _pct,
    _period_tick_label,
    _wrap_text,
    format_period_label,
    generate_peliculas_pdf,
)
from app.modules.analytics.schemas import (
    CommercialPerformanceItem,
    EntriesVsConsumptionPoint,
    FinancialEvolutionPoint,
    FinancialHealth,
    FinancialKpis,
    InventoryKpis,
    KPIValue,
    ProfitabilityItem,
    ProfitabilityResponse,
    ProfitabilityTotal,
    StockHealth,
    StockHealthBucket,
)


def _count_pdf_pages(content: bytes) -> int:
    """Conta páginas reais: '/Type /Page' também casa com '/Type /Pages' (a árvore)."""
    return content.count(b"/Type /Page") - content.count(b"/Type /Pages")


def _snapshot(value: float) -> KPIValue:
    return KPIValue(current=value, previous=value, delta_pct=None)


def _kpi(current: float, previous: float, delta_pct: float | None) -> KPIValue:
    return KPIValue(current=current, previous=previous, delta_pct=delta_pct)


def _filters(**overrides) -> FiltersLabel:
    base = {
        "period": "Setembro/2026",
        "compare": "Mês anterior",
        "brand": "Todas",
        "store": "Todas",
        "department": "Todos",
        "film_type": "Todos",
        "tonality": "Todas",
    }
    base.update(overrides)
    return FiltersLabel(**base)


def _full_data() -> PeliculasPdfData:
    inventory_kpis = InventoryKpis(
        stock_meters=_snapshot(1234.5),
        stock_value=_snapshot(45000.0),
        coverage_days=_snapshot(38.0),
        consumption_meters=_kpi(320.0, 280.0, 14.29),
        applications_count=_kpi(42.0, 38.0, 10.53),
        entries_meters=_kpi(500.0, 400.0, 25.0),
        bobinas_count=_kpi(12.0, 10.0, 20.0),
    )
    profitability = ProfitabilityResponse(
        items=[
            ProfitabilityItem(
                film_type_id=1,
                type_name="Fumê G20",
                tonality="G20",
                consumption_meters=120.0,
                cost=1200.0,
                revenue=6000.0,
                margin_pct=80.0,
                revenue_per_meter=50.0,
            ),
            ProfitabilityItem(
                film_type_id=None,
                type_name="Retalho",
                tonality="G50",
                consumption_meters=0.0,
                cost=0.0,
                revenue=300.0,
                margin_pct=100.0,
                revenue_per_meter=None,
            ),
        ],
        total=ProfitabilityTotal(
            consumption_meters=120.0,
            cost=1200.0,
            revenue=6300.0,
            margin_pct=80.95,
            revenue_per_meter=52.5,
        ),
    )
    stock_health = StockHealth(
        total_bobinas=20,
        coverage_days=38.0,
        breakdown=[
            StockHealthBucket(status="em_estoque", count=10, percentage=50.0),
            StockHealthBucket(status="em_uso", count=5, percentage=25.0),
            StockHealthBucket(status="alerta", count=3, percentage=15.0),
            StockHealthBucket(status="esgotada", count=2, percentage=10.0),
        ],
    )
    entries_vs_consumption = [
        EntriesVsConsumptionPoint(period="2026-07", entries_meters=400.0, consumption_meters=300.0),
        EntriesVsConsumptionPoint(period="2026-08", entries_meters=450.0, consumption_meters=310.0),
        EntriesVsConsumptionPoint(period="2026-09", entries_meters=500.0, consumption_meters=320.0),
    ]
    financial_kpis = FinancialKpis(
        revenue=_kpi(6300.0, 5000.0, 26.0),
        margin_pct=_kpi(80.95, 75.0, 5.95),
        profit=_kpi(5100.0, 4000.0, 27.5),
        avg_ticket=_kpi(150.0, 140.0, 7.14),
        revenue_per_meter=_kpi(52.5, 50.0, 5.0),
        applications_count=_kpi(42.0, 38.0, 10.53),
    )
    commercial_performance = [
        CommercialPerformanceItem(
            store_id=1,
            store_name="Loja Centro",
            types="Fumê, Nano",
            meters=200.0,
            applications=20,
            revenue=4000.0,
        ),
        CommercialPerformanceItem(
            store_id=2,
            store_name="Loja Sul",
            types="Fumê",
            meters=120.0,
            applications=15,
            revenue=2300.0,
        ),
    ]
    financial_health = FinancialHealth(
        stock_value=45000.0, cost_consumed=1200.0, revenue=6300.0, margin=5100.0, roi=5.25
    )
    financial_evolution = [
        FinancialEvolutionPoint(period="2026-07", revenue=5000.0, cost=1000.0, margin_pct=80.0),
        FinancialEvolutionPoint(period="2026-08", revenue=5800.0, cost=1100.0, margin_pct=81.0),
        FinancialEvolutionPoint(period="2026-09", revenue=6300.0, cost=1200.0, margin_pct=80.95),
    ]

    return PeliculasPdfData(
        filters=_filters(),
        generated_at=datetime(2026, 9, 24, 14, 30, tzinfo=UTC),
        generated_by="Jean Owner",
        inventory_kpis=inventory_kpis,
        profitability=profitability,
        stock_health=stock_health,
        entries_vs_consumption=entries_vs_consumption,
        financial_kpis=financial_kpis,
        commercial_performance=commercial_performance,
        commercial_sort_by="revenue",
        financial_health=financial_health,
        financial_evolution=financial_evolution,
        evolution_granularity="month",
    )


def _empty_data() -> PeliculasPdfData:
    zero_snapshot = _snapshot(0.0)
    zero_kpi = _kpi(0.0, 0.0, None)
    return PeliculasPdfData(
        filters=_filters(period="01/09/2026 - 24/09/2026", compare="01/08/2026 - 31/08/2026"),
        generated_at=datetime(2026, 9, 24, 14, 30, tzinfo=UTC),
        generated_by="Jean Owner",
        inventory_kpis=InventoryKpis(
            stock_meters=zero_snapshot,
            stock_value=zero_snapshot,
            coverage_days=zero_snapshot,
            consumption_meters=zero_kpi,
            applications_count=zero_kpi,
            entries_meters=zero_kpi,
            bobinas_count=zero_kpi,
        ),
        profitability=ProfitabilityResponse(
            items=[],
            total=ProfitabilityTotal(
                consumption_meters=0.0,
                cost=0.0,
                revenue=0.0,
                margin_pct=None,
                revenue_per_meter=None,
            ),
        ),
        stock_health=StockHealth(total_bobinas=0, coverage_days=0.0, breakdown=[]),
        entries_vs_consumption=[],
        financial_kpis=FinancialKpis(
            revenue=zero_kpi,
            margin_pct=zero_kpi,
            profit=zero_kpi,
            avg_ticket=zero_kpi,
            revenue_per_meter=zero_kpi,
            applications_count=zero_kpi,
        ),
        commercial_performance=[],
        commercial_sort_by="revenue",
        financial_health=FinancialHealth(
            stock_value=0.0, cost_consumed=0.0, revenue=0.0, margin=0.0, roi=None
        ),
        financial_evolution=[],
        evolution_granularity="month",
    )


class TestGeneratePeliculasPdf:
    def test_full_data_produces_valid_pdf_bytes(self):
        content = generate_peliculas_pdf(_full_data())
        assert content.startswith(b"%PDF")
        assert content.endswith(b"%%EOF\n") or b"%%EOF" in content[-16:]

    def test_empty_data_does_not_crash_and_shows_empty_states(self):
        """Listas vazias, None em delta/roi/margin, tudo zerado — não pode crashar."""
        content = generate_peliculas_pdf(_empty_data())
        assert content.startswith(b"%PDF")

    def test_accented_text_does_not_raise(self):
        data = _full_data()
        data.filters = _filters(store="São João, Estância Velha", brand="Concessionária Ápice")
        data.generated_by = "José Antônio Ção"
        content = generate_peliculas_pdf(data)
        assert content.startswith(b"%PDF")

    def test_long_profitability_table_spans_multiple_pages(self):
        data = _full_data()
        data.profitability = ProfitabilityResponse(
            items=[
                ProfitabilityItem(
                    film_type_id=i,
                    type_name=f"Tipo {i}",
                    tonality="G20",
                    consumption_meters=float(i),
                    cost=float(i * 10),
                    revenue=float(i * 20),
                    margin_pct=50.0,
                    revenue_per_meter=20.0,
                )
                for i in range(1, 81)
            ],
            total=ProfitabilityTotal(
                consumption_meters=3240.0,
                cost=32400.0,
                revenue=64800.0,
                margin_pct=50.0,
                revenue_per_meter=20.0,
            ),
        )
        content = generate_peliculas_pdf(data)
        assert content.startswith(b"%PDF")
        assert _count_pdf_pages(content) > 1

    def test_many_stores_in_commercial_performance_does_not_crash(self):
        data = _full_data()
        data.commercial_performance = [
            CommercialPerformanceItem(
                store_id=i,
                store_name=f"Loja {i}",
                types="Fumê",
                meters=float(i),
                applications=i,
                revenue=float(i * 100),
            )
            for i in range(1, 31)
        ]
        content = generate_peliculas_pdf(data)
        assert content.startswith(b"%PDF")

    def test_zero_max_value_in_charts_does_not_divide_by_zero(self):
        """Todos os pontos com 0 -> max_val cairia pra 0 sem o `or 1.0` de guarda."""
        data = _full_data()
        data.entries_vs_consumption = [
            EntriesVsConsumptionPoint(period="2026-09", entries_meters=0.0, consumption_meters=0.0)
        ]
        data.financial_evolution = [
            FinancialEvolutionPoint(period="2026-09", revenue=0.0, cost=0.0, margin_pct=None)
        ]
        content = generate_peliculas_pdf(data)
        assert content.startswith(b"%PDF")


class TestFormatPeriodLabel:
    def test_full_month_returns_month_year_pt_br(self):
        start = datetime(2026, 9, 1, 0, 0, 0, tzinfo=UTC)
        end = datetime(2026, 9, 30, 23, 59, 59, tzinfo=UTC)
        assert format_period_label(start, end) == "Setembro/2026"

    def test_partial_range_returns_dd_mm_yyyy_range(self):
        start = datetime(2026, 9, 5, 0, 0, 0, tzinfo=UTC)
        end = datetime(2026, 9, 20, 23, 59, 59, tzinfo=UTC)
        assert format_period_label(start, end) == "05/09/2026 - 20/09/2026"


class TestPeriodTickLabel:
    def test_month_granularity(self):
        assert _period_tick_label("2026-09", "month") == "Set/26"

    def test_day_granularity(self):
        assert _period_tick_label("2026-09-05", "day") == "05/09"

    def test_week_granularity(self):
        assert _period_tick_label("2026-36", "week") == "S36/26"

    def test_malformed_period_falls_back_to_raw_value(self):
        assert _period_tick_label("garbage", "month") == "garbage"


class TestPtBrNumberFormatting:
    """🟡8: vírgula decimal BR em _pct/_delta_label/_decimal_br; sinal correto em _brl negativo."""

    def test_decimal_br_uses_comma(self):
        assert _decimal_br(37.5, 1) == "37,5"
        assert _decimal_br(4.2135, 2) == "4,21"
        assert _decimal_br(-2.1, 1) == "-2,1"

    def test_pct_uses_comma(self):
        assert _pct(34.2) == "34,2%"
        assert _pct(None) == "-"

    def test_delta_label_percent_positive_and_negative(self):
        assert _delta_label(12.3) == "+12,3%"
        assert _delta_label(-5.0) == "-5,0%"
        assert _delta_label(None) == "-"

    def test_delta_label_pp_suffix(self):
        assert _delta_label(-2.1, "pp") == "-2,1 p.p."
        assert _delta_label(5.95, "pp") == "+6,0 p.p."

    def test_brl_negative_prefixes_minus_before_rs(self):
        assert _brl(-12345.6) == "-R$ 12.345,60"

    def test_brl_positive_has_no_sign(self):
        assert _brl(1234.5) == "R$ 1.234,50"
        assert _brl(0) == "R$ 0,00"
        assert _brl(None) == "R$ 0,00"


class TestFitLineEllipsis:
    """🟠4: _fit_line acrescenta "..." quando corta (nunca esconde o corte)."""

    def _pdf(self) -> FPDF:
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("helvetica", "", 8)
        return pdf

    def test_short_text_is_not_touched(self):
        pdf = self._pdf()
        assert _fit_line(pdf, "Fumê", 40) == "Fumê"

    def test_long_text_is_cut_with_ellipsis(self):
        pdf = self._pdf()
        text = "Película Nano Cerâmica Premium Extra Longa Demais Para Uma Coluna"
        result = _fit_line(pdf, text, 30)
        assert result.endswith("...")
        assert result != text
        assert pdf.get_string_width(result) <= 30 - 1.6

    def test_extremely_narrow_column_falls_back_to_raw_cut(self):
        pdf = self._pdf()
        result = _fit_line(pdf, "Palavra Longa", 3)
        # Não deve estourar a largura nem quebrar, mesmo sem espaço pra "..."
        assert pdf.get_string_width(result) <= 3


class TestWrapTextDoesNotTruncate:
    """🟠4: bloco de Filtros usa _wrap_text — listas longas aparecem inteiras, sem cortar."""

    def _pdf(self) -> FPDF:
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("helvetica", "", 7.5)
        return pdf

    def test_long_store_list_is_fully_preserved_across_lines(self):
        pdf = self._pdf()
        names = ", ".join(f"Loja {i} da Concessionária Premium" for i in range(15))
        lines = _wrap_text(pdf, names, 120)
        assert len(lines) > 1
        # Reconstituir as linhas recupera exatamente o texto original (só
        # reparte nos espaços, nunca corta uma palavra sem necessidade).
        assert " ".join(lines) == names

    def test_single_short_value_returns_one_line(self):
        pdf = self._pdf()
        assert _wrap_text(pdf, "Todas", 120) == ["Todas"]

    def test_empty_value_returns_one_empty_line(self):
        pdf = self._pdf()
        assert _wrap_text(pdf, "", 120) == [""]


class TestMarginClampAndColor:
    """🟡9: margem fora de 0-100 clampa mas sinaliza; margem negativa fica vermelha."""

    def test_within_range_is_not_flagged(self):
        assert _clamp_margin_pct(50.0) == (50.0, False)

    def test_above_range_clamps_to_100_and_flags(self):
        assert _clamp_margin_pct(120.0) == (100.0, True)

    def test_below_range_clamps_to_0_and_flags(self):
        assert _clamp_margin_pct(-10.0) == (0.0, True)

    def test_negative_margin_pipeline_bar_is_red(self):
        from app.modules.analytics.indicators_pdf import RED

        assert _margin_pipeline_color(-100.0) == RED

    def test_non_negative_margin_pipeline_bar_is_dark_green(self):
        from app.modules.analytics.indicators_pdf import DARK_GREEN

        assert _margin_pipeline_color(0.0) == DARK_GREEN
        assert _margin_pipeline_color(5000.0) == DARK_GREEN


class TestOrphanTitleReservation:
    """
    🟠3: título de card/seção reserva a si mesmo + o que vem logo depois
    ANTES de desenhar — a reserva usada pelo título tem que ser >= altura
    real do que será desenhado a seguir, senão o título ainda pode ficar
    sozinho no rodapé.
    """

    def test_card_title_reservation_covers_title_plus_subtitle_plus_following(self):
        from app.modules.analytics.indicators_pdf import (
            CARD_SUBTITLE_LINE_H,
            CARD_TITLE_LINE_H,
            CARD_TITLE_SPACER,
            _card_title_reservation,
        )

        following = 11.5
        reservation = _card_title_reservation(True) + following
        assert (
            reservation == CARD_TITLE_LINE_H + CARD_SUBTITLE_LINE_H + CARD_TITLE_SPACER + following
        )

    def test_card_block_min_height_matches_table_header_plus_row(self):
        from app.modules.analytics.indicators_pdf import (
            TABLE_HEADER_H,
            TABLE_ROW_H,
            _card_block_min_height,
        )

        following = TABLE_HEADER_H + TABLE_ROW_H
        assert _card_block_min_height(True, following) > following

    def test_section_title_reservation_is_positive(self):
        from app.modules.analytics.indicators_pdf import _section_title_reservation

        assert _section_title_reservation() > 0


class TestRankingSubtitleAndRepeatTitle:
    """🟡10: "Ranking por <métrica>" antes das barras da Performance Comercial."""

    def test_pdf_with_many_stores_ranking_does_not_crash_across_page_break(self):
        data = _full_data()
        data.commercial_performance = [
            CommercialPerformanceItem(
                store_id=i,
                store_name=f"Loja {i} Extenso o Suficiente Pra Testar Quebra",
                types="Fumê, Nano, Carbono",
                meters=float(i),
                applications=i,
                revenue=float(3000 - i * 10),
            )
            for i in range(1, 61)
        ]
        content = generate_peliculas_pdf(data)
        assert content.startswith(b"%PDF")
        assert _count_pdf_pages(content) > 1
