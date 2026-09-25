"""
Geração de PDF (BI) da tela "Películas" (Indicadores de Películas).

A4 paisagem. Reaproveita o estilo dos demais PDFs do sistema (cabeçalho
laranja, fontes core latin-1 — ver ``installer_performance/pdf.py`` e
``scheduling/carros_pdf.py``): helpers ``_latin1``/``_brl``/``_fit_line``
duplicados de propósito (mesmo padrão dos dois módulos citados — cada PDF é
autocontido).

Gotcha latin-1: bullets/em-dash/setas não existem nas fontes core do fpdf2 —
usar "·", "-", "+"/"-" ou "^"/"v".

``generate_peliculas_pdf`` é uma função PURA (recebe só o dataclass
``PeliculasPdfData``, sem tocar em banco) — testável sem DB. A resolução dos
nomes de filtro (marca/loja/tipo) por id mora em
``app.modules.analytics.service.resolve_filters_label`` (precisa de
``AsyncSession`` — fica fora deste módulo, que não toca banco).

Orfandade de título: todo bloco (título de seção/card + o que vem logo
depois — gráfico inteiro, cabeçalho de tabela + 1ª linha, ou "Sem dados")
reserva o espaço do bloco INTEIRO (``_ensure_space``) ANTES de desenhar
qualquer coisa — nunca deixa um título sozinho no rodapé da página com o
conteúdo indo pra próxima.
"""

from __future__ import annotations

import calendar
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from fpdf import FPDF

from app.modules.analytics.schemas import (
    CommercialPerformanceItem,
    EntriesVsConsumptionPoint,
    FinancialEvolutionPoint,
    FinancialHealth,
    FinancialKpis,
    InventoryKpis,
    ProfitabilityResponse,
    StockHealth,
)

# =============================================================================
# Cores / layout (mesma paleta do restante do sistema)
# =============================================================================

ORANGE = (232, 138, 0)
DARK = (23, 23, 23)
GRAY = (120, 120, 120)
LIGHT_GRAY = (200, 200, 200)
LINE_GRAY = (225, 225, 225)
GREEN = (30, 140, 60)
DARK_GREEN = (20, 100, 40)
RED = (200, 40, 40)
BLUE = (40, 90, 200)
ZEBRA = (250, 250, 250)
HEADER_FILL = (245, 245, 245)

MARGIN = 10
PAGE_W = 297  # A4 paisagem
CONTENT_W = PAGE_W - 2 * MARGIN  # 277

# --- Constantes de layout usadas TANTO pra desenhar QUANTO pra reservar
# espaço (``_ensure_space``) antes de desenhar — um único número por peça,
# nunca duas contas que podem divergir.
CARD_TITLE_LINE_H = 5.0
CARD_SUBTITLE_LINE_H = 4.0
CARD_TITLE_SPACER = 0.5

SECTION_TITLE_PRE_LN = 2.0
SECTION_TITLE_CELL_H = 7.0
SECTION_TITLE_POST_LN = 2.5

TABLE_HEADER_H = 6.0
TABLE_ROW_H = 5.5
EMPTY_STATE_H = 16.0

BAR_H = 5.5
BAR_GAP = 3.0

KPI_CARD_H = 20.0
KPI_CARD_GAP = 3.0

CHART_H = 55.0
CHART_LEGEND_H = 6.0
CHART_TICK_H = 6.0
CHART_BUFFER = 4.0

DEPARTMENT_LABELS: dict[str, str] = {
    "film": "Película",
    "security_film": "Segurança",
    "ppf": "PPF",
}

STOCK_STATUS_LABELS: dict[str, str] = {
    "em_estoque": "Em Estoque",
    "em_uso": "Em Uso",
    "alerta": "Em Alerta",
    "esgotada": "Finalizadas",
}

STOCK_STATUS_COLORS: dict[str, tuple[int, int, int]] = {
    "em_estoque": ORANGE,
    "em_uso": BLUE,
    "alerta": (200, 120, 0),
    "esgotada": GRAY,
}

MONTHS_PT = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
]

MONTHS_PT_ABBR = [
    "Jan",
    "Fev",
    "Mar",
    "Abr",
    "Mai",
    "Jun",
    "Jul",
    "Ago",
    "Set",
    "Out",
    "Nov",
    "Dez",
]


# =============================================================================
# Dados de entrada (dataclasses — testável sem DB)
# =============================================================================


@dataclass
class FiltersLabel:
    """Rótulos já resolvidos (nomes, não ids) do bloco "Filtros aplicados"."""

    period: str
    compare: str
    brand: str
    store: str
    department: str
    film_type: str
    tonality: str


@dataclass
class PeliculasPdfData:
    """Tudo que ``generate_peliculas_pdf`` precisa — os 8 resultados + labels."""

    filters: FiltersLabel
    generated_at: datetime  # já em America/Sao_Paulo
    generated_by: str

    inventory_kpis: InventoryKpis
    profitability: ProfitabilityResponse
    stock_health: StockHealth
    entries_vs_consumption: list[EntriesVsConsumptionPoint]

    financial_kpis: FinancialKpis
    commercial_performance: list[CommercialPerformanceItem]
    commercial_sort_by: Literal["revenue", "meters", "applications"]
    financial_health: FinancialHealth
    financial_evolution: list[FinancialEvolutionPoint]
    evolution_granularity: Literal["day", "week", "month"]


