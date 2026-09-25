"""
PDF "Carros para Fazer" do Agendamento.

Lista de trabalho impressa: todos os carros pendentes que aparecem no
Agendamento (respeitando os filtros da tela), com placa/chassi, modelo, cor,
loja, departamento, serviços, tonalidade, consultor, horário e status — para o
instalador, manobrista e encarregado localizarem e puxarem os carros.

Diferente do "Resumo Diário" (que mostra o que já foi FEITO), aqui é o que
ainda está POR FAZER: atrasado, atenção, agendado e em execução.
"""

from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import datetime, time
from zoneinfo import ZoneInfo

from fpdf import FPDF

from app.modules.scheduling.schemas import AppointmentResponse

TZ_LOCAL = ZoneInfo("America/Sao_Paulo")

DEPARTMENT_LABELS = {
    "film": "Película",
    "security_film": "Pel. Segurança",
    "ppf": "PPF",
    "bodywork": "Funilaria",
    "vn": "VN",
    "vd": "VD",
    "vu": "VU",
    "workshop": "Oficina",
}

STATUS_LABELS = {
    "atrasado": "Atrasado",
    "atencao": "Atenção",
    "agendado": "Agendado",
    "em_execucao": "Em exec.",
    "duplicidade": "Duplicid.",
}

WEEKDAYS_PT = [
    "segunda-feira",
    "terça-feira",
    "quarta-feira",
    "quinta-feira",
    "sexta-feira",
    "sábado",
    "domingo",
]

# Cores (mesma leitura da legenda da tela)
ORANGE = (232, 138, 0)
DARK = (23, 23, 23)
GRAY = (120, 120, 120)
LIGHT_GRAY = (200, 200, 200)
LINE_GRAY = (225, 225, 225)
RED = (200, 40, 40)
BLUE = (40, 90, 200)
GREEN = (30, 140, 60)

PURPLE = (130, 60, 180)

STATUS_COLORS = {
    "atrasado": RED,
    "atencao": ORANGE,
    "agendado": BLUE,
    "em_execucao": GREEN,
    "duplicidade": PURPLE,
}

MARGIN = 10
PAGE_W = 297  # A4 paisagem
CONTENT_W = PAGE_W - 2 * MARGIN  # 277


@dataclass
class CarRow:
    time_label: str
    plate: str
    model: str
    color: str
    store: str
    department: str
    services: str
    tonality: str
    consultant: str
    scheduled_at: str  # data em que o consultor criou o agendamento (created_at)
    status: str  # display_status
    os_number: str  # número da O.S. da concessionária (external_os_number)


@dataclass
class DateGroup:
    day: date_type
    rows: list[CarRow] = field(default_factory=list)


@dataclass
class CarrosParaFazerData:
    store_label: str
    period_label: str
    department_label: str
    category_label: str
    generated_at: datetime
    total: int
    multi_store: bool
    groups: list[DateGroup] = field(default_factory=list)


# =============================================================================
# Coleta / montagem dos dados
# =============================================================================


def _time_label(t: time | None) -> str:
    return t.strftime("%H:%M") if t else "--:--"


def _name_surname(full: str | None) -> str:
    """Consultor: só primeiro nome + último sobrenome (pedido da operação)."""
    parts = (full or "").split()
    if not parts:
        return "-"
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1]}"


def _scheduled_at_label(created_at: datetime | None) -> str:
    """Data em que o consultor criou o agendamento (local)."""
    if created_at is None:
        return "-"
    dt = created_at.astimezone(TZ_LOCAL) if created_at.tzinfo else created_at
    return dt.strftime("%d/%m/%Y")


def _tonalities(appt: AppointmentResponse) -> str:
    """Tonalidades distintas das películas do agendamento (com região quando houver)."""
    seen: list[str] = []
    for fe in appt.film_entries or []:
        applications = fe.get("applications") or []
        if applications:
            for app in applications:
                ton = (app.get("tonality") or "").strip()
                region = (app.get("region") or "").strip()
                label = f"{ton} ({region})" if ton and region else ton
                if label and label not in seen:
                    seen.append(label)
            continue
        ton = (fe.get("tonality") or "").strip()
        if ton and ton not in seen:
            seen.append(ton)
    if not seen and appt.film_tonality:
        seen.append(appt.film_tonality.strip())
    return ", ".join(seen) if seen else "-"


