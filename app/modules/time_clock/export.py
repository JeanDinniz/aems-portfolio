"""
Espelho de Ponto em PDF (diário, por loja) — mesma linguagem visual dos
demais relatórios (Resumo Diário / Frequência). Selfies não são embutidas;
ficam disponíveis no espelho do sistema.
"""

from datetime import date as date_type
from datetime import datetime

from fpdf import FPDF
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.modules.stores.models import Store
from app.modules.time_clock.models import TimeClockRecord
from app.modules.time_clock.service import TYPE_LABELS, TZ_LOCAL, is_offline_sync_late

ORANGE = (232, 138, 0)
DARK = (23, 23, 23)
GRAY = (120, 120, 120)
LIGHT_GRAY = (200, 200, 200)
LINE_GRAY = (225, 225, 225)

MARGIN = 12
PAGE_W = 210
CONTENT_W = PAGE_W - 2 * MARGIN

COLS = [
    ("HORA", 18, "L"),
    ("FUNCIONÁRIO", 62, "L"),
    ("TIPO", 20, "L"),
    ("DISTÂNCIA", 24, "R"),
    ("PRECISÃO GPS", 26, "R"),
    ("LOCALIZAÇÃO", CONTENT_W - 18 - 62 - 20 - 24 - 26, "L"),
]


def _latin1(text: str) -> str:
    return (text or "").encode("latin-1", "replace").decode("latin-1")


def _fmt_distance(record: TimeClockRecord) -> str:
    if record.distance_m is None:
        return "-"
    meters = float(record.distance_m)
    if meters >= 1000:
        return f"{meters / 1000:.1f} km".replace(".", ",")
    return f"{meters:.0f} m"


class _MirrorPDF(FPDF):
    def __init__(self, store_name: str, day: date_type, generated_by: str):
        super().__init__(orientation="portrait", format="A4")
        self.store_name = store_name
        self.day_str = day.strftime("%d/%m/%Y")
        self.generated_by = generated_by
        self.set_margins(MARGIN, MARGIN, MARGIN)
        self.set_auto_page_break(auto=True, margin=14)
        self.alias_nb_pages()

    def footer(self) -> None:
        self.set_y(-11)
        self.set_font("helvetica", "", 7)
        self.set_text_color(*GRAY)
        emitted = datetime.now(TZ_LOCAL).strftime("%d/%m/%Y %H:%M")
        self.cell(
            CONTENT_W / 2,
            5,
            _latin1(f"Emitido por {self.generated_by} em {emitted}"),
        )
        self.cell(CONTENT_W / 2, 5, f"Página {self.page_no()} de {{nb}}", align="R")


async def generate_mirror_pdf(
    db: AsyncSession, store_id: int, day: date_type, generated_by: str
) -> bytes:
    """Gera o espelho de ponto do dia da loja em PDF."""
    store_name = (
        await db.execute(select(Store.name).where(Store.id == store_id))
    ).scalar_one_or_none() or str(store_id)

    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(TimeClockRecord)
        .options(selectinload(TimeClockRecord.employee))
        .where(
            TimeClockRecord.store_id == store_id,
            TimeClockRecord.recorded_date == day,
        )
        .order_by(TimeClockRecord.recorded_at)
    )
    records = list(result.scalars().all())
    settings = get_settings()

    pdf = _MirrorPDF(store_name, day, generated_by)
    pdf.add_page()

    # Título
    pdf.set_font("helvetica", "B", 17)
    pdf.set_text_color(*DARK)
    part1 = "Espelho de "
    pdf.cell(pdf.get_string_width(part1) + 1, 8, _latin1(part1))
    pdf.set_text_color(*ORANGE)
    pdf.cell(0, 8, _latin1("Ponto"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("helvetica", "", 8)
    pdf.set_text_color(*GRAY)
    pdf.cell(
        0,
        4.5,
        _latin1(f"{store_name} · {day.strftime('%d/%m/%Y')} · controle interno de presença"),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(4)

    # Cabeçalho da tabela
    pdf.set_draw_color(*ORANGE)
    pdf.set_line_width(0.7)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())
    pdf.ln(1.5)
    pdf.set_font("helvetica", "", 5.5)
    pdf.set_text_color(*GRAY)
    x = MARGIN
    y = pdf.get_y()
    for title, width, align in COLS:
        pdf.set_xy(x, y)
        pdf.cell(width, 4.5, _latin1(title), align=align)
        x += width
    pdf.set_y(y + 4.5)
    pdf.set_draw_color(*LIGHT_GRAY)
    pdf.set_line_width(0.3)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())

    if not records:
        pdf.set_font("helvetica", "I", 8)
        pdf.set_text_color(*GRAY)
        pdf.cell(0, 8, _latin1("Nenhuma batida registrada no dia."), new_x="LMARGIN", new_y="NEXT")

    for record in records:
        employee = record.employee
        name = ""
        if employee:
            name = (
                f"{employee.name} {employee.last_name}".strip()
                if employee.last_name
                else employee.name
            )
        hora = record.recorded_at.astimezone(TZ_LOCAL).strftime("%H:%M")
        tipo = TYPE_LABELS.get(record.type, record.type)
        if record.is_offline_record:
            tipo += (
                " (offline, sync tardio)"
                if is_offline_sync_late(record, settings)
                else " (offline)"
            )
        distancia = _fmt_distance(record)
        precisao = f"{float(record.accuracy_m):.0f} m" if record.accuracy_m is not None else "-"
        if record.is_within_radius is False:
            local = "FORA DA LOJA"
        elif record.is_within_radius is None:
            local = "Sem geofence"
        else:
            local = "Na loja"

        values = [hora, name, tipo, distancia, precisao, local]
        out_of_range = record.is_within_radius is False

        row_y = pdf.get_y()
        if row_y + 7 > pdf.page_break_trigger:
            pdf.add_page()
            row_y = pdf.get_y()
        x = MARGIN
        for value, (_, width, align) in zip(values, COLS, strict=True):
            pdf.set_font("helvetica", "B" if out_of_range else "", 8)
            pdf.set_text_color(*(ORANGE if out_of_range else DARK))
            pdf.set_xy(x, row_y + 1)
            pdf.cell(width - 1, 4.5, _latin1(str(value)), align=align)
            x += width
        pdf.set_y(row_y + 6.5)
        pdf.set_draw_color(*LINE_GRAY)
        pdf.set_line_width(0.15)
        pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())

    return bytes(pdf.output())