# =============================================================================
# Formatação (BR) e helpers de texto
# =============================================================================


def _latin1(text: str) -> str:
    """Fontes core do fpdf2 são latin-1; substitui o que não couber."""
    return (text or "").encode("latin-1", "replace").decode("latin-1")


def _decimal_br(value: float, decimals: int = 1) -> str:
    """Formata um float com vírgula decimal BR, sem separador de milhar (mantém o sinal)."""
    return f"{value:.{decimals}f}".replace(".", ",")


def _brl(value: float | None) -> str:
    v = float(value or 0)
    sign = "-" if v < 0 else ""
    formatted = f"{abs(v):,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")
    return f"{sign}R$ {formatted}"


def _meters(value: float | None, decimals: int = 1) -> str:
    v = float(value or 0)
    sign = "-" if v < 0 else ""
    formatted = f"{abs(v):,.{decimals}f}".replace(",", "@").replace(".", ",").replace("@", ".")
    return f"{sign}{formatted} m"


def _pct(value: float | None, decimals: int = 1) -> str:
    if value is None:
        return "-"
    return f"{_decimal_br(float(value), decimals)}%"


def _num(value: float | None) -> str:
    return f"{int(round(float(value or 0))):,}".replace(",", ".")


def _fit_line(pdf: FPDF, text: str, width: float) -> str:
    """
    Uma linha só: corta o excedente que não cabe na coluna, acrescentando
    "..." pra sinalizar o corte (nunca esconde silenciosamente que o texto
    foi truncado).
    """
    text = _latin1(text)
    usable = width - 1.6
    if pdf.get_string_width(text) <= usable:
        return text
    ellipsis = "..."
    ellipsis_w = pdf.get_string_width(ellipsis)
    if ellipsis_w >= usable:
        # Coluna estreita demais até pra "..." — corta cru, sem reticências.
        cut = len(text)
        while cut > 0 and pdf.get_string_width(text[:cut]) > usable:
            cut -= 1
        return text[:cut]
    cut = len(text)
    while cut > 0 and pdf.get_string_width(text[:cut]) + ellipsis_w > usable:
        cut -= 1
    return text[:cut].rstrip() + ellipsis


def _wrap_text(pdf: FPDF, text: str, width: float) -> list[str]:
    """
    Quebra texto em linhas que cabem na largura — SEM truncar (mesmo padrão
    de ``scheduling/carros_pdf.py::_wrap_text``). Usado no bloco "Filtros
    aplicados", onde listas longas de lojas/tipos/marcas precisam aparecer
    inteiras, não cortadas.
    """
    text = _latin1(text)
    if not text:
        return [""]
    usable = width - 1.6
    words = text.split(" ")
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if pdf.get_string_width(candidate) <= usable:
            current = candidate
        else:
            if current:
                lines.append(current)
            while pdf.get_string_width(word) > usable and len(word) > 1:
                cut = len(word)
                while cut > 1 and pdf.get_string_width(word[:cut]) > usable:
                    cut -= 1
                lines.append(word[:cut])
                word = word[cut:]
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def format_period_label(start: datetime, end: datetime) -> str:
    """ "Setembro/2026" quando o período cobre o mês inteiro; senão dd/mm/aaaa-dd/mm/aaaa."""
    same_month = start.year == end.year and start.month == end.month
    last_day = calendar.monthrange(end.year, end.month)[1]
    if same_month and start.day == 1 and end.day == last_day:
        return f"{MONTHS_PT[start.month - 1]}/{start.year}"
    return f"{start.strftime('%d/%m/%Y')} - {end.strftime('%d/%m/%Y')}"


def join_or_default(names: list[str], empty_label: str) -> str:
    return ", ".join(names) if names else empty_label


def _period_tick_label(period: str, granularity: str) -> str:
    """Rótulo curto de eixo X a partir do period (YYYY-MM-DD | YYYY-IW | YYYY-MM)."""
    try:
        if granularity == "month":
            year, month = period.split("-")
            return f"{MONTHS_PT_ABBR[int(month) - 1]}/{year[2:]}"
        if granularity == "week":
            year, week = period.split("-")
            return f"S{week}/{year[2:]}"
        # day
        year, month, day = period.split("-")
        return f"{day}/{month}"
    except (ValueError, IndexError):
        return period


def _delta_color(delta: float | None) -> tuple[int, int, int]:
    if not delta:
        return GRAY
    return GREEN if delta > 0 else RED


def _delta_label(delta: float | None, suffix: str = "%") -> str:
    if delta is None:
        return "-"
    sign = "+" if delta > 0 else ""
    formatted = _decimal_br(delta, 1)
    if suffix == "pp":
        return f"{sign}{formatted} p.p."
    return f"{sign}{formatted}%"


def _margin_pipeline_color(margin: float) -> tuple[int, int, int]:
    """Cor da barra de Margem na Saúde Financeira — vermelho quando negativa (sem abs escondendo o sinal)."""
    return RED if margin < 0 else DARK_GREEN


def _clamp_margin_pct(value: float) -> tuple[float, bool]:
    """Clampa a margem % em [0,100] pra plotar no gráfico; sinaliza se estava fora da faixa."""
    clamped = max(0.0, min(100.0, value))
    return clamped, clamped != value


# =============================================================================
# Primitivas de desenho
# =============================================================================