def _model_with_flags(appt: AppointmentResponse) -> str:
    parts = [appt.vehicle_model or "-"]
    if appt.is_return:
        parts.append("Retorno")
    if appt.is_galpon:
        parts.append("Galpão")
    if appt.is_courtesy:
        parts.append("Cortesia")
    return " · ".join(parts)


def build_carros_data(
    appointments: list[AppointmentResponse],
    store_label: str,
    period_label: str,
    department_label: str,
    category_label: str,
) -> CarrosParaFazerData:
    """Agrupa os agendamentos por data de entrega, ordenando por horário."""
    store_ids = {a.store_id for a in appointments}
    multi_store = len(store_ids) > 1

    groups_map: dict[date_type, DateGroup] = {}
    for appt in appointments:
        group = groups_map.setdefault(appt.delivery_date, DateGroup(day=appt.delivery_date))
        group.rows.append(
            CarRow(
                time_label=_time_label(appt.delivery_time),
                plate=appt.vehicle_plate or "-",
                model=_model_with_flags(appt),
                color=appt.vehicle_color or "-",
                store=appt.store_name or "-",
                department=DEPARTMENT_LABELS.get(appt.department, appt.department),
                services=" + ".join(appt.service_names) if appt.service_names else "-",
                tonality=_tonalities(appt),
                consultant=_name_surname(appt.consultant_name),
                scheduled_at=_scheduled_at_label(appt.created_at),
                status=appt.display_status,
                # Sempre a O.S. da concessionária (externa); nunca o número do sistema.
                os_number=appt.external_os_number or "-",
            )
        )

    groups = [groups_map[d] for d in sorted(groups_map)]
    for group in groups:
        # Dentro do dia: por horário (sem hora vai para o fim), depois loja e placa
        group.rows.sort(key=lambda r: (r.time_label == "--:--", r.time_label, r.store, r.plate))

    return CarrosParaFazerData(
        store_label=store_label,
        period_label=period_label,
        department_label=department_label,
        category_label=category_label,
        generated_at=datetime.now(TZ_LOCAL),
        total=len(appointments),
        multi_store=multi_store,
        groups=groups,
    )


# =============================================================================
# Geração do PDF
# =============================================================================


def _latin1(text: str) -> str:
    """Fontes core do fpdf2 são latin-1; substitui o que não couber."""
    return (text or "").encode("latin-1", "replace").decode("latin-1")


def _columns(multi_store: bool) -> list[tuple[str, str, float, str, bool]]:
    """Colunas: (chave, título, largura mm, alinhamento, quebra_linha). Soma = 277."""
    if multi_store:
        return [
            ("time_label", "HORA", 14, "L", False),
            ("plate", "CHASSI / PLACA", 22, "L", False),
            ("model", "MODELO", 30, "L", True),
            ("color", "COR", 16, "L", False),
            ("store", "LOJA", 26, "L", True),
            ("department", "DEPTO", 18, "L", False),
            ("services", "SERVIÇOS", 52, "L", True),
            ("tonality", "TONAL.", 16, "L", False),
            ("consultant", "CONSULTOR", 30, "L", True),
            ("scheduled_at", "AGEND. EM", 17, "L", False),
            ("status", "STATUS", 18, "L", False),
            ("os_number", "O.S.", 18, "L", False),
        ]
    return [
        ("time_label", "HORA", 14, "L", False),
        ("plate", "CHASSI / PLACA", 24, "L", False),
        ("model", "MODELO", 34, "L", True),
        ("color", "COR", 18, "L", False),
        ("department", "DEPTO", 20, "L", False),
        ("services", "SERVIÇOS", 66, "L", True),
        ("tonality", "TONAL.", 20, "L", False),
        ("consultant", "CONSULTOR", 34, "L", True),
        ("scheduled_at", "AGEND. EM", 18, "L", False),
        ("status", "STATUS", 15, "L", False),
        ("os_number", "O.S.", 14, "L", False),
    ]


