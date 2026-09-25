"""
Gerador do Certificado de Garantia em PDF (Vitrificação de Pintura).

Layout aprovado com o cliente: logo da marca no topo (sem identidade da Wash),
dados do veículo/O.S., prazo em destaque, condições de manutenção, assinaturas e
Grupo Parceiro + endereço da loja no rodapé.

Usa fpdf2 (fontes core = latin-1) e os logos embutidos em ``logos/<brand_code>.png``.
"""

import calendar
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from fpdf import FPDF
from PIL import Image

CHARCOAL = (26, 26, 26)
DARK = (51, 51, 51)
GRAY = (110, 110, 110)
LIGHT_BG = (246, 246, 246)
LINE = (208, 208, 208)

PAGE_W = 210.0
LOGO_TOP = 16.0
LOGO_BOX_H = 26.0
LOGO_BOX_W = 66.0  # largura da caixa de cada logo (marca / grupo)
LOGO_GAP = 16.0  # espaço entre a logo do grupo e a da marca no topo

LOGOS_DIR = Path(__file__).parent / "logos"
ASSETS_DIR = Path(__file__).parent / "assets"
GROUP_LOGO = ASSETS_DIR / "group-logo.png"
DEFAULT_WARRANTY_MONTHS = 12
DEFAULT_GROUP = "Grupo Parceiro"
DEFAULT_SERVICE = "Vitrificação de Pintura"

CONDICOES = [
    "Não usar produtos agressivos na lavagem de rotina (detergente de louça, shampoo de "
    "cabelo, querosene diluído em água, sabão em barra ou água com alto teor de cloro).",
    "Evitar exposição prolongada sob árvores (fezes de aves e seiva) e o contato com "
    "objetos pontiagudos como anéis, relógios e fivelas.",
    "Recomendação técnica: lavar com shampoo neutro automotivo, sempre à sombra; secar "
    "com flanela de microfibra macia; e manter a proteção com cera líquida própria para "
    "vitrificação.",
    "O desempenho (brilho, hidrorrepelência e toque aveludado) pode reduzir naturalmente "
    "com o tempo, devido a poeira, chuva ácida, frio e calor. Agende a manutenção "
    "periódica com a nossa equipe para preservar a garantia.",
]


@dataclass
class CertificateData:
    """Dados para renderizar o certificado."""

    brand_code: str | None  # ex: "toyota", "byd", "fiat", "hyundai"
    brand_name: str | None  # fallback textual quando não houver logo
    store_address: str | None
    # Puxados da O.S.
    os_number: str
    plate: str
    model: str | None
    color: str | None
    # Digitados na emissão
    customer_name: str
    invoice_number: str
    chassi: str
    # Parâmetros
    service_name: str = DEFAULT_SERVICE
    group_name: str = DEFAULT_GROUP
    issue_date: date | None = None
    warranty_months: int = DEFAULT_WARRANTY_MONTHS


def _latin1(text: str) -> str:
    """Fontes core do fpdf2 são latin-1; substitui o que não couber."""
    return (text or "").encode("latin-1", "replace").decode("latin-1")


def _add_months(d: date, months: int) -> date:
    """Soma meses a uma data, ajustando o dia ao último dia válido do mês."""
    total = d.month - 1 + months
    year = d.year + total // 12
    month = total % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _logo_path(brand_code: str | None) -> Path | None:
    if not brand_code:
        return None
    path = LOGOS_DIR / f"{brand_code.strip().lower()}.png"
    return path if path.exists() else None


