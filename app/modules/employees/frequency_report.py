"""
Relatório de Frequência do funcionário em PDF (mensal).

Resume a presença de um funcionário no mês: dias úteis (seg–sáb menos
feriados da loja), faltas por tipo, férias e afastamentos — derivados dos
movimentos de RH (mesma regra da tela Faltas do Dia / Resumo Diário).
Layout A4 retrato, mesma linguagem visual do Resumo Diário.
"""

import calendar
from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import datetime, timedelta

from fpdf import FPDF
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.employees.models import EmployeeMovement
from app.modules.employees.service import (
    ABSENCE_TYPE_LABELS,
    FAULT_TYPE_LABELS,
    _parse_iso_date,
    get_employee,
    movement_covers_day,
)
from app.modules.holidays.service import get_holiday_dates_for_store

MONTH_NAMES = [
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


@dataclass
class Occurrence:
    kind: str  # rótulo legível (Falta: Atestado / Férias / Afastamento: INSS)
    period: str  # "05/07" ou "05/07 a 12/07"
    days_in_month: int  # dias úteis cobertos dentro do mês
    notes: str


@dataclass
class FrequencyReportData:
    employee_name: str
    position: str | None
    store_name: str
    month_label: str
    generated_by: str
    generated_at: datetime
    business_days: int = 0
    present_days: int = 0
    fault_days: int = 0
    vacation_days: int = 0
    absence_days: int = 0
    faults_by_type: dict[str, int] = field(default_factory=dict)
    occurrences: list[Occurrence] = field(default_factory=list)


def _movement_range(movement: EmployeeMovement) -> tuple[date_type, date_type] | None:
    """Intervalo [início, fim] coberto pelo movimento (fim inclusivo)."""
    data = movement.movement_data or {}

    if movement.type == "fault":
        start = _parse_iso_date(data.get("date"))
        if start is None:
            return None
        days = int(data.get("days_count") or 1)
        return start, start + timedelta(days=max(days, 1) - 1)

    if movement.type == "vacation":
        start = _parse_iso_date(data.get("start_date"))
        if start is None:
            return None
        raw_return = _parse_iso_date(data.get("return_date") or data.get("forecast_date"))
        end = raw_return - timedelta(days=1) if raw_return else start + timedelta(days=29)
        return start, end

    if movement.type == "absence":
        start = _parse_iso_date(data.get("start_date"))
        if start is None:
            return None
        raw_return = _parse_iso_date(data.get("return_date"))
        end = raw_return - timedelta(days=1) if raw_return else None
        return start, end if end is not None else date_type.max

    return None


def _movement_label(movement: EmployeeMovement) -> str:
    data = movement.movement_data or {}
    if movement.type == "fault":
        label = FAULT_TYPE_LABELS.get(str(data.get("fault_type")))
        return f"Falta: {label}" if label else "Falta"
    if movement.type == "vacation":
        return "Férias"
    label = ABSENCE_TYPE_LABELS.get(str(data.get("absence_type")))
    return f"Afastamento: {label}" if label else "Afastamento"


async def gather_frequency_report(
    db: AsyncSession,
    employee_id: int,
    ref_date: date_type,
    generated_by: str,
) -> FrequencyReportData:
    """Coleta a frequência do funcionário no mês de ref_date."""
    employee = await get_employee(db, employee_id)

    month_start = ref_date.replace(day=1)
    last_day = calendar.monthrange(ref_date.year, ref_date.month)[1]
    month_end = date_type(ref_date.year, ref_date.month, last_day)

    holidays = await get_holiday_dates_for_store(db, employee.store_id, month_start, month_end)
    holiday_dates = {h.date for h in holidays}
    business_days = [
        d
        for d in (month_start + timedelta(days=i) for i in range(last_day))
        if d.weekday() <= 5 and d not in holiday_dates
    ]

    mov_result = await db.execute(
        select(EmployeeMovement)
        .where(
            EmployeeMovement.employee_id == employee_id,
            EmployeeMovement.type.in_(("fault", "vacation", "absence")),
            EmployeeMovement.movement_date >= month_start - timedelta(days=366),
            EmployeeMovement.movement_date <= month_end,
        )
        .order_by(EmployeeMovement.created_at)
    )
    movements = list(mov_result.scalars().all())

    display = (
        f"{employee.name} {employee.last_name}".strip() if employee.last_name else employee.name
    )
    data = FrequencyReportData(
        employee_name=display,
        position=employee.position,
        store_name=employee.store.name if employee.store else "",
        month_label=f"{MONTH_NAMES[ref_date.month - 1]}/{ref_date.year}",
        generated_by=generated_by,
        generated_at=datetime.now(),
        business_days=len(business_days),
    )

    # Status dia a dia (prioridade: falta > férias > afastamento)
    for day in business_days:
        day_status: str | None = None
        for wanted in ("fault", "vacation", "absence"):
            for mov in movements:
                if mov.type != wanted:
                    continue
                covers, reason = movement_covers_day(mov, day)
                if covers:
                    day_status = wanted
                    if wanted == "fault":
                        label = reason.removeprefix("Falta: ") if ": " in reason else "Falta"
                        data.faults_by_type[label] = data.faults_by_type.get(label, 0) + 1
                    break
            if day_status:
                break
        if day_status == "fault":
            data.fault_days += 1
        elif day_status == "vacation":
            data.vacation_days += 1
        elif day_status == "absence":
            data.absence_days += 1

    data.present_days = (
        data.business_days - data.fault_days - data.vacation_days - data.absence_days
    )

    # Ocorrências que tocam o mês
    for mov in movements:
        rng = _movement_range(mov)
        if rng is None:
            continue
        start, end = rng
        if end < month_start or start > month_end:
            continue
        vis_start = max(start, month_start)
        vis_end = min(end, month_end)
        covered = sum(1 for d in business_days if vis_start <= d <= vis_end)
        period = (
            vis_start.strftime("%d/%m")
            if vis_start == vis_end
            else f"{vis_start.strftime('%d/%m')} a {vis_end.strftime('%d/%m')}"
        )
        if end == date_type.max:
            period = f"{vis_start.strftime('%d/%m')} em diante"
        data.occurrences.append(
            Occurrence(
                kind=_movement_label(mov),
                period=period,
                days_in_month=covered,
                notes=(mov.notes or "").strip(),
            )
        )

    return data


# =============================================================================
# PDF
# =============================================================================

ORANGE = (232, 138, 0)
DARK = (23, 23, 23)
GRAY = (120, 120, 120)
LIGHT_GRAY = (200, 200, 200)
LINE_GRAY = (225, 225, 225)

MARGIN = 12
PAGE_W = 210
CONTENT_W = PAGE_W - 2 * MARGIN


def _latin1(text: str) -> str:
    return (text or "").encode("latin-1", "replace").decode("latin-1")


class _FrequencyPDF(FPDF):
    def __init__(self, data: FrequencyReportData):
        super().__init__(orientation="portrait", format="A4")
        self.data = data
        self.set_margins(MARGIN, MARGIN, MARGIN)
        self.set_auto_page_break(auto=True, margin=16)
        self.alias_nb_pages()

    def footer(self) -> None:
        self.set_y(-12)
        self.set_font("helvetica", "", 7)
        self.set_text_color(*GRAY)
        emitted = self.data.generated_at.strftime("%d/%m/%Y %H:%M")
        self.cell(
            CONTENT_W / 2,
            5,
            _latin1(f"Emitido por {self.data.generated_by} em {emitted}"),
        )
        self.cell(CONTENT_W / 2, 5, f"Página {self.page_no()} de {{nb}}", align="R")


def generate_frequency_report_pdf(data: FrequencyReportData) -> bytes:
    """Gera o PDF do Relatório de Frequência (A4 retrato, 1 página típica)."""
    pdf = _FrequencyPDF(data)
    pdf.add_page()

    # Título
    pdf.set_font("helvetica", "B", 17)
    pdf.set_text_color(*DARK)
    part1 = "Relatório de "
    pdf.cell(pdf.get_string_width(part1) + 1, 8, _latin1(part1))
    pdf.set_text_color(*ORANGE)
    pdf.cell(0, 8, _latin1("Frequência"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("helvetica", "", 8)
    pdf.set_text_color(*GRAY)
    pdf.cell(0, 4.5, _latin1("Gestão de Pessoal · Presenças do mês"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # Barra de identificação
    bar_y = pdf.get_y()
    bar_h = 13
    pdf.set_draw_color(*ORANGE)
    pdf.set_line_width(0.7)
    pdf.line(MARGIN, bar_y, MARGIN + CONTENT_W, bar_y)
    pdf.set_draw_color(*LINE_GRAY)
    pdf.set_line_width(0.25)
    pdf.rect(MARGIN, bar_y, CONTENT_W, bar_h)

    fields = [
        ("FUNCIONÁRIO", data.employee_name, 62),
        ("CARGO", data.position or "-", 44),
        ("LOJA", data.store_name, 46),
        ("MÊS", data.month_label, CONTENT_W - 62 - 44 - 46 - 14),
    ]
    x = MARGIN + 3
    for label, value, width in fields:
        pdf.set_xy(x, bar_y + 2)
        pdf.set_font("helvetica", "", 5.5)
        pdf.set_text_color(*GRAY)
        pdf.cell(width, 3.2, _latin1(label))
        pdf.set_xy(x, bar_y + 5.6)
        pdf.set_font("helvetica", "B", 8)
        pdf.set_text_color(*DARK)
        pdf.cell(width, 4.4, _latin1(value))
        x += width + 2
    pdf.set_y(bar_y + bar_h + 5)

    # Cards de resumo
    cards = [
        ("DIAS ÚTEIS", str(data.business_days)),
        ("PRESENÇAS", str(data.present_days)),
        ("FALTAS", str(data.fault_days)),
        ("FÉRIAS", str(data.vacation_days)),
        ("AFASTAMENTO", str(data.absence_days)),
    ]
    gap = 4
    card_w = (CONTENT_W - gap * (len(cards) - 1)) / len(cards)
    card_h = 15
    y = pdf.get_y()
    x = MARGIN
    pdf.set_draw_color(*LIGHT_GRAY)
    pdf.set_line_width(0.25)
    for label, value in cards:
        pdf.rect(x, y, card_w, card_h, round_corners=True, corner_radius=1.5)
        pdf.set_xy(x + 2, y + 2.5)
        pdf.set_font("helvetica", "", 5)
        pdf.set_text_color(*GRAY)
        pdf.cell(card_w - 4, 3, _latin1(label))
        pdf.set_xy(x + 2, y + 7)
        pdf.set_font("helvetica", "B", 12)
        pdf.set_text_color(*DARK)
        pdf.cell(card_w - 4, 6, _latin1(value))
        x += card_w + gap
    pdf.set_y(y + card_h + 3)

    # Faltas por tipo
    if data.faults_by_type:
        pdf.set_font("helvetica", "", 7.5)
        pdf.set_text_color(*GRAY)
        detail = " · ".join(f"{k}: {v}" for k, v in sorted(data.faults_by_type.items()))
        pdf.cell(0, 5, _latin1(f"Faltas por tipo: {detail}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # Ocorrências
    pdf.set_font("helvetica", "B", 11)
    pdf.set_text_color(*DARK)
    pdf.cell(0, 7, _latin1("OCORRÊNCIAS DO MÊS"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(*LINE_GRAY)
    pdf.set_line_width(0.3)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())
    pdf.ln(2)

    col_widths = [34, 52, 22, CONTENT_W - 34 - 52 - 22]
    headers = ["PERÍODO", "TIPO", "DIAS ÚTEIS", "OBSERVAÇÃO"]
    pdf.set_font("helvetica", "", 5.5)
    pdf.set_text_color(*GRAY)
    x = MARGIN
    for header, width in zip(headers, col_widths, strict=True):
        pdf.set_xy(x, pdf.get_y())
        pdf.cell(width, 4.5, _latin1(header))
        x += width
    pdf.ln(4.5)
    pdf.set_draw_color(*LIGHT_GRAY)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())

    if not data.occurrences:
        pdf.set_font("helvetica", "I", 8)
        pdf.set_text_color(*GRAY)
        pdf.cell(
            0,
            8,
            _latin1("Nenhuma ocorrência no mês — frequência integral."),
            new_x="LMARGIN",
            new_y="NEXT",
        )
    else:
        for occ in data.occurrences:
            row_y = pdf.get_y()
            values = [occ.period, occ.kind, str(occ.days_in_month), occ.notes or "-"]
            pdf.set_font("helvetica", "", 8)
            pdf.set_text_color(*DARK)
            x = MARGIN
            for value, width in zip(values, col_widths, strict=True):
                pdf.set_xy(x, row_y + 1)
                pdf.cell(width - 1, 4.5, _latin1(value))
                x += width
            pdf.set_y(row_y + 6.5)
            pdf.set_draw_color(*LINE_GRAY)
            pdf.set_line_width(0.15)
            pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())

    # Assinaturas
    pdf.ln(18)
    sig_y = pdf.get_y()
    half = CONTENT_W / 2 - 10
    pdf.set_draw_color(*GRAY)
    pdf.set_line_width(0.3)
    pdf.line(MARGIN, sig_y, MARGIN + half, sig_y)
    pdf.line(MARGIN + CONTENT_W - half, sig_y, MARGIN + CONTENT_W, sig_y)
    pdf.set_font("helvetica", "", 7)
    pdf.set_text_color(*GRAY)
    pdf.set_xy(MARGIN, sig_y + 1)
    pdf.cell(half, 4, _latin1("Assinatura do funcionário"), align="C")
    pdf.set_xy(MARGIN + CONTENT_W - half, sig_y + 1)
    pdf.cell(half, 4, _latin1("Assinatura do responsável"), align="C")

    return bytes(pdf.output())