def _fit_line(pdf: FPDF, text: str, width: float) -> str:
    """Uma linha só: corta o excedente que não cabe na coluna."""
    text = _latin1(text)
    usable = width - 1.6
    if pdf.get_string_width(text) <= usable:
        return text
    cut = len(text)
    while cut > 0 and pdf.get_string_width(text[:cut]) > usable:
        cut -= 1
    return text[:cut]


def _wrap_text(pdf: FPDF, text: str, width: float) -> list[str]:
    """Quebra texto em linhas que cabem na largura da coluna."""
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


class _CarrosPDF(FPDF):
    def __init__(self, data: CarrosParaFazerData):
        super().__init__(orientation="landscape", format="A4")
        self.data = data
        self.set_margins(MARGIN, MARGIN, MARGIN)
        self.set_auto_page_break(auto=True, margin=12)
        self.alias_nb_pages()

    def footer(self) -> None:
        self.set_y(-10)
        self.set_font("helvetica", "", 7)
        self.set_text_color(*GRAY)
        left = f"Carros para Fazer · {self.data.store_label} · gerado em {self.data.generated_at.strftime('%d/%m/%Y %H:%M')}"
        self.cell(CONTENT_W / 2, 5, _latin1(left))
        self.cell(CONTENT_W / 2, 5, f"Página {self.page_no()} de {{nb}}", align="R")