def _ensure_space(pdf: FPDF, height: float) -> None:
    """Quebra de página se o próximo bloco (título, gráfico, cards) não couber inteiro."""
    if pdf.get_y() + height > pdf.page_break_trigger:
        pdf.add_page()


def _card_title_reservation(has_subtitle: bool) -> float:
    return CARD_TITLE_LINE_H + (CARD_SUBTITLE_LINE_H if has_subtitle else 0.0) + CARD_TITLE_SPACER


def _card_block_min_height(has_subtitle: bool, following: float) -> float:
    """Altura mínima de um card (título + o que vem logo depois) — pra reservar no título de seção."""
    return _card_title_reservation(has_subtitle) + following


def _section_title_reservation() -> float:
    return SECTION_TITLE_PRE_LN + SECTION_TITLE_CELL_H + SECTION_TITLE_POST_LN


def _draw_section_title(pdf: FPDF, title: str, min_following: float = 0.0) -> None:
    """
    Título de seção ("Estoque"/"Faturamento"). Reserva a si mesmo + o
    ``min_following`` (o bloco que vem logo em seguida) ANTES de desenhar —
    se não couber, os dois vão juntos pra próxima página.
    """
    _ensure_space(pdf, _section_title_reservation() + min_following)
    pdf.ln(SECTION_TITLE_PRE_LN)
    pdf.set_font("helvetica", "B", 12)
    pdf.set_text_color(*DARK)
    pdf.cell(0, SECTION_TITLE_CELL_H, _latin1(title), new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(*ORANGE)
    pdf.set_line_width(0.5)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())
    pdf.ln(SECTION_TITLE_POST_LN)


def _draw_card_title(pdf: FPDF, title: str, subtitle: str = "", min_following: float = 0.0) -> None:
    """
    Título de card ("Rentabilidade do Consumo", "Entradas x Consumo", ...).
    Reserva a si mesmo + ``min_following`` (gráfico inteiro, ou cabeçalho de
    tabela + 1ª linha, ou "Sem dados") ANTES de desenhar qualquer coisa —
    nunca fica sozinho no rodapé com o conteúdo indo pra página seguinte.
    """
    _ensure_space(pdf, _card_title_reservation(bool(subtitle)) + min_following)
    pdf.set_font("helvetica", "B", 9)
    pdf.set_text_color(*DARK)
    pdf.cell(0, CARD_TITLE_LINE_H, _latin1(title), new_x="LMARGIN", new_y="NEXT")
    if subtitle:
        pdf.set_font("helvetica", "", 6.5)
        pdf.set_text_color(*GRAY)
        pdf.cell(0, CARD_SUBTITLE_LINE_H, _latin1(subtitle), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(CARD_TITLE_SPACER)


def _draw_empty_state(pdf: FPDF, height: float = EMPTY_STATE_H) -> None:
    pdf.set_font("helvetica", "I", 8)
    pdf.set_text_color(*GRAY)
    pdf.cell(0, height, _latin1("Sem dados no período"), align="C", new_x="LMARGIN", new_y="NEXT")


def _draw_filters_block(pdf: FPDF, filters: FiltersLabel) -> None:
    """
    Bloco "Filtros aplicados": 2 colunas x 4 linhas, com QUEBRA DE LINHA
    (``_wrap_text``, sem truncar) — listas longas de lojas/tipos/marcas
    aparecem inteiras, cada linha do bloco cresce na altura que precisar.
    """
    rows_fields = [
        ("PERÍODO", filters.period, "COMPARAR COM", filters.compare),
        ("MARCA", filters.brand, "LOJA", filters.store),
        ("DEPARTAMENTO", filters.department, "TIPO", filters.film_type),
        ("TONALIDADE", filters.tonality, "", ""),
    ]
    col_w = CONTENT_W / 2
    line_h = 3.6
    label_h = 3.6
    pad_top = 1.2
    pad_bottom = 1.8

    pdf.set_font("helvetica", "", 7.5)
    wrapped_rows: list[tuple[str, list[str], str, list[str]]] = []
    row_heights: list[float] = []
    for label_l, value_l, label_r, value_r in rows_fields:
        lines_l = _wrap_text(pdf, value_l, col_w - 6) if value_l else [""]
        lines_r = _wrap_text(pdf, value_r, col_w - 6) if value_r else [""]
        n_lines = max(len(lines_l), len(lines_r), 1)
        row_h = label_h + pad_top + n_lines * line_h + pad_bottom
        wrapped_rows.append((label_l, lines_l, label_r, lines_r))
        row_heights.append(row_h)

    title_h = 6.0
    _ensure_space(pdf, title_h + sum(row_heights))

    pdf.set_font("helvetica", "B", 10)
    pdf.set_text_color(*DARK)
    pdf.cell(0, title_h, _latin1("Filtros aplicados"), new_x="LMARGIN", new_y="NEXT")

    x0 = MARGIN
    y0 = pdf.get_y() + 1
    pdf.set_draw_color(*LINE_GRAY)
    pdf.set_line_width(0.25)
    pdf.rect(x0, y0, CONTENT_W, sum(row_heights))

    y = y0
    for (label_l, lines_l, label_r, lines_r), row_h in zip(wrapped_rows, row_heights, strict=True):
        for col, (label, lines) in enumerate(((label_l, lines_l), (label_r, lines_r))):
            if not label:
                continue
            x = x0 + col * col_w
            pdf.set_xy(x + 3, y + pad_top)
            pdf.set_font("helvetica", "", 6)
            pdf.set_text_color(*GRAY)
            pdf.cell(col_w - 6, label_h, _latin1(label))
            for i, line in enumerate(lines):
                pdf.set_xy(x + 3, y + pad_top + label_h + i * line_h)
                pdf.set_font("helvetica", "B", 7.5)
                pdf.set_text_color(*DARK)
                pdf.cell(col_w - 6, line_h, line)
        y += row_h
    pdf.set_y(y0 + sum(row_heights) + 3)


def _draw_kpi_cards(pdf: FPDF, cards: list[tuple[str, str, float | None, str]]) -> None:
    """cards: (label, value, delta_pct, delta_suffix)."""
    n = len(cards)
    gap = KPI_CARD_GAP
    card_w = (CONTENT_W - gap * (n - 1)) / n
    card_h = KPI_CARD_H
    _ensure_space(pdf, card_h + gap)
    y = pdf.get_y()
    x = MARGIN
    pdf.set_draw_color(*LIGHT_GRAY)
    pdf.set_line_width(0.25)
    for label, value, delta, suffix in cards:
        pdf.rect(x, y, card_w, card_h)
        pdf.set_xy(x + 2, y + 2)
        pdf.set_font("helvetica", "", 6)
        pdf.set_text_color(*GRAY)
        pdf.cell(card_w - 4, 3.2, _fit_line(pdf, label, card_w - 4))
        pdf.set_xy(x + 2, y + 6.5)
        pdf.set_font("helvetica", "B", 11)
        pdf.set_text_color(*ORANGE)
        pdf.cell(card_w - 4, 6, _fit_line(pdf, value, card_w - 4))
        pdf.set_xy(x + 2, y + 14.5)
        pdf.set_font("helvetica", "B", 7)
        pdf.set_text_color(*_delta_color(delta))
        pdf.cell(card_w - 4, 4, _fit_line(pdf, _delta_label(delta, suffix), card_w - 4))
        x += card_w + gap
    pdf.set_y(y + card_h + gap)


# --- Tabelas genéricas -------------------------------------------------------

# (título, largura mm, alinhamento)
TableCol = tuple[str, float, str]


def _draw_table_header(pdf: FPDF, cols: list[TableCol]) -> None:
    pdf.set_font("helvetica", "B", 7)
    pdf.set_fill_color(*HEADER_FILL)
    pdf.set_draw_color(*LIGHT_GRAY)
    pdf.set_line_width(0.2)
    y = pdf.get_y()
    pdf.rect(MARGIN, y, CONTENT_W, TABLE_HEADER_H, style="F")
    x = MARGIN
    pdf.set_text_color(*GRAY)
    for title, width, align in cols:
        pdf.set_xy(x + 1, y + 1)
        pdf.cell(width - 2, 4, _latin1(title), align=align)
        x += width
    pdf.set_y(y + TABLE_HEADER_H)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())