def generate_certificate_pdf(data: CertificateData) -> bytes:
    """Renderiza o certificado e devolve os bytes do PDF."""
    issue_date = data.issue_date or date.today()
    valido_ate = _add_months(issue_date, data.warranty_months)

    pdf = FPDF(orientation="portrait", format="A4")
    pdf.set_auto_page_break(False)
    pdf.set_margins(0, 0, 0)
    pdf.add_page()

    # moldura neutra
    pdf.set_draw_color(*CHARCOAL)
    pdf.set_line_width(0.6)
    pdf.rect(10, 10, PAGE_W - 20, 297 - 20)

    def centered(y: float, text: str, style: str, size: float, color) -> None:
        pdf.set_font("helvetica", style, size)
        pdf.set_text_color(*color)
        pdf.set_xy(0, y)
        pdf.cell(PAGE_W, size * 0.42 + 2, _latin1(text), align="C")

    def hline(y, x1=30, x2=PAGE_W - 30, color=LINE, w=0.4) -> None:
        pdf.set_draw_color(*color)
        pdf.set_line_width(w)
        pdf.line(x1, y, x2, y)

    # cabeçalho: Grupo Parceiro (esquerda) + logo da marca (direita), lado a
    # lado e centralizados como um conjunto. Cada logo é ajustada à sua caixa
    # preservando a proporção.
    def place_logo(path: Path, box_x: float) -> None:
        iw, ih = Image.open(path).size
        disp_w = LOGO_BOX_W
        disp_h = disp_w * ih / iw
        if disp_h > LOGO_BOX_H:
            disp_h = LOGO_BOX_H
            disp_w = disp_h * iw / ih
        pdf.image(
            str(path),
            x=box_x + (LOGO_BOX_W - disp_w) / 2,
            y=LOGO_TOP + (LOGO_BOX_H - disp_h) / 2,
            w=disp_w,
        )

    left_x = PAGE_W / 2 - LOGO_GAP / 2 - LOGO_BOX_W
    right_x = PAGE_W / 2 + LOGO_GAP / 2

    if GROUP_LOGO.exists():
        place_logo(GROUP_LOGO, left_x)

    logo = _logo_path(data.brand_code)
    if logo is not None:
        place_logo(logo, right_x)
    elif data.brand_name:
        pdf.set_font("helvetica", "B", 20)
        pdf.set_text_color(*CHARCOAL)
        pdf.set_xy(right_x, LOGO_TOP + LOGO_BOX_H / 2 - 4)
        pdf.cell(LOGO_BOX_W, 8, _latin1(data.brand_name.upper()), align="C")

    base = LOGO_TOP + LOGO_BOX_H  # 42

    centered(base + 6, "CERTIFICADO DE GARANTIA", "B", 19, CHARCOAL)
    centered(base + 17, data.service_name, "B", 13, DARK)
    hline(base + 27, color=CHARCOAL, w=0.5)

    intro_y = base + 31
    pdf.set_font("helvetica", "", 9.5)
    pdf.set_text_color(*GRAY)
    pdf.set_xy(25, intro_y)
    pdf.multi_cell(
        PAGE_W - 50,
        5,
        _latin1(
            "Certificamos que o veículo abaixo identificado recebeu o serviço de "
            f"{data.service_name}, coberto pela garantia e pelas condições descritas "
            "neste documento."
        ),
        align="C",
    )

    # caixa de dados
    box_x, box_y, box_w, box_h = 18, intro_y + 16, PAGE_W - 36, 46
    pdf.set_fill_color(*LIGHT_BG)
    pdf.set_draw_color(*LINE)
    pdf.set_line_width(0.3)
    pdf.rect(box_x, box_y, box_w, box_h, style="DF")

    col_l = box_x + 8
    col_r = box_x + box_w / 2 + 4
    row_y = box_y + 7
    row_step = (box_h - 10) / 4

    def field(x, y, label, value) -> None:
        pdf.set_font("helvetica", "", 7.5)
        pdf.set_text_color(*GRAY)
        pdf.set_xy(x, y)
        pdf.cell(box_w / 2 - 12, 3.4, _latin1(label.upper()))
        pdf.set_font("helvetica", "B", 10.5)
        pdf.set_text_color(*CHARCOAL)
        pdf.set_xy(x, y + 3.6)
        pdf.cell(box_w / 2 - 12, 5, _latin1(value or "-"))

    # Nº da O.S. não entra: não é coletado no formulário avulso do e-book.
    fields = [
        ("Cliente", data.customer_name),
        ("Placa", (data.plate or "").upper()),
        ("Modelo", data.model),
        ("Cor", data.color),
        ("Chassi", data.chassi),
        ("Nota Fiscal", data.invoice_number),
        ("Data de emissão", issue_date.strftime("%d/%m/%Y")),
    ]
    for i, (label, value) in enumerate(fields):
        y = row_y + (i // 2) * row_step
        x = col_l if i % 2 == 0 else col_r
        field(x, y, label, value)

    # destaque garantia
    g_x, g_y, g_w, g_h = 18, box_y + box_h + 6, PAGE_W - 36, 16
    pdf.set_fill_color(*LIGHT_BG)
    pdf.set_draw_color(*LINE)
    pdf.set_line_width(0.3)
    pdf.rect(g_x, g_y, g_w, g_h, style="DF")
    pdf.set_fill_color(*CHARCOAL)
    pdf.rect(g_x, g_y, 2.2, g_h, style="F")
    pdf.set_font("helvetica", "B", 13)
    pdf.set_text_color(*CHARCOAL)
    pdf.set_xy(g_x, g_y + 3.2)
    pdf.cell(g_w, 6, _latin1(f"Prazo de garantia: {data.warranty_months} meses"), align="C")
    pdf.set_font("helvetica", "", 9)
    pdf.set_text_color(*DARK)
    pdf.set_xy(g_x, g_y + 9.3)
    pdf.cell(
        g_w,
        4,
        _latin1(
            f"Válida até {valido_ate.strftime('%d/%m/%Y')}, contados a partir da data de emissão."
        ),
        align="C",
    )

    # condições
    c_y = g_y + g_h + 8
    pdf.set_font("helvetica", "B", 10)
    pdf.set_text_color(*CHARCOAL)
    pdf.set_xy(18, c_y)
    pdf.cell(PAGE_W - 36, 5, _latin1("Condições para manutenção da garantia"))
    c_y += 7
    for i, cond in enumerate(CONDICOES, start=1):
        pdf.set_font("helvetica", "B", 9.5)
        pdf.set_text_color(*CHARCOAL)
        pdf.set_xy(20, c_y)
        pdf.cell(6, 4.6, _latin1(f"{i}."))
        pdf.set_font("helvetica", "", 9)
        pdf.set_text_color(*DARK)
        pdf.set_xy(26, c_y)
        pdf.multi_cell(PAGE_W - 26 - 20, 4.6, _latin1(cond))
        c_y = pdf.get_y() + 2.5

    pdf.set_font("helvetica", "I", 8)
    pdf.set_text_color(*GRAY)
    pdf.set_xy(18, c_y + 1)
    pdf.multi_cell(
        PAGE_W - 36,
        4,
        _latin1(
            "A garantia está condicionada ao cumprimento das recomendações acima e não "
            "cobre danos por mau uso, acidentes, riscos, repintura ou serviços executados "
            "por terceiros."
        ),
    )

    # assinaturas
    sign_y = 250
    hline(sign_y, 28, 92, color=CHARCOAL, w=0.3)
    hline(sign_y, PAGE_W - 92, PAGE_W - 28, color=CHARCOAL, w=0.3)
    pdf.set_font("helvetica", "", 8.5)
    pdf.set_text_color(*DARK)
    pdf.set_xy(28, sign_y + 1.5)
    pdf.cell(64, 4, _latin1("Cliente"), align="C")
    pdf.set_xy(PAGE_W - 92, sign_y + 1.5)
    pdf.cell(64, 4, _latin1("Responsável Técnico / Carimbo"), align="C")

    # rodapé: endereço da loja (a identidade do Grupo Parceiro agora aparece
    # como logo no topo, ao lado da marca)
    hline(273, 20, PAGE_W - 20, color=LINE, w=0.3)
    if data.store_address:
        pdf.set_font("helvetica", "", 8.5)
        pdf.set_text_color(*GRAY)
        pdf.set_xy(0, 278)
        pdf.cell(PAGE_W, 4, _latin1(data.store_address), align="C")

    return bytes(pdf.output())