def _draw_header(pdf: _CarrosPDF) -> None:
    data = pdf.data
    # Título
    pdf.set_font("helvetica", "B", 17)
    pdf.set_text_color(*DARK)
    prefix = "Carros para "
    pdf.cell(pdf.get_string_width(prefix) + 1, 8, _latin1(prefix))
    pdf.set_text_color(*ORANGE)
    pdf.cell(0, 8, _latin1("Fazer"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    # Barra de informações
    bar_y = pdf.get_y()
    bar_h = 12
    pdf.set_draw_color(*ORANGE)
    pdf.set_line_width(0.7)
    pdf.line(MARGIN, bar_y, MARGIN + CONTENT_W, bar_y)
    pdf.set_draw_color(*LINE_GRAY)
    pdf.set_line_width(0.25)
    pdf.rect(MARGIN, bar_y, CONTENT_W, bar_h)

    fields = [
        ("LOJA", data.store_label, 55),
        ("PERÍODO", data.period_label, 50),
        ("DEPARTAMENTO", data.department_label, 45),
        ("CATEGORIA", data.category_label, 45),
        ("TOTAL DE CARROS", str(data.total), 30),
        (
            "GERADO EM",
            data.generated_at.strftime("%d/%m/%Y %H:%M"),
            CONTENT_W - 55 - 50 - 45 - 45 - 30 - 6,
        ),
    ]
    x = MARGIN + 3
    for label, value, width in fields:
        pdf.set_xy(x, bar_y + 1.8)
        pdf.set_font("helvetica", "", 5.5)
        pdf.set_text_color(*GRAY)
        pdf.cell(width, 3, _latin1(label))
        pdf.set_xy(x, bar_y + 5.4)
        pdf.set_font("helvetica", "B", 8)
        pdf.set_text_color(*DARK)
        pdf.cell(width, 4.5, _fit_line(pdf, value, width))
        x += width + 2
    pdf.set_y(bar_y + bar_h + 2)

    # Legenda de status
    pdf.set_font("helvetica", "", 6.5)
    x = MARGIN
    y = pdf.get_y()
    for key in ("atrasado", "atencao", "agendado", "em_execucao"):
        pdf.set_fill_color(*STATUS_COLORS[key])
        pdf.set_draw_color(*STATUS_COLORS[key])
        pdf.rect(x, y + 0.6, 2.6, 2.6, style="F")
        pdf.set_xy(x + 3.4, y)
        pdf.set_text_color(*GRAY)
        label = _latin1(STATUS_LABELS[key])
        pdf.cell(pdf.get_string_width(label) + 6, 4, label)
        x += pdf.get_string_width(label) + 12
    pdf.set_y(y + 5)


def _draw_table_header(pdf: _CarrosPDF, cols: list) -> None:
    pdf.set_font("helvetica", "B", 6)
    pdf.set_fill_color(245, 245, 245)
    pdf.set_draw_color(*LIGHT_GRAY)
    pdf.set_line_width(0.2)
    y = pdf.get_y()
    pdf.rect(MARGIN, y, CONTENT_W, 5, style="F")
    x = MARGIN
    pdf.set_text_color(*GRAY)
    for _key, title, width, align, _wrap in cols:
        pdf.set_xy(x + 0.8, y)
        pdf.cell(width - 1.6, 5, _latin1(title), align=align)
        x += width
    pdf.set_y(y + 5)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())


def _draw_date_label(pdf: _CarrosPDF, group: DateGroup) -> None:
    weekday = WEEKDAYS_PT[group.day.weekday()]
    count = len(group.rows)
    veic = "carro" if count == 1 else "carros"
    label = f"{group.day.strftime('%d/%m/%Y')} · {weekday}  ({count} {veic})"
    pdf.ln(1.5)
    if pdf.get_y() + 14 > pdf.page_break_trigger:
        pdf.add_page()
    pdf.set_font("helvetica", "B", 9)
    pdf.set_text_color(*DARK)
    pdf.cell(0, 6, _latin1(label), new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(*ORANGE)
    pdf.set_line_width(0.5)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())
    pdf.ln(1)


def _draw_row(pdf: _CarrosPDF, row: CarRow, cols: list) -> None:
    line_h = 3.4
    font_size = 7

    pdf.set_font("helvetica", "", font_size)
    wrapped: list[list[str]] = []
    max_lines = 1
    for key, _title, width, _align, wrap in cols:
        value = getattr(row, key)
        if wrap:
            lines = _wrap_text(pdf, str(value), width)
        else:
            lines = [_fit_line(pdf, str(value), width)]
        wrapped.append(lines)
        max_lines = max(max_lines, len(lines))
    row_h = max_lines * line_h + 1.4

    if pdf.get_y() + row_h > pdf.page_break_trigger:
        pdf.add_page()
        _draw_table_header(pdf, cols)

    y = pdf.get_y()
    x = MARGIN
    for (key, _title, width, align, _wrap), lines in zip(cols, wrapped, strict=True):
        if key == "status":
            color = STATUS_COLORS.get(row.status, DARK)
            pdf.set_font("helvetica", "B", font_size)
            pdf.set_text_color(*color)
            text = STATUS_LABELS.get(row.status, row.status)
            pdf.set_xy(x + 0.8, y + 0.6)
            pdf.cell(width - 1.6, line_h, _fit_line(pdf, text, width), align=align)
            pdf.set_font("helvetica", "", font_size)
        else:
            bold = key == "plate"
            pdf.set_font("helvetica", "B" if bold else "", font_size)
            pdf.set_text_color(*DARK if bold else GRAY if key in ("os_number",) else DARK)
            for idx, line in enumerate(lines):
                pdf.set_xy(x + 0.8, y + 0.6 + idx * line_h)
                pdf.cell(width - 1.6, line_h, line, align=align)
        x += width
    pdf.set_y(y + row_h)
    pdf.set_draw_color(*LINE_GRAY)
    pdf.set_line_width(0.15)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())


def generate_carros_para_fazer_pdf(data: CarrosParaFazerData) -> bytes:
    """Gera o PDF 'Carros para Fazer' (A4 paisagem)."""
    pdf = _CarrosPDF(data)
    pdf.add_page()
    _draw_header(pdf)

    cols = _columns(data.multi_store)

    if not data.groups:
        pdf.ln(4)
        pdf.set_font("helvetica", "I", 10)
        pdf.set_text_color(*GRAY)
        pdf.cell(
            0,
            8,
            _latin1("Nenhum carro pendente para os filtros selecionados."),
            new_x="LMARGIN",
            new_y="NEXT",
        )
        return bytes(pdf.output())

    for group in data.groups:
        _draw_date_label(pdf, group)
        _draw_table_header(pdf, cols)
        for row in group.rows:
            _draw_row(pdf, row, cols)

    return bytes(pdf.output())