def _draw_table_row(
    pdf: FPDF,
    cols: list[TableCol],
    values: list[str],
    zebra: bool,
    row_h: float = TABLE_ROW_H,
    bold: bool = False,
    first_col_color: tuple[int, int, int] | None = None,
) -> None:
    if pdf.get_y() + row_h > pdf.page_break_trigger:
        pdf.add_page()
        _draw_table_header(pdf, cols)
    y = pdf.get_y()
    if zebra:
        pdf.set_fill_color(*ZEBRA)
        pdf.rect(MARGIN, y, CONTENT_W, row_h, style="F")
    x = MARGIN
    pdf.set_font("helvetica", "B" if bold else "", 7.5)
    for i, ((_title, width, align), val) in enumerate(zip(cols, values, strict=True)):
        color = first_col_color if (i == 0 and first_col_color is not None) else DARK
        pdf.set_text_color(*color)
        pdf.set_xy(x + 1, y + 0.7)
        pdf.cell(width - 2, row_h - 1.2, _fit_line(pdf, val, width - 2), align=align)
        x += width
    pdf.set_y(y + row_h)
    pdf.set_draw_color(*LINE_GRAY)
    pdf.set_line_width(0.15)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())


# --- Gráficos nativos (rect/line do fpdf2) -----------------------------------


def _draw_legend(pdf: FPDF, items: list[tuple[str, tuple[int, int, int]]]) -> None:
    pdf.set_font("helvetica", "", 6.5)
    x = MARGIN
    y = pdf.get_y()
    for label, color in items:
        pdf.set_fill_color(*color)
        pdf.rect(x, y + 0.6, 2.6, 2.6, style="F")
        pdf.set_xy(x + 3.6, y)
        pdf.set_text_color(*GRAY)
        text = _latin1(label)
        pdf.cell(pdf.get_string_width(text) + 6, 4, text)
        x += pdf.get_string_width(text) + 12
    pdf.set_y(y + 5)