def generate_receipt_pdf(receipt) -> bytes:
    """Comprovante de registro de batida em formato cupom (80mm), com o NSR real."""
    pdf = FPDF(orientation="P", unit="mm", format=(80, 120))
    pdf.add_page()
    pdf.set_font("helvetica", "B", 12)
    pdf.cell(0, 8, _latin1("COMPROVANTE DE REGISTRO"), new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.set_font("helvetica", "", 9)
    linhas = [
        f"NSR: {receipt.nsr}",
        f"Empregador: {receipt.employer_name}",
        f"CNPJ: {receipt.employer_cnpj}",
        f"Empregado: {receipt.employee_name}",
        f"CPF: {receipt.employee_cpf or '-'}",
        f"Tipo: {'Entrada' if receipt.type == 'in' else 'Saida'}",
        f"Data/Hora: {receipt.recorded_at.astimezone(TZ_LOCAL).strftime('%d/%m/%Y %H:%M:%S')}",
        f"Offline: {'Sim' if receipt.is_offline_record else 'Nao'}",
        f"Sistema: {receipt.system_id}",
        f"Conf.: ...{receipt.hash_short}",
    ]
    for ln in linhas:
        pdf.cell(0, 6, _latin1(ln), new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


async def generate_employee_mirror_pdf(
    db: AsyncSession,
    employee_id: int,
    start: date_type,
    end: date_type,
    employee_name: str,
    period_label: str,
) -> bytes:
    """
    Espelho de ponto do PRÓPRIO funcionário no período (autoatendimento — Portaria
    671). Lista dia/hora/tipo de cada batida. Sem selfies embutidas.
    """
    result = await db.execute(
        select(TimeClockRecord)
        .where(
            TimeClockRecord.employee_id == employee_id,
            TimeClockRecord.recorded_date >= start,
            TimeClockRecord.recorded_date <= end,
        )
        .order_by(TimeClockRecord.recorded_at)
    )
    records = list(result.scalars().all())

    pdf = FPDF(orientation="portrait", format="A4")
    pdf.set_margins(MARGIN, MARGIN, MARGIN)
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_page()

    pdf.set_font("helvetica", "B", 17)
    pdf.set_text_color(*DARK)
    part1 = "Meu Espelho de "
    pdf.cell(pdf.get_string_width(part1) + 1, 8, _latin1(part1))
    pdf.set_text_color(*ORANGE)
    pdf.cell(0, 8, _latin1("Ponto"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("helvetica", "", 8)
    pdf.set_text_color(*GRAY)
    pdf.cell(
        0,
        4.5,
        _latin1(
            f"{employee_name} · {period_label} "
            f"({start.strftime('%d/%m/%Y')} a {end.strftime('%d/%m/%Y')}) · controle interno"
        ),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(4)

    pdf.set_draw_color(*ORANGE)
    pdf.set_line_width(0.7)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())
    pdf.ln(2)

    if not records:
        pdf.set_font("helvetica", "I", 9)
        pdf.set_text_color(*GRAY)
        pdf.cell(0, 8, _latin1("Nenhuma batida no período."), new_x="LMARGIN", new_y="NEXT")

    for record in records:
        dia = record.recorded_at.astimezone(TZ_LOCAL).strftime("%d/%m/%Y")
        hora = record.recorded_at.astimezone(TZ_LOCAL).strftime("%H:%M")
        tipo = TYPE_LABELS.get(record.type, record.type)
        extra = " (ajuste)" if record.source != "employee" else ""
        pdf.set_font("helvetica", "", 9)
        pdf.set_text_color(*DARK)
        pdf.cell(0, 6, _latin1(f"{dia}   {hora}   {tipo}{extra}"), new_x="LMARGIN", new_y="NEXT")

    return bytes(pdf.output())
