"""
Geração de PDF do Desempenho de Instaladores (A4 retrato, fpdf2).

Reaproveita o estilo do Resumo Diário (cabeçalho laranja, fontes core latin-1).
Gotcha latin-1: bullets/em-dash não existem — usar "·" e "-".
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from fpdf import FPDF

from app.modules.installer_performance.schemas import (
    DailyReportResponse,
    IndividualReportResponse,
    ReturnsReportResponse,
    SummaryReportResponse,
)

TZ_LOCAL = ZoneInfo("America/Sao_Paulo")

ORANGE = (232, 138, 0)
DARK = (23, 23, 23)
GRAY = (120, 120, 120)
LIGHT_GRAY = (200, 200, 200)
LINE_GRAY = (225, 225, 225)

MARGIN = 10
PAGE_W = 210
CONTENT_W = PAGE_W - 2 * MARGIN


def _latin1(text: str) -> str:
    return (text or "").encode("latin-1", "replace").decode("latin-1")


def _brl(value: float) -> str:
    formatted = f"{float(value):,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")
    return f"R$ {formatted}"


def _services_count(value: float) -> str:
    """Contagem fracionada de serviços (compartilhados contam 1/K): 3 ou 3,5."""
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.2f}".rstrip("0").rstrip(".").replace(".", ",")


def _fit_line(pdf: FPDF, text: str, width: float) -> str:
    text = _latin1(text)
    usable = width - 1.6
    if pdf.get_string_width(text) <= usable:
        return text
    cut = len(text)
    while cut > 0 and pdf.get_string_width(text[:cut]) > usable:
        cut -= 1
    return text[:cut]


class _PerfPDF(FPDF):
    def __init__(self, subtitle: str):
        super().__init__(orientation="portrait", format="A4")
        self.subtitle = subtitle
        self.set_margins(MARGIN, MARGIN, MARGIN)
        self.set_auto_page_break(auto=True, margin=14)
        self.alias_nb_pages()

    def footer(self) -> None:
        self.set_y(-11)
        self.set_font("helvetica", "", 7)
        self.set_text_color(*GRAY)
        self.cell(CONTENT_W / 2, 5, _latin1(self.subtitle))
        self.cell(CONTENT_W / 2, 5, f"Página {self.page_no()} de {{nb}}", align="R")


def _draw_title(pdf: _PerfPDF, title_prefix: str, title_accent: str) -> None:
    pdf.set_font("helvetica", "B", 17)
    pdf.set_text_color(*DARK)
    pdf.cell(pdf.get_string_width(title_prefix) + 1, 8, _latin1(title_prefix))
    pdf.set_text_color(*ORANGE)
    pdf.cell(0, 8, _latin1(title_accent), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)


def _draw_info_bar(pdf: _PerfPDF, fields: list[tuple[str, str]]) -> None:
    bar_y = pdf.get_y()
    bar_h = 13
    pdf.set_draw_color(*ORANGE)
    pdf.set_line_width(0.7)
    pdf.line(MARGIN, bar_y, MARGIN + CONTENT_W, bar_y)
    pdf.set_draw_color(*LINE_GRAY)
    pdf.set_line_width(0.25)
    pdf.rect(MARGIN, bar_y, CONTENT_W, bar_h)

    width = CONTENT_W / len(fields)
    x = MARGIN + 3
    for label, value in fields:
        pdf.set_xy(x, bar_y + 2)
        pdf.set_font("helvetica", "", 5.5)
        pdf.set_text_color(*GRAY)
        pdf.cell(width - 2, 3.2, _latin1(label))
        pdf.set_xy(x, bar_y + 5.6)
        pdf.set_font("helvetica", "B", 8)
        pdf.set_text_color(*DARK)
        pdf.cell(width - 2, 4.4, _fit_line(pdf, value, width - 2))
        x += width
    pdf.set_y(bar_y + bar_h + 3)


def _draw_kpis(pdf: _PerfPDF, cards: list[tuple[str, str]]) -> None:
    gap = 4
    card_w = (CONTENT_W - gap * (len(cards) - 1)) / len(cards)
    card_h = 18
    y = pdf.get_y()
    x = MARGIN
    pdf.set_draw_color(*LIGHT_GRAY)
    pdf.set_line_width(0.25)
    for label, value in cards:
        pdf.rect(x, y, card_w, card_h, round_corners=True, corner_radius=1.5)
        pdf.set_xy(x + 3, y + 3)
        pdf.set_font("helvetica", "", 6)
        pdf.set_text_color(*GRAY)
        pdf.cell(card_w - 6, 3.5, _latin1(label))
        pdf.set_xy(x + 3, y + 8.5)
        pdf.set_font("helvetica", "B", 13)
        pdf.set_text_color(*ORANGE)
        pdf.cell(card_w - 6, 7, _fit_line(pdf, value, card_w - 6))
        x += card_w + gap
    pdf.set_y(y + card_h + 5)


# =============================================================================
# Relatório Diário
# =============================================================================

# (título, largura mm, alinhamento) — soma = CONTENT_W (190)
DAILY_COLS = [
    ("O.S.", 20, "L"),
    ("PLACA / CHASSI", 30, "L"),
    ("VEÍCULO", 34, "L"),
    ("LOJA", 30, "L"),
    ("SERVIÇOS", 34, "L"),
    ("TIPO", 16, "L"),
    ("VALOR", 26, "R"),
]


def _daily_table_header(pdf: _PerfPDF) -> None:
    pdf.set_font("helvetica", "", 5.5)
    pdf.set_text_color(*GRAY)
    x = MARGIN
    y = pdf.get_y()
    for title, width, align in DAILY_COLS:
        pdf.set_xy(x, y)
        pdf.cell(width, 4.5, _latin1(title), align=align)
        x += width
    pdf.set_y(y + 4.5)
    pdf.set_draw_color(*LIGHT_GRAY)
    pdf.set_line_width(0.3)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())


def _draw_installer_block(pdf: _PerfPDF, group) -> None:
    block_min_h = 30
    if pdf.get_y() + block_min_h > pdf.page_break_trigger:
        pdf.add_page()

    # Cabeçalho do instalador
    pdf.ln(1)
    pdf.set_font("helvetica", "B", 11)
    pdf.set_text_color(*DARK)
    pdf.cell(0, 7, _latin1(group.employee_name), new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(*ORANGE)
    pdf.set_line_width(0.5)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())
    pdf.ln(1.5)

    _daily_table_header(pdf)

    line_h = 4.2
    for v in group.vehicles:
        os_label = v.external_os_number or v.order_number or f"#{v.os_id}"
        tipo = _tipo_label(v.is_return, v.is_courtesy, v.has_shared)
        cells = [
            (os_label, DARK, "L"),
            (v.plate, DARK, "L"),
            (v.vehicle or "-", DARK, "L"),
            (v.store_name or "-", GRAY, "L"),
            (" + ".join(v.services) or "-", DARK, "L"),
            (tipo, ORANGE if tipo != "-" else GRAY, "L"),
            (_brl(v.value), DARK, "R"),
        ]
        if pdf.get_y() + line_h > pdf.page_break_trigger:
            pdf.add_page()
            _daily_table_header(pdf)
        y = pdf.get_y()
        x = MARGIN
        for (text, color, align), (_, width, _) in zip(cells, DAILY_COLS, strict=True):
            pdf.set_font("helvetica", "", 7)
            pdf.set_text_color(*color)
            pdf.set_xy(x, y + 0.6)
            pdf.cell(width - 1, line_h - 1, _fit_line(pdf, str(text), width), align=align)
            x += width
        pdf.set_y(y + line_h)
        pdf.set_draw_color(*LINE_GRAY)
        pdf.set_line_width(0.15)
        pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())

    # Rodapé do bloco: total de carros + faturamento
    pdf.ln(1)
    pdf.set_font("helvetica", "B", 8)
    pdf.set_text_color(*GRAY)
    footer = f"{group.total_cars} carro(s) no dia"
    pdf.cell(CONTENT_W - 40, 5, _latin1(footer), align="R")
    pdf.set_text_color(*ORANGE)
    pdf.cell(40, 5, _latin1(_brl(group.total_revenue)), align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)


def generate_daily_pdf(data: DailyReportResponse) -> bytes:
    store_label = data.store_name or "Todas as lojas"
    date_str = data.report_date.strftime("%d/%m/%Y")
    pdf = _PerfPDF(f"{store_label} · {date_str}")
    pdf.add_page()

    _draw_title(pdf, "Desempenho de ", "Instaladores")
    generated = datetime.now(TZ_LOCAL).strftime("%d/%m/%Y %H:%M")
    _draw_info_bar(
        pdf,
        [
            ("LOJA", store_label),
            ("DATA", date_str),
            ("INSTALADORES", str(len(data.groups))),
            ("TOTAL DE CARROS", str(data.grand_total_cars)),
            ("FATURAMENTO", _brl(data.grand_total_revenue)),
            ("GERADO EM", generated),
        ],
    )

    if not data.groups:
        pdf.set_font("helvetica", "I", 9)
        pdf.set_text_color(*GRAY)
        pdf.cell(0, 8, _latin1("Nenhum carro finalizado no dia."), new_x="LMARGIN", new_y="NEXT")
    for group in data.groups:
        _draw_installer_block(pdf, group)

    return bytes(pdf.output())


# =============================================================================
# Relatório Individual
# =============================================================================

INDIVIDUAL_COLS = [
    ("DATA", 17, "L"),
    ("O.S.", 18, "L"),
    ("PLACA / CHASSI", 24, "L"),
    ("VEÍCULO", 28, "L"),
    ("LOJA", 26, "L"),
    ("SERVIÇOS", 32, "L"),
    ("TIPO", 14, "L"),
    ("PONTOS", 14, "R"),
    ("VALOR", 17, "R"),
]


def _tipo_label(is_return: bool, is_courtesy: bool, has_shared: bool = False) -> str:
    tags = []
    if is_return:
        tags.append("Retorno")
    if is_courtesy:
        tags.append("Cortesia")
    if has_shared:
        tags.append("Dividido")
    return " · ".join(tags) if tags else "-"


def _individual_table_header(pdf: _PerfPDF) -> None:
    pdf.set_font("helvetica", "", 5.5)
    pdf.set_text_color(*GRAY)
    x = MARGIN
    y = pdf.get_y()
    for title, width, align in INDIVIDUAL_COLS:
        pdf.set_xy(x, y)
        pdf.cell(width, 4.5, _latin1(title), align=align)
        x += width
    pdf.set_y(y + 4.5)
    pdf.set_draw_color(*LIGHT_GRAY)
    pdf.set_line_width(0.3)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())


def generate_individual_pdf(data: IndividualReportResponse) -> bytes:
    period = f"{data.period_start.strftime('%d/%m/%Y')} a {data.period_end.strftime('%d/%m/%Y')}"
    pdf = _PerfPDF(f"{data.employee_name} · {period}")
    pdf.add_page()

    _draw_title(pdf, "Desempenho do ", "Instalador")
    generated = datetime.now(TZ_LOCAL).strftime("%d/%m/%Y %H:%M")
    _draw_info_bar(
        pdf,
        [
            ("INSTALADOR", data.employee_name),
            ("PERÍODO", period),
            ("LOJA", data.store_name or "Todas as lojas"),
            ("GERADO EM", generated),
        ],
    )

    _draw_kpis(
        pdf,
        [
            ("TOTAL DE CARROS NO PERÍODO", str(data.total_cars)),
            ("TOTAL DE SERVIÇOS NO PERÍODO", _services_count(data.total_services)),
            ("PONTOS NO PERÍODO", _services_count(data.total_points)),
            ("FATURAMENTO TOTAL NO PERÍODO", _brl(data.total_revenue)),
        ],
    )

    pdf.set_font("helvetica", "B", 8)
    pdf.set_text_color(*DARK)
    pdf.cell(0, 5, _latin1("SERVIÇOS FINALIZADOS"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(0.5)
    _individual_table_header(pdf)

    if not data.rows:
        pdf.set_font("helvetica", "I", 9)
        pdf.set_text_color(*GRAY)
        pdf.cell(
            0, 8, _latin1("Nenhum serviço finalizado no período."), new_x="LMARGIN", new_y="NEXT"
        )

    line_h = 4.2
    for r in data.rows:
        os_label = r.external_os_number or r.order_number or f"#{r.os_id}"
        tipo = _tipo_label(r.is_return, r.is_courtesy, r.has_shared)
        cells = [
            (r.completion_date.strftime("%d/%m/%Y"), GRAY, "L"),
            (os_label, DARK, "L"),
            (r.plate, DARK, "L"),
            (r.vehicle or "-", DARK, "L"),
            (r.store_name or "-", GRAY, "L"),
            (" + ".join(r.services) or "-", DARK, "L"),
            (tipo, ORANGE if tipo != "-" else GRAY, "L"),
            (_services_count(r.points), DARK, "R"),
            (_brl(r.value), DARK, "R"),
        ]
        if pdf.get_y() + line_h > pdf.page_break_trigger:
            pdf.add_page()
            _individual_table_header(pdf)
        y = pdf.get_y()
        x = MARGIN
        for (text, color, align), (_, width, _) in zip(cells, INDIVIDUAL_COLS, strict=True):
            pdf.set_font("helvetica", "", 7)
            pdf.set_text_color(*color)
            pdf.set_xy(x, y + 0.6)
            pdf.cell(width - 1, line_h - 1, _fit_line(pdf, str(text), width), align=align)
            x += width
        pdf.set_y(y + line_h)
        pdf.set_draw_color(*LINE_GRAY)
        pdf.set_line_width(0.15)
        pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())

    pdf.ln(1.5)
    pdf.set_font("helvetica", "", 8)
    pdf.set_text_color(*GRAY)
    pdf.cell(CONTENT_W - 30, 5, _latin1("Total do Período"), align="R")
    pdf.set_font("helvetica", "B", 9)
    pdf.set_text_color(*ORANGE)
    pdf.cell(30, 5, _latin1(_brl(data.total_revenue)), align="R", new_x="LMARGIN", new_y="NEXT")

    return bytes(pdf.output())


# =============================================================================
# Resumo de Instaladores
# =============================================================================

# (título, largura mm, alinhamento) — soma = CONTENT_W (190): 60+22+27+22+27+32 = 190
SUMMARY_COLS = [
    ("INSTALADOR", 60, "L"),
    ("O.S.", 22, "R"),
    ("SERVIÇOS", 27, "R"),
    ("CARROS", 22, "R"),
    ("PONTOS", 27, "R"),
    ("TOTAL FATURADO", 32, "R"),
]


def _summary_table_header(pdf: "_PerfPDF") -> None:
    y = pdf.get_y()
    x = MARGIN
    pdf.set_font("helvetica", "B", 7)
    pdf.set_text_color(*GRAY)
    for label, width, align in SUMMARY_COLS:
        pdf.set_xy(x, y)
        pdf.cell(width - 1, 5, _latin1(label), align=align)
        x += width
    pdf.set_y(y + 5)
    pdf.set_draw_color(*LINE_GRAY)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())
    pdf.set_y(pdf.get_y() + 1)


def generate_summary_pdf(data: SummaryReportResponse) -> bytes:
    period = f"{data.period_start.strftime('%d/%m/%Y')} a {data.period_end.strftime('%d/%m/%Y')}"
    pdf = _PerfPDF(f"Resumo · {period}")
    pdf.add_page()
    _draw_title(pdf, "Resumo de ", "Instaladores")
    generated = datetime.now(TZ_LOCAL).strftime("%d/%m/%Y %H:%M")
    _draw_info_bar(
        pdf,
        [
            ("PERÍODO", period),
            ("LOJA", data.store_name or "Todas as lojas"),
            ("GERADO EM", generated),
        ],
    )
    _draw_kpis(
        pdf,
        [
            ("TOTAL DE CARROS", str(data.totals.total_cars)),
            ("TOTAL DE SERVIÇOS", _services_count(data.totals.total_services)),
            ("PONTOS", _services_count(data.totals.total_points)),
            ("FATURAMENTO", _brl(data.totals.total_revenue)),
            ("CUSTO PELÍCULAS", _brl(data.totals.film_cost)),
        ],
    )
    _summary_table_header(pdf)
    line_h = 4.6
    for r in data.rows:
        cells = [
            (r.employee_name, DARK, "L"),
            (str(r.orders_count), DARK, "R"),
            (_services_count(r.services_count), DARK, "R"),
            (str(r.cars_count), DARK, "R"),
            (_services_count(r.points), ORANGE, "R"),
            (_brl(r.revenue), DARK, "R"),
        ]
        if pdf.get_y() + line_h > pdf.page_break_trigger:
            pdf.add_page()
            _summary_table_header(pdf)
        y = pdf.get_y()
        x = MARGIN
        for (text, color, align), (_, width, _) in zip(cells, SUMMARY_COLS, strict=True):
            pdf.set_font("helvetica", "", 7)
            pdf.set_text_color(*color)
            pdf.set_xy(x, y + 0.6)
            pdf.cell(width - 1, line_h - 1, _fit_line(pdf, str(text), width), align=align)
            x += width
        pdf.set_y(y + line_h)
        pdf.set_draw_color(*LINE_GRAY)
        pdf.set_line_width(0.15)
        pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())
    return bytes(pdf.output())


# --- Retornos (landscape: tabela larga retorno x anterior) ---

L_MARGIN = 10
L_PAGE_W = 297
L_CONTENT_W = L_PAGE_W - 2 * L_MARGIN  # 277

# (label, largura mm)
RETURNS_COLS: list[tuple[str, float]] = [
    ("DATA RETORNO", 20),
    ("QUEM FEZ (RETORNO)", 38),
    ("O QUE FOI (RETORNO)", 30),
    ("OBS. RETORNO", 34),
    ("DATA ANTERIOR", 20),
    ("QUEM FEZ (ANTERIOR)", 38),
    ("O QUE FOI (ANTERIOR)", 30),
    ("OBS. ANTERIOR", 25),
    ("MODELO", 22),
    ("PLACA/CHASSI", 20),
]


class _ReturnsPDF(FPDF):
    def __init__(self, subtitle: str):
        super().__init__(orientation="landscape", format="A4")
        self.subtitle = subtitle
        self.set_margins(L_MARGIN, L_MARGIN, L_MARGIN)
        self.set_auto_page_break(auto=True, margin=14)
        self.alias_nb_pages()

    def footer(self) -> None:
        self.set_y(-11)
        self.set_font("helvetica", "", 7)
        self.set_text_color(*GRAY)
        self.cell(L_CONTENT_W / 2, 5, _latin1(self.subtitle))
        self.cell(L_CONTENT_W / 2, 5, f"Página {self.page_no()} de {{nb}}", align="R")


def _returns_table_header(pdf: _ReturnsPDF) -> None:
    pdf.set_fill_color(*ORANGE)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("helvetica", "B", 6)
    y = pdf.get_y()
    x = L_MARGIN
    for label, width in RETURNS_COLS:
        pdf.set_xy(x, y)
        pdf.cell(width, 6, _fit_line(pdf, label, width), align="L", fill=True)
        x += width
    pdf.set_y(y + 6)


def generate_returns_pdf(data: ReturnsReportResponse) -> bytes:
    period = f"{data.period_start.strftime('%d/%m/%Y')} a {data.period_end.strftime('%d/%m/%Y')}"
    pdf = _ReturnsPDF(f"Retornos · {period}")
    pdf.add_page()

    # Título
    pdf.set_font("helvetica", "B", 17)
    pdf.set_text_color(*DARK)
    prefix = "Retornos de "
    pdf.cell(pdf.get_string_width(prefix) + 1, 8, _latin1(prefix))
    pdf.set_text_color(*ORANGE)
    pdf.cell(0, 8, _latin1("Instaladores"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    # Barra de info
    generated = datetime.now(TZ_LOCAL).strftime("%d/%m/%Y %H:%M")
    fields = [
        ("PERÍODO", period),
        ("LOJA", data.store_name or "Todas as lojas"),
        ("TOTAL DE RETORNOS", str(len(data.rows))),
        ("GERADO EM", generated),
    ]
    bar_y = pdf.get_y()
    bar_h = 13
    pdf.set_draw_color(*ORANGE)
    pdf.set_line_width(0.7)
    pdf.line(L_MARGIN, bar_y, L_MARGIN + L_CONTENT_W, bar_y)
    pdf.set_draw_color(*LINE_GRAY)
    pdf.set_line_width(0.25)
    pdf.rect(L_MARGIN, bar_y, L_CONTENT_W, bar_h)
    fw = L_CONTENT_W / len(fields)
    fx = L_MARGIN + 3
    for label, value in fields:
        pdf.set_xy(fx, bar_y + 2)
        pdf.set_font("helvetica", "", 5.5)
        pdf.set_text_color(*GRAY)
        pdf.cell(fw - 2, 3.2, _latin1(label))
        pdf.set_xy(fx, bar_y + 5.6)
        pdf.set_font("helvetica", "B", 8)
        pdf.set_text_color(*DARK)
        pdf.cell(fw - 2, 4.4, _fit_line(pdf, value, fw - 2))
        fx += fw
    pdf.set_y(bar_y + bar_h + 3)

    _returns_table_header(pdf)
    line_h = 5.0
    for r in data.rows:
        cells = [
            (r.return_date.strftime("%d/%m/%Y") if r.return_date else "-", DARK),
            (", ".join(r.return_workers) or "-", DARK),
            (", ".join(r.return_services) or "-", DARK),
            (r.return_notes or "-", GRAY),
            (r.origin_date.strftime("%d/%m/%Y") if r.origin_date else "-", DARK),
            (", ".join(r.origin_workers) or "-", ORANGE),
            (", ".join(r.origin_services) or "-", DARK),
            (r.origin_notes or "-", GRAY),
            (r.model or "-", DARK),
            (r.chassis or "-", DARK),
        ]
        if pdf.get_y() + line_h > pdf.page_break_trigger:
            pdf.add_page()
            _returns_table_header(pdf)
        y = pdf.get_y()
        x = L_MARGIN
        for (text, color), (_, width) in zip(cells, RETURNS_COLS, strict=True):
            pdf.set_font("helvetica", "", 6.5)
            pdf.set_text_color(*color)
            pdf.set_xy(x, y + 0.6)
            pdf.cell(width - 1, line_h - 1, _fit_line(pdf, str(text), width))
            x += width
        pdf.set_y(y + line_h)
        pdf.set_draw_color(*LINE_GRAY)
        pdf.set_line_width(0.15)
        pdf.line(L_MARGIN, pdf.get_y(), L_MARGIN + L_CONTENT_W, pdf.get_y())

    if not data.rows:
        pdf.set_font("helvetica", "", 9)
        pdf.set_text_color(*GRAY)
        pdf.cell(0, 8, _latin1("Nenhum retorno no período."), new_x="LMARGIN", new_y="NEXT")

    return bytes(pdf.output())