def _draw_entries_consumption_chart(pdf: FPDF, points: list[EntriesVsConsumptionPoint]) -> None:
    following = CHART_LEGEND_H + CHART_H + CHART_TICK_H + CHART_BUFFER if points else EMPTY_STATE_H
    _draw_card_title(
        pdf,
        "Entradas x Consumo",
        "Tendência de variação de estoque mensal",
        min_following=following,
    )
    if not points:
        _draw_empty_state(pdf)
        return

    chart_h = CHART_H
    label_w = 16
    chart_x = MARGIN + label_w
    chart_w = CONTENT_W - label_w

    _draw_legend(pdf, [("Entradas", ORANGE), ("Consumo", BLUE)])
    pdf.ln(1)
    top = pdf.get_y()
    bottom = top + chart_h

    max_val = max(
        [p.entries_meters for p in points] + [p.consumption_meters for p in points] + [1.0]
    )
    max_val = max_val or 1.0

    steps = 4
    pdf.set_font("helvetica", "", 6)
    for s in range(steps + 1):
        val = max_val * s / steps
        y = bottom - chart_h * s / steps
        pdf.set_draw_color(*LINE_GRAY)
        pdf.set_line_width(0.15)
        if s > 0:
            pdf.line(chart_x, y, chart_x + chart_w, y)
        pdf.set_text_color(*GRAY)
        pdf.set_xy(MARGIN, y - 2)
        pdf.cell(label_w - 2, 4, _fit_line(pdf, _meters(val, 0), label_w - 2), align="R")

    pdf.set_draw_color(*LIGHT_GRAY)
    pdf.set_line_width(0.25)
    pdf.line(chart_x, top, chart_x, bottom)
    pdf.line(chart_x, bottom, chart_x + chart_w, bottom)

    n = len(points)
    slot_w = chart_w / n
    bar_w = min(8.0, slot_w * 0.35)
    prev_point: tuple[float, float] | None = None
    for i, point in enumerate(points):
        cx = chart_x + slot_w * (i + 0.5)
        bar_h = chart_h * (point.entries_meters / max_val)
        pdf.set_fill_color(*ORANGE)
        pdf.rect(cx - bar_w, bottom - bar_h, bar_w, bar_h, style="F")

        line_y = bottom - chart_h * (point.consumption_meters / max_val)
        pdf.set_draw_color(*BLUE)
        pdf.set_line_width(0.6)
        if prev_point is not None:
            pdf.line(prev_point[0], prev_point[1], cx, line_y)
        pdf.set_fill_color(*BLUE)
        pdf.ellipse(cx - 0.8, line_y - 0.8, 1.6, 1.6, style="F")
        prev_point = (cx, line_y)

        pdf.set_font("helvetica", "", 6)
        pdf.set_text_color(*GRAY)
        pdf.set_xy(chart_x + slot_w * i, bottom + 1.5)
        pdf.cell(
            slot_w,
            3.5,
            _fit_line(pdf, _period_tick_label(point.period, "month"), slot_w),
            align="C",
        )

    pdf.set_y(bottom + 6)


def _draw_financial_evolution_chart(
    pdf: FPDF, points: list[FinancialEvolutionPoint], granularity: str
) -> None:
    following = CHART_LEGEND_H + CHART_H + CHART_TICK_H + CHART_BUFFER if points else EMPTY_STATE_H
    _draw_card_title(
        pdf, "Evolução Financeira", "Faturamento · Custo · Margem", min_following=following
    )
    if not points:
        _draw_empty_state(pdf)
        return

    chart_h = CHART_H
    label_w = 20
    right_label_w = 12
    chart_x = MARGIN + label_w
    chart_w = CONTENT_W - label_w - right_label_w

    _draw_legend(pdf, [("Faturamento", ORANGE), ("Custo", RED), ("Margem %", GREEN)])
    pdf.ln(1)
    top = pdf.get_y()
    bottom = top + chart_h

    max_money = max([p.revenue for p in points] + [p.cost for p in points] + [1.0]) or 1.0
    max_pct = 100.0

    steps = 4
    pdf.set_font("helvetica", "", 6)
    for s in range(steps + 1):
        money_val = max_money * s / steps
        y = bottom - chart_h * s / steps
        pdf.set_draw_color(*LINE_GRAY)
        pdf.set_line_width(0.15)
        if s > 0:
            pdf.line(chart_x, y, chart_x + chart_w, y)
        pdf.set_text_color(*GRAY)
        pdf.set_xy(MARGIN, y - 2)
        pdf.cell(label_w - 2, 4, _fit_line(pdf, _brl(money_val), label_w - 2), align="R")
        pct_val = max_pct * s / steps
        pdf.set_xy(chart_x + chart_w + 1, y - 2)
        pdf.cell(right_label_w - 1, 4, _fit_line(pdf, f"{pct_val:.0f}%", right_label_w - 1))

    pdf.set_draw_color(*LIGHT_GRAY)
    pdf.set_line_width(0.25)
    pdf.line(chart_x, top, chart_x, bottom)
    pdf.line(chart_x, bottom, chart_x + chart_w, bottom)

    n = len(points)
    slot_w = chart_w / n
    bar_w = min(8.0, slot_w * 0.4)
    prev_cost: tuple[float, float] | None = None
    prev_margin: tuple[float, float] | None = None
    for i, point in enumerate(points):
        cx = chart_x + slot_w * (i + 0.5)
        bar_h = chart_h * (point.revenue / max_money)
        pdf.set_fill_color(*ORANGE)
        pdf.rect(cx - bar_w / 2, bottom - bar_h, bar_w, bar_h, style="F")

        cost_y = bottom - chart_h * (point.cost / max_money)
        pdf.set_draw_color(*RED)
        pdf.set_line_width(0.6)
        if prev_cost is not None:
            pdf.line(prev_cost[0], prev_cost[1], cx, cost_y)
        pdf.set_fill_color(*RED)
        pdf.ellipse(cx - 0.8, cost_y - 0.8, 1.6, 1.6, style="F")
        prev_cost = (cx, cost_y)

        if point.margin_pct is None:
            # Sem dado nesse ponto — QUEBRA a linha (não plota como 0).
            prev_margin = None
        else:
            margin_clamped, out_of_range = _clamp_margin_pct(point.margin_pct)
            margin_y = bottom - chart_h * (margin_clamped / max_pct)
            pdf.set_draw_color(*GREEN)
            pdf.set_line_width(0.6)
            if prev_margin is not None:
                pdf.line(prev_margin[0], prev_margin[1], cx, margin_y)
            pdf.set_fill_color(*GREEN)
            pdf.ellipse(cx - 0.8, margin_y - 0.8, 1.6, 1.6, style="F")
            if out_of_range:
                # Margem fora de 0-100%: o ponto fica preso no limite, mas o
                # valor real é escrito ao lado — não esconde o quanto passou.
                pdf.set_font("helvetica", "B", 5)
                pdf.set_text_color(*GREEN)
                label_y = margin_y - 4 if margin_clamped >= 50 else margin_y + 1.3
                pdf.set_xy(cx - 6, label_y)
                pdf.cell(12, 3, _fit_line(pdf, _pct(point.margin_pct, 0), 12), align="C")
                pdf.set_font("helvetica", "", 6)
            prev_margin = (cx, margin_y)

        pdf.set_font("helvetica", "", 6)
        pdf.set_text_color(*GRAY)
        pdf.set_xy(chart_x + slot_w * i, bottom + 1.5)
        pdf.cell(
            slot_w,
            3.5,
            _fit_line(pdf, _period_tick_label(point.period, granularity), slot_w),
            align="C",
        )

    pdf.set_y(bottom + 6)


def _draw_horizontal_bars(
    pdf: FPDF,
    items: list[tuple[str, float, tuple[int, int, int]]],
    value_fmt: Callable[[float], str],
    *,
    label_w: float = 55,
    value_w: float = 34,
    bar_h: float = BAR_H,
    gap: float = BAR_GAP,
    repeat_title: str | None = None,
) -> None:
    """
    Barras horizontais (Saúde Financeira / Ranking Comercial). Quando
    ``repeat_title`` é informado, o título é redesenhado no topo de cada
    página nova que a quebra automática abrir no meio da lista.
    """
    if not items:
        _draw_empty_state(pdf)
        return
    max_val = max((abs(v) for _l, v, _c in items), default=1.0) or 1.0
    bar_area_w = CONTENT_W - label_w - value_w - 4
    for label, value, color in items:
        if pdf.get_y() + bar_h + gap > pdf.page_break_trigger:
            pdf.add_page()
            if repeat_title:
                _draw_card_title(pdf, repeat_title)
        y = pdf.get_y()
        pdf.set_font("helvetica", "", 7.5)
        pdf.set_text_color(*DARK)
        pdf.set_xy(MARGIN, y + (bar_h - 3.2) / 2)
        pdf.cell(label_w, 3.2, _fit_line(pdf, label, label_w))
        w = max(1.0, abs(value) / max_val * bar_area_w)
        pdf.set_fill_color(*color)
        pdf.rect(MARGIN + label_w, y, w, bar_h, style="F")
        pdf.set_xy(MARGIN + label_w + bar_area_w + 2, y + (bar_h - 3.2) / 2)
        pdf.set_font("helvetica", "B", 7.5)
        pdf.set_text_color(*color)
        pdf.cell(value_w, 3.2, _fit_line(pdf, value_fmt(value), value_w), align="R")
        pdf.set_y(y + bar_h + gap)


# =============================================================================
# Classe do PDF (cabeçalho/rodapé em toda página)
# =============================================================================


class _IndicatorsPDF(FPDF):
    def __init__(self, data: PeliculasPdfData):
        super().__init__(orientation="landscape", format="A4")
        self.data = data
        self.set_margins(MARGIN, MARGIN, MARGIN)
        self.set_auto_page_break(auto=True, margin=14)
        self.alias_nb_pages()

    def header(self) -> None:
        pdf = self
        pdf.set_xy(MARGIN, 8)
        pdf.set_font("helvetica", "B", 15)
        pdf.set_text_color(*DARK)
        prefix = "AEMS "
        pdf.cell(pdf.get_string_width(_latin1(prefix)) + 1, 8, _latin1(prefix))
        pdf.set_text_color(*ORANGE)
        pdf.cell(0, 8, _latin1("Relatório de Películas"), new_x="LMARGIN", new_y="NEXT")

        generated = pdf.data.generated_at.strftime("%d/%m/%Y %H:%M")
        info = f"Emitido em {generated} por {pdf.data.generated_by}"
        pdf.set_font("helvetica", "", 7)
        pdf.set_text_color(*GRAY)
        pdf.set_xy(MARGIN, 9)
        pdf.cell(CONTENT_W, 6, _latin1(info), align="R")

        pdf.set_draw_color(*ORANGE)
        pdf.set_line_width(0.6)
        pdf.line(MARGIN, 18, MARGIN + CONTENT_W, 18)
        pdf.set_y(21)

    def footer(self) -> None:
        self.set_y(-11)
        self.set_font("helvetica", "", 7)
        self.set_text_color(*GRAY)
        self.cell(CONTENT_W / 2, 5, _latin1(f"Página {self.page_no()} de {{nb}}"))
        self.cell(CONTENT_W / 2, 5, _latin1("Documento interno - confidencial"), align="R")


# =============================================================================
# Montagem do PDF
# =============================================================================


def _draw_stock_health_table(pdf: FPDF, health: StockHealth) -> None:
    has_rows = bool(health.breakdown)
    following = (TABLE_HEADER_H + TABLE_ROW_H) if has_rows else EMPTY_STATE_H
    subtitle = f"{health.total_bobinas} bobinas - {round(health.coverage_days)} dias de cobertura"
    _draw_card_title(pdf, "Saúde do Estoque", subtitle, min_following=following)
    if not has_rows:
        _draw_empty_state(pdf)
        return
    cols: list[TableCol] = [
        ("STATUS", CONTENT_W * 0.5, "L"),
        ("QTD.", CONTENT_W * 0.25, "R"),
        ("%", CONTENT_W * 0.25, "R"),
    ]
    _draw_table_header(pdf, cols)
    for idx, bucket in enumerate(health.breakdown):
        label = STOCK_STATUS_LABELS.get(bucket.status, bucket.status)
        color = STOCK_STATUS_COLORS.get(bucket.status)
        _draw_table_row(
            pdf,
            cols,
            [label, _num(bucket.count), _pct(bucket.percentage)],
            zebra=idx % 2 == 1,
            first_col_color=color,
        )


def _draw_profitability_table(pdf: FPDF, profitability: ProfitabilityResponse) -> None:
    has_rows = bool(profitability.items)
    following = (TABLE_HEADER_H + TABLE_ROW_H) if has_rows else EMPTY_STATE_H
    _draw_card_title(
        pdf,
        "Rentabilidade do Consumo",
        "Tipo - Tonalidade - Consumo - Custo - Faturamento - Margem",
        min_following=following,
    )
    if not has_rows:
        _draw_empty_state(pdf)
        return
    cols: list[TableCol] = [
        ("TIPO", CONTENT_W * 0.22, "L"),
        ("TONALIDADE", CONTENT_W * 0.14, "L"),
        ("CONSUMO (M)", CONTENT_W * 0.14, "R"),
        ("CUSTO", CONTENT_W * 0.14, "R"),
        ("FATURAMENTO", CONTENT_W * 0.14, "R"),
        ("MARGEM %", CONTENT_W * 0.11, "R"),
        ("R$/METRO", CONTENT_W * 0.11, "R"),
    ]
    _draw_table_header(pdf, cols)
    for idx, item in enumerate(profitability.items):
        _draw_table_row(
            pdf,
            cols,
            [
                item.type_name,
                item.tonality or "-",
                _meters(item.consumption_meters),
                _brl(item.cost),
                _brl(item.revenue),
                _pct(item.margin_pct),
                f"{_brl(item.revenue_per_meter)}/m" if item.revenue_per_meter is not None else "-",
            ],
            zebra=idx % 2 == 1,
        )
    total = profitability.total
    _draw_table_row(
        pdf,
        cols,
        [
            "Total",
            "",
            _meters(total.consumption_meters),
            _brl(total.cost),
            _brl(total.revenue),
            _pct(total.margin_pct),
            f"{_brl(total.revenue_per_meter)}/m" if total.revenue_per_meter is not None else "-",
        ],
        zebra=False,
        bold=True,
    )


def _draw_commercial_performance(
    pdf: FPDF, items: list[CommercialPerformanceItem], sort_by: str
) -> None:
    sort_labels = {
        "revenue": "Faturamento",
        "meters": "Metros Aplicados",
        "applications": "Aplicações",
    }
    has_rows = bool(items)
    following = (TABLE_HEADER_H + TABLE_ROW_H) if has_rows else EMPTY_STATE_H
    _draw_card_title(
        pdf,
        "Performance Comercial",
        "Ranking de lojas por desempenho",
        min_following=following,
    )
    if not has_rows:
        _draw_empty_state(pdf)
        return
    cols: list[TableCol] = [
        ("LOJA", CONTENT_W * 0.28, "L"),
        ("TIPO", CONTENT_W * 0.28, "L"),
        ("METROS", CONTENT_W * 0.14, "R"),
        ("APLIC.", CONTENT_W * 0.12, "R"),
        ("FAT.", CONTENT_W * 0.18, "R"),
    ]
    _draw_table_header(pdf, cols)
    for idx, item in enumerate(items):
        _draw_table_row(
            pdf,
            cols,
            [
                item.store_name,
                item.types or "-",
                _meters(item.meters),
                _num(item.applications),
                _brl(item.revenue),
            ],
            zebra=idx % 2 == 1,
        )

    pdf.ln(2)
    metric_key = {"revenue": "revenue", "meters": "meters", "applications": "applications"}[sort_by]
    fmt = {"revenue": _brl, "meters": _meters, "applications": _num}[sort_by]
    bars = [(item.store_name, float(getattr(item, metric_key)), ORANGE) for item in items]
    ranking_title = f"Ranking por {sort_labels.get(sort_by, sort_by)}"
    _draw_card_title(pdf, ranking_title, min_following=BAR_H + BAR_GAP)
    _draw_horizontal_bars(pdf, bars, fmt, repeat_title=ranking_title)


def generate_peliculas_pdf(data: PeliculasPdfData) -> bytes:
    """Gera o PDF consolidado (BI) dos Indicadores de Películas (A4 paisagem)."""
    pdf = _IndicatorsPDF(data)
    pdf.add_page()

    _draw_filters_block(pdf, data.filters)

    # --- Resumo executivo --------------------------------------------------
    _draw_section_title(pdf, "Resumo Executivo", min_following=KPI_CARD_H)

    inv = data.inventory_kpis
    _draw_kpi_cards(
        pdf,
        [
            ("ESTOQUE", _meters(inv.stock_meters.current), inv.stock_meters.delta_pct, "%"),
            ("VALOR EM ESTOQUE", _brl(inv.stock_value.current), inv.stock_value.delta_pct, "%"),
            (
                "COBERTURA",
                f"{round(inv.coverage_days.current)} dias",
                inv.coverage_days.delta_pct,
                "%",
            ),
            (
                "CONSUMO",
                _meters(inv.consumption_meters.current),
                inv.consumption_meters.delta_pct,
                "%",
            ),
            (
                "APLICAÇÕES (ESTOQUE)",
                _num(inv.applications_count.current),
                inv.applications_count.delta_pct,
                "%",
            ),
            ("ENTRADAS", _meters(inv.entries_meters.current), inv.entries_meters.delta_pct, "%"),
            ("BOBINAS", _num(inv.bobinas_count.current), inv.bobinas_count.delta_pct, "%"),
        ],
    )

    fin = data.financial_kpis
    _draw_kpi_cards(
        pdf,
        [
            ("FATURAMENTO", _brl(fin.revenue.current), fin.revenue.delta_pct, "%"),
            ("MARGEM", _pct(fin.margin_pct.current), fin.margin_pct.delta_pct, "pp"),
            ("LUCRO", _brl(fin.profit.current), fin.profit.delta_pct, "%"),
            ("TICKET MÉDIO", _brl(fin.avg_ticket.current), fin.avg_ticket.delta_pct, "%"),
            (
                "R$/METRO",
                f"{_brl(fin.revenue_per_meter.current)}/m",
                fin.revenue_per_meter.delta_pct,
                "%",
            ),
            (
                "APLICAÇÕES",
                _num(fin.applications_count.current),
                fin.applications_count.delta_pct,
                "%",
            ),
        ],
    )

    # --- Estoque -------------------------------------------------------------
    stock_following = (
        (TABLE_HEADER_H + TABLE_ROW_H) if data.stock_health.breakdown else EMPTY_STATE_H
    )
    _draw_section_title(pdf, "Estoque", min_following=_card_block_min_height(True, stock_following))
    _draw_stock_health_table(pdf, data.stock_health)
    pdf.ln(3)
    _draw_entries_consumption_chart(pdf, data.entries_vs_consumption)
    pdf.ln(3)
    _draw_profitability_table(pdf, data.profitability)

    # --- Faturamento -----------------------------------------------------
    # Bloco inteiro da Saúde Financeira (4 barras + linha do ROI) reservado
    # de uma vez — senão o ROI podia ficar sozinho no topo da página
    # seguinte, separado das barras que ele resume.
    fin_health_block_h = 4 * (BAR_H + BAR_GAP) + 6.0
    _draw_section_title(
        pdf, "Faturamento", min_following=_card_block_min_height(True, fin_health_block_h)
    )
    fh = data.financial_health
    _draw_card_title(
        pdf,
        "Saúde Financeira",
        "Transformação do estoque em receita",
        min_following=fin_health_block_h,
    )
    _draw_horizontal_bars(
        pdf,
        [
            ("Valor Estoque", fh.stock_value, ORANGE),
            ("Custo Consumido", fh.cost_consumed, RED),
            ("Faturamento", fh.revenue, GREEN),
            ("Margem", fh.margin, _margin_pipeline_color(fh.margin)),
        ],
        _brl,
    )
    pdf.set_font("helvetica", "B", 8)
    pdf.set_text_color(*ORANGE)
    roi_label = f"ROI Médio: {_decimal_br(fh.roi, 2)}x" if fh.roi is not None else "ROI Médio: -"
    pdf.cell(0, 6, _latin1(roi_label), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    _draw_financial_evolution_chart(pdf, data.financial_evolution, data.evolution_granularity)
    pdf.ln(3)
    _draw_commercial_performance(pdf, data.commercial_performance, data.commercial_sort_by)

    # --- Metodologia ----------------------------------------------------
    _ensure_space(pdf, 20)
    pdf.ln(4)
    pdf.set_draw_color(*LINE_GRAY)
    pdf.set_line_width(0.2)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())
    pdf.ln(2)
    pdf.set_font("helvetica", "I", 6.5)
    pdf.set_text_color(*GRAY)
    note = (
        "Metodologia: a receita de película e PPF é ancorada na bobina consumida "
        "(rateio proporcional aos metros quando um item consome mais de uma bobina), "
        "não no tipo lançado no item da O.S. Limite conhecido: em O.S. de retalho "
        "(item vendido sem debitar bobina nova do mesmo tipo), um recorte por Tipo "
        "pode distorcer a margem apresentada nesse recorte."
    )
    pdf.multi_cell(CONTENT_W, 3.2, _latin1(note))

    return bytes(pdf.output())
