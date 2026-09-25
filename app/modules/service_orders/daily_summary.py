"""
Resumo Diário da loja em PDF.

Gera o "Relatório de Serviços" (Resumo do Dia do Encarregado): O.S. lançadas
no dia agrupadas em Estética (todos os departamentos exceto películas) e
Película (film/security_film/ppf), com totais do dia, acumulado do mês,
média diária e projeção. Layout A4 retrato (vertical).

Regras (acordadas com a operação):
- Data-base: O.S. de Película/PPF/Pel. Segurança finalizada conta pelo dia de
  finalização (completion_time); todos os demais casos (departamentos de Estética
  ou status não-finalizado) por coalesce(service_date, date(entry_time)) — igual
  à listagem.
- Galpão (is_galpon) fica fora do relatório das lojas; a loja marcada como
  galpão (Store.is_galpon_store) gera o resumo do galpão: O.S. com
  is_galpon=True de qualquer loja.
- cancelled/wrong/duplicate aparecem sinalizadas na listagem, fora dos totais.
- is_courtesy: linha em negrito, valor visível; NÃO soma no total, exceto os
  itens LAV.CORTESIA (lavagem cortesia é faturável — a concessionária paga).
- Dias úteis = seg–sex do mês menos feriados da loja (cadastro de feriados).
"""

import calendar
from dataclasses import dataclass, field
from datetime import date as date_type
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from fpdf import FPDF
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.employees import service as employees_service
from app.modules.holidays.service import get_holiday_dates_for_store
from app.modules.service_orders.models import (
    ServiceOrder,
    ServiceOrderItem,
    ServiceOrderWorker,
)
from app.modules.services.models import Service
from app.modules.stores.models import Store

# Mesma regra canônica do Fechamento/Analytics
EXCLUDED_STATUSES = ("cancelled", "wrong", "duplicate")
FILM_DEPARTMENTS = ("film", "security_film", "ppf")
TZ_LOCAL = ZoneInfo("America/Sao_Paulo")

# Serviço "Lavagem Cortesia": a concessionária paga por ele, então ele é
# faturável mesmo dentro de uma O.S. marcada como cortesia (is_courtesy). No
# valor do Resumo Diário somam-se APENAS os itens com este código; os demais
# serviços de uma O.S. cortesia continuam fora do total (regra do Fechamento).
LAV_CORTESIA_CODE = "LAV.CORTESIA"

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

STATUS_FLAG_LABELS = {
    "cancelled": "CANCELADA",
    "wrong": "LANÇADO ERRADO",
    "duplicate": "DUPLICADA",
}

# =============================================================================
# Estruturas de dados
# =============================================================================


@dataclass
class SummaryRow:
    department: str
    is_courtesy: bool
    flagged_status: str | None  # label quando cancelled/wrong/duplicate
    os_number: str
    plate: str
    vehicle: str  # "Modelo · Cor"
    service: str
    workers: str
    observations: str
    value: Decimal
    store_name: str = ""  # loja de destino da O.S. (só usada no relatório do galpão)
    dept_code: str = ""  # código cru do departamento (para agrupar por departamento)
    counted_value: Decimal = Decimal("0")  # valor faturável (regra LAV.CORTESIA) p/ subtotal


@dataclass
class SectionData:
    title: str
    rows: list[SummaryRow] = field(default_factory=list)
    vehicles_count: int = 0
    total_day: Decimal = Decimal("0")
    total_month: Decimal = Decimal("0")
    avg_daily: Decimal = Decimal("0")
    projection: Decimal = Decimal("0")


@dataclass
class AbsentInfo:
    name: str
    reason: str


@dataclass
class DailySummaryData:
    store_name: str
    report_date: date_type
    responsible: str
    generated_at: datetime
    worked_days: int
    business_days: int
    holidays: list[str]  # "dd/mm Nome"
    team_present: list[str]
    absents: list[AbsentInfo]
    faults_count: int
    is_galpon: bool = False  # relatório do galpão → exibe a coluna LOJA (destino)
    estetica: SectionData = field(default_factory=lambda: SectionData("DEPARTAMENTO DE ESTÉTICA"))
    pelicula: SectionData = field(default_factory=lambda: SectionData("DEPARTAMENTO DE PELÍCULA"))


# =============================================================================
# Coleta de dados
# =============================================================================


def _day_expr():
    """
    Data-base da O.S. para o resumo do dia.

    Regra híbrida (a pedido da operação):
    - PELÍCULA/PPF/PEL. SEGURANÇA finalizada (completed): dia em que foi CONCLUÍDA
      (date(completion_time)). Assim uma película feita adiantada (agendada p/
      frente) entra no resumo do dia em que foi aplicada.
    - Demais departamentos (Estética) e/ou status não-finalizado: service_date
      quando preenchida, senão data do lançamento. Um carro de estética conta
      sempre na data do serviço, mesmo que seja finalizado no sistema em outro dia.

    Cada O.S. cai em exatamente um dia; totais/projeção usam a mesma base.
    """
    completed_film_day = case(
        (
            and_(
                ServiceOrder.status == "completed",
                ServiceOrder.department.in_(FILM_DEPARTMENTS),
            ),
            func.date(ServiceOrder.completion_time),
        ),
        else_=None,
    )
    return func.coalesce(
        completed_film_day, ServiceOrder.service_date, func.date(ServiceOrder.entry_time)
    )


def _first_name(full: str) -> str:
    """Primeiro nome do funcionário (pedido da operação: nomes curtos no PDF)."""
    return full.split()[0] if full and full.strip() else (full or "")


async def _gather_team(
    db: AsyncSession, store_id: int, day: date_type
) -> tuple[list[str], list[AbsentInfo], int]:
    """
    Equipe presente, ausentes e qtd. de faltas do dia.
    Fonte única: employees.service.get_day_status (mesma da tela Faltas do Dia).
    """
    items = await employees_service.get_day_status(db, store_id, day)
    # Instaladores (cargo com "instalador") NÃO entram na equipe da loja no Resumo
    # Diário — a seção de Película foi removida, então o relatório trata só a
    # Estética. Exclusão só aqui; a tela Faltas do Dia continua mostrando todos.
    items = [i for i in items if not employees_service.is_installer_position(i.get("position"))]
    present = [
        _first_name(i["name"]) for i in items if i["status"] == employees_service.DAY_STATUS_PRESENT
    ]
    absents = [
        AbsentInfo(name=_first_name(i["name"]), reason=i["reason"] or "")
        for i in items
        if i["status"] != employees_service.DAY_STATUS_PRESENT
    ]
    faults_count = sum(1 for i in items if i["status"] == employees_service.DAY_STATUS_FAULT)
    return present, absents, faults_count


def _is_lav_cortesia(item: ServiceOrderItem) -> bool:
    """Item cujo serviço é a Lavagem Cortesia (código LAV.CORTESIA)."""
    return bool(item.service and (item.service.code or "").upper() == LAV_CORTESIA_CODE)


def _item_counts_in_total(order: ServiceOrder, item: ServiceOrderItem) -> bool:
    """
    Item entra no valor do resumo quando a O.S. não é cortesia (todos os itens
    somam, como sempre) OU quando o próprio item é LAV.CORTESIA (faturável mesmo
    em O.S. cortesia). Demais itens de O.S. cortesia ficam de fora.
    """
    return not order.is_courtesy or _is_lav_cortesia(item)


def _order_workers_names(order: ServiceOrder) -> str:
    """Todos os funcionários da O.S. (por item ou da O.S. inteira), sem repetição."""
    names = [_first_name(w.employee.name) for w in order.workers if w.employee]
    return ", ".join(dict.fromkeys(names))


def _build_rows(orders: list[ServiceOrder]) -> list[SummaryRow]:
    """Uma linha por O.S.: serviços como códigos somados ("COD1 + COD2"), valor = soma."""
    rows: list[SummaryRow] = []
    for order in orders:
        flagged = STATUS_FLAG_LABELS.get(order.status)
        obs_parts: list[str] = []
        if order.is_return:
            obs_parts.append("Retorno")
        if order.notes:
            obs_parts.append(order.notes.strip())
        observations = " · ".join(p for p in obs_parts if p)

        items = sorted(order.items, key=lambda i: i.id)
        codes = [(item.service.code or item.service.name) if item.service else "" for item in items]
        service_label = " + ".join(dict.fromkeys(c for c in codes if c))
        total = sum(
            ((item.unit_price or Decimal("0")) * (item.quantity or 1) for item in items),
            Decimal("0"),
        )
        # Valor faturável (subtotal por departamento): mesma regra do total do dia —
        # O.S. não-cortesia soma tudo; cortesia soma só os itens LAV.CORTESIA.
        counted = sum(
            (
                (item.unit_price or Decimal("0")) * (item.quantity or 1)
                for item in items
                if _item_counts_in_total(order, item)
            ),
            Decimal("0"),
        )
        # "Modelo · Cor" (ponto médio: "•" não existe em latin-1)
        vehicle = " · ".join(p for p in (order.vehicle_model, order.vehicle_color) if p)
        rows.append(
            SummaryRow(
                department=DEPARTMENT_LABELS.get(order.department, order.department),
                is_courtesy=order.is_courtesy,
                flagged_status=flagged,
                os_number=order.external_os_number or "",
                plate=order.vehicle_plate or "",
                vehicle=vehicle,
                service=service_label,
                workers=_order_workers_names(order),
                observations=observations,
                value=total,
                store_name=order.store.name if order.store else "",
                dept_code=order.department or "",
                counted_value=counted,
            )
        )
    return rows


def _scope_filters(store_id: int, galpon_mode: bool) -> list:
    """
    Escopo das O.S. do resumo. Loja comum: O.S. da loja fora do galpão.
    Loja galpão: O.S. is_galpon=True de qualquer loja (galpão é unidade única).
    """
    if galpon_mode:
        return [ServiceOrder.is_galpon.is_(True)]
    return [ServiceOrder.store_id == store_id, ServiceOrder.is_galpon.is_(False)]


async def _section_month_revenue(
    db: AsyncSession,
    store_id: int,
    galpon_mode: bool,
    month_start: date_type,
    report_date: date_type,
    film: bool,
) -> Decimal:
    """Receita acumulada da seção no mês (1º → data), regra do Fechamento."""
    dept_filter = (
        ServiceOrder.department.in_(FILM_DEPARTMENTS)
        if film
        else ServiceOrder.department.notin_(FILM_DEPARTMENTS)
    )
    query = (
        select(func.coalesce(func.sum(ServiceOrderItem.unit_price * ServiceOrderItem.quantity), 0))
        .join(ServiceOrder, ServiceOrderItem.service_order_id == ServiceOrder.id)
        .join(Service, ServiceOrderItem.service_id == Service.id)
        .where(
            *_scope_filters(store_id, galpon_mode),
            ServiceOrder.status.notin_(EXCLUDED_STATUSES),
            # Não-cortesia soma tudo; cortesia soma só os itens LAV.CORTESIA.
            or_(
                ServiceOrder.is_courtesy.is_(False),
                func.upper(Service.code) == LAV_CORTESIA_CODE,
            ),
            _day_expr() >= month_start,
            _day_expr() <= report_date,
            dept_filter,
        )
    )
    return Decimal(str((await db.execute(query)).scalar() or 0))


def _business_days(year: int, month: int, holiday_dates: set[date_type]) -> int:
    """Dias úteis do mês: segunda a sexta, menos feriados."""
    _, last_day = calendar.monthrange(year, month)
    count = 0
    for day_num in range(1, last_day + 1):
        d = date_type(year, month, day_num)
        if d.weekday() <= 4 and d not in holiday_dates:  # 0=seg ... 4=sex
            count += 1
    return count


async def gather_daily_summary(
    db: AsyncSession,
    store_id: int,
    report_date: date_type,
    responsible: str,
    only_completed: bool = False,
) -> DailySummaryData:
    """
    Coleta todos os dados do Resumo Diário da loja.

    only_completed=True: a listagem do dia traz APENAS O.S. finalizadas naquele
    dia (status completed, por completion_time) — usado no Resumo Diário do
    Agendamento ("carros finalizados no dia"). Os totais do mês/projeção seguem
    a mesma base de sempre (contexto da loja).
    """
    store = (await db.execute(select(Store).where(Store.id == store_id))).scalar_one()
    galpon_mode = bool(store.is_galpon_store)

    # O.S. do dia. Padrão: data-base (service_date/entry_time), inclui sinalizadas.
    # only_completed: só finalizadas do dia, pela data de finalização.
    if only_completed:
        day_filters = [
            *_scope_filters(store_id, galpon_mode),
            ServiceOrder.status == "completed",
            func.date(ServiceOrder.completion_time) == report_date,
        ]
    else:
        day_filters = [*_scope_filters(store_id, galpon_mode), _day_expr() == report_date]

    day_orders_result = await db.execute(
        select(ServiceOrder)
        .options(
            selectinload(ServiceOrder.items).selectinload(ServiceOrderItem.service),
            selectinload(ServiceOrder.workers).selectinload(ServiceOrderWorker.employee),
            selectinload(ServiceOrder.store),
        )
        .where(*day_filters)
        .order_by(ServiceOrder.entry_time)
    )
    day_orders = list(day_orders_result.scalars().unique().all())

    estetica_orders = [o for o in day_orders if o.department not in FILM_DEPARTMENTS]
    pelicula_orders = [o for o in day_orders if o.department in FILM_DEPARTMENTS]

    month_start = report_date.replace(day=1)
    month_end = date_type(
        report_date.year,
        report_date.month,
        calendar.monthrange(report_date.year, report_date.month)[1],
    )

    # Feriados do mês aplicáveis à loja
    holidays = await get_holiday_dates_for_store(db, store_id, month_start, month_end)
    holiday_dates = {h.date for h in holidays}
    business_days = _business_days(report_date.year, report_date.month, holiday_dates)

    # Dias trabalhados: dias distintos do mês (até a data) com O.S. válida,
    # contando só seg–sex (mesma base dos dias úteis)
    worked_days_q = select(func.distinct(_day_expr())).where(
        *_scope_filters(store_id, galpon_mode),
        ServiceOrder.status.notin_(EXCLUDED_STATUSES),
        _day_expr() >= month_start,
        _day_expr() <= report_date,
    )
    worked_dates = (await db.execute(worked_days_q)).scalars().all()
    worked_days = 0
    for d in worked_dates:
        if d is None:
            continue
        if isinstance(d, str):  # drivers sem tipo date nativo
            d = date_type.fromisoformat(d)
        if d.weekday() <= 4:
            worked_days += 1

    team_present, absents, faults_count = await _gather_team(db, store_id, report_date)

    data = DailySummaryData(
        store_name=store.name,
        report_date=report_date,
        responsible=responsible,
        generated_at=datetime.now(TZ_LOCAL),
        worked_days=worked_days,
        business_days=business_days,
        holidays=[f"{h.date.strftime('%d/%m')} {h.name}" for h in holidays],
        team_present=team_present,
        absents=absents,
        faults_count=faults_count,
        is_galpon=galpon_mode,
    )

    for section, orders, film in (
        (data.estetica, estetica_orders, False),
        (data.pelicula, pelicula_orders, True),
    ):
        section.rows = _build_rows(orders)
        valid_orders = [o for o in orders if o.status not in EXCLUDED_STATUSES]
        section.vehicles_count = len(valid_orders)
        section.total_day = sum(
            (
                (item.unit_price or Decimal("0")) * (item.quantity or 1)
                for o in valid_orders
                for item in o.items
                if _item_counts_in_total(o, item)
            ),
            Decimal("0"),
        )
        section.total_month = await _section_month_revenue(
            db, store_id, galpon_mode, month_start, report_date, film
        )
        if worked_days > 0:
            section.avg_daily = section.total_month / worked_days
            section.projection = section.avg_daily * business_days

    return data


# =============================================================================
# Geração do PDF
# =============================================================================

ORANGE = (232, 138, 0)
DARK = (23, 23, 23)
GRAY = (120, 120, 120)
LIGHT_GRAY = (200, 200, 200)
LINE_GRAY = (225, 225, 225)

MARGIN = 10
PAGE_W = 210  # A4 retrato
CONTENT_W = PAGE_W - 2 * MARGIN

# Colunas da tabela: (título, largura mm, alinhamento) — soma = CONTENT_W (190).
_TABLE_COLS_STORE = [
    ("DEPTO", 13, "L"),
    ("CORT.", 9, "L"),
    ("O.S.", 11, "L"),
    ("CHASSI / PLACA", 22, "L"),
    ("VEÍCULO", 28, "L"),
    ("SERVIÇOS", 36, "L"),
    ("FUNCIONÁRIOS", 20, "L"),
    ("OBSERVAÇÕES", 37, "L"),
    ("VALOR", 14, "R"),
]

# Relatório do galpão: entra a coluna LOJA (loja de destino da O.S.); as demais
# encolhem para manter a soma = 190.
_TABLE_COLS_GALPON = [
    ("DEPTO", 13, "L"),
    ("CORT.", 9, "L"),
    ("O.S.", 11, "L"),
    ("LOJA", 22, "L"),
    ("CHASSI / PLACA", 22, "L"),
    ("VEÍCULO", 25, "L"),
    ("SERVIÇOS", 34, "L"),
    ("FUNCIONÁRIOS", 18, "L"),
    ("OBSERVAÇÕES", 22, "L"),
    ("VALOR", 14, "R"),
]


def _table_cols(is_galpon: bool) -> list[tuple[str, int, str]]:
    return _TABLE_COLS_GALPON if is_galpon else _TABLE_COLS_STORE


# Colunas dos blocos por departamento: SEM a coluna DEPTO (o título do bloco já
# identifica o departamento); os 13 mm liberados vão para Veículo/Serviços/Obs.
_GROUPED_COLS_STORE = [
    ("CORT.", 9, "L"),
    ("O.S.", 11, "L"),
    ("CHASSI / PLACA", 22, "L"),
    ("VEÍCULO", 32, "L"),
    ("SERVIÇOS", 41, "L"),
    ("FUNCIONÁRIOS", 20, "L"),
    ("OBSERVAÇÕES", 41, "L"),
    ("VALOR", 14, "R"),
]

_GROUPED_COLS_GALPON = [
    ("CORT.", 9, "L"),
    ("O.S.", 11, "L"),
    ("LOJA", 22, "L"),
    ("CHASSI / PLACA", 22, "L"),
    ("VEÍCULO", 29, "L"),
    ("SERVIÇOS", 39, "L"),
    ("FUNCIONÁRIOS", 18, "L"),
    ("OBSERVAÇÕES", 26, "L"),
    ("VALOR", 14, "R"),
]


def _grouped_table_cols(is_galpon: bool) -> list[tuple[str, int, str]]:
    return _GROUPED_COLS_GALPON if is_galpon else _GROUPED_COLS_STORE


# Blocos da Estética na ordem pedida pela operação. Cada item:
# (código do departamento, título do bloco, filtro de cortesia | None = ambos).
# "workshop" aparece duas vezes: Oficina Cortesia (is_courtesy=True) e Oficina
# Serviços (is_courtesy=False).
_ESTETICA_GROUPS: list[tuple[str, str, bool | None]] = [
    ("vn", "VN", None),
    ("vu", "VU", None),
    ("vd", "VENDA DIRETA", None),
    ("workshop", "OFICINA CORTESIA", True),
    ("workshop", "OFICINA SERVIÇOS", False),
    ("bodywork", "FUNILARIA", None),
]


# Colunas que NUNCA quebram linha (o que não couber fica oculto) — por título.
SINGLE_LINE_TITLES = {"SERVIÇOS", "OBSERVAÇÕES"}


def _latin1(text: str) -> str:
    """Fontes core do fpdf2 são latin-1; substitui o que não couber."""
    return (text or "").encode("latin-1", "replace").decode("latin-1")


def _brl(value: Decimal | float) -> str:
    formatted = f"{float(value):,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")
    return f"R$ {formatted}"


class _DailySummaryPDF(FPDF):
    def __init__(self, store_name: str, report_date: date_type, is_galpon: bool = False):
        super().__init__(orientation="portrait", format="A4")
        self.store_name = store_name
        self.report_date_str = report_date.strftime("%d/%m/%Y")
        self.is_galpon = is_galpon
        self.set_margins(MARGIN, MARGIN, MARGIN)
        self.set_auto_page_break(auto=True, margin=14)
        self.alias_nb_pages()

    def footer(self) -> None:
        self.set_y(-11)
        self.set_font("helvetica", "", 7)
        self.set_text_color(*GRAY)
        self.cell(CONTENT_W / 2, 5, _latin1(f"{self.store_name} · {self.report_date_str}"))
        self.cell(CONTENT_W / 2, 5, f"Página {self.page_no()} de {{nb}}", align="R")


def _fit_line(pdf: FPDF, text: str, width: float) -> str:
    """Uma linha só: corta o que não couber na coluna (o excedente fica oculto)."""
    text = _latin1(text)
    usable = width - 1.6
    if pdf.get_string_width(text) <= usable:
        return text
    cut = len(text)
    while cut > 0 and pdf.get_string_width(text[:cut]) > usable:
        cut -= 1
    return text[:cut]


def _wrap_text(pdf: FPDF, text: str, width: float) -> list[str]:
    """Quebra texto em linhas que cabem na largura (com padding de célula)."""
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
            # palavra maior que a coluna: corta na marra
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


def _section_label(pdf: _DailySummaryPDF, text: str) -> None:
    pdf.set_font("helvetica", "B", 11)
    pdf.set_text_color(*DARK)
    pdf.cell(0, 7, _latin1(text), new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(*LINE_GRAY)
    pdf.set_line_width(0.3)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())
    pdf.ln(2.5)


def _draw_header(pdf: _DailySummaryPDF, data: DailySummaryData) -> None:
    # Título
    pdf.set_font("helvetica", "B", 17)
    pdf.set_text_color(*DARK)
    title_1 = "Relatório de "
    pdf.cell(pdf.get_string_width(title_1) + 1, 8, _latin1(title_1))
    pdf.set_text_color(*ORANGE)
    pdf.cell(0, 8, _latin1("Serviços"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    # Barra de informações (borda superior laranja)
    bar_y = pdf.get_y()
    bar_h = 13
    pdf.set_draw_color(*ORANGE)
    pdf.set_line_width(0.7)
    pdf.line(MARGIN, bar_y, MARGIN + CONTENT_W, bar_y)
    pdf.set_draw_color(*LINE_GRAY)
    pdf.set_line_width(0.25)
    pdf.rect(MARGIN, bar_y, CONTENT_W, bar_h)

    holidays_txt = ", ".join(data.holidays) if data.holidays else "-"
    fields = [
        ("LOJA", data.store_name, 28),
        ("DATA", data.report_date.strftime("%d/%m/%Y"), 20),
        ("RESPONSÁVEL", data.responsible, 34),
        ("DIAS TRAB.", str(data.worked_days), 16),
        ("DIAS ÚTEIS", str(data.business_days), 16),
        ("FERIADOS", holidays_txt, CONTENT_W - 28 - 20 - 34 - 16 - 16 - 27 - 17),
        ("GERADO EM", data.generated_at.strftime("%d/%m/%Y %H:%M"), 27),
    ]
    x = MARGIN + 3
    for label, value, width in fields:
        pdf.set_xy(x, bar_y + 2)
        pdf.set_font("helvetica", "", 5.5)
        pdf.set_text_color(*GRAY)
        pdf.cell(width, 3.2, _latin1(label))
        pdf.set_xy(x, bar_y + 5.6)
        pdf.set_font("helvetica", "B", 7.5)
        pdf.set_text_color(*DARK)
        value_lines = _wrap_text(pdf, value, width)
        pdf.cell(width, 4.4, value_lines[0])
        x += width + 2
    pdf.set_y(bar_y + bar_h + 2.5)


def _draw_team(pdf: _DailySummaryPDF, data: DailySummaryData) -> None:
    pdf.set_font("helvetica", "", 8)
    present_txt = ", ".join(data.team_present) if data.team_present else "-"
    absents_txt = "; ".join(f"{a.name} ({a.reason})" for a in data.absents) if data.absents else "-"

    box_y = pdf.get_y()
    present_lines = _wrap_text(pdf, present_txt, CONTENT_W - 60)
    absent_lines = _wrap_text(pdf, absents_txt, CONTENT_W - 60)
    line_h = 4.2
    box_h = 4 + (len(present_lines) + len(absent_lines) + 1) * line_h

    pdf.set_draw_color(*ORANGE)
    pdf.set_line_width(0.7)
    pdf.line(MARGIN, box_y, MARGIN + CONTENT_W, box_y)
    pdf.set_draw_color(*LINE_GRAY)
    pdf.set_line_width(0.25)
    pdf.rect(MARGIN, box_y, CONTENT_W, box_h)

    y = box_y + 2
    rows = [
        ("EQUIPE PRESENTE", present_lines),
        ("QTD. FALTAS", [str(data.faults_count)]),
        ("AUSENTES / MOTIVO", absent_lines),
    ]
    for label, lines in rows:
        pdf.set_xy(MARGIN + 3, y)
        pdf.set_font("helvetica", "", 6)
        pdf.set_text_color(*GRAY)
        pdf.cell(52, line_h, _latin1(label))
        pdf.set_font("helvetica", "B", 8)
        pdf.set_text_color(*DARK)
        for line in lines:
            pdf.set_xy(MARGIN + 58, y)
            pdf.cell(CONTENT_W - 60, line_h, line)
            y += line_h
    pdf.set_y(box_y + box_h + 3)


def _draw_cards(pdf: _DailySummaryPDF, section: SectionData) -> None:
    cards = [
        ("VEÍCULOS FEITOS", str(section.vehicles_count)),
        ("TOTAL DO DIA", _brl(section.total_day)),
        ("TOTAL ACUMULADO", _brl(section.total_month)),
        ("MÉDIA DIÁRIA", _brl(section.avg_daily)),
        ("PROJEÇÃO DO MÊS", _brl(section.projection)),
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
        # fonte do valor encolhe até caber no card
        value_txt = _latin1(value)
        size = 10.0
        pdf.set_font("helvetica", "B", size)
        while size > 6 and pdf.get_string_width(value_txt) > card_w - 4:
            size -= 0.5
            pdf.set_font("helvetica", "B", size)
        pdf.set_xy(x + 2, y + 7)
        pdf.set_text_color(*DARK)
        pdf.cell(card_w - 4, 6, value_txt)
        x += card_w + gap
    pdf.set_y(y + card_h + 4)


def _draw_table_header(pdf: _DailySummaryPDF, cols: list[tuple[str, int, str]]) -> None:
    pdf.set_font("helvetica", "", 5.5)
    pdf.set_text_color(*GRAY)
    x = MARGIN
    y = pdf.get_y()
    for title, width, align in cols:
        pdf.set_xy(x, y)
        pdf.cell(width, 4.5, _latin1(title), align=align)
        x += width
    pdf.set_y(y + 4.5)
    pdf.set_draw_color(*LIGHT_GRAY)
    pdf.set_line_width(0.3)
    pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())


def _build_row_cells(
    row: SummaryRow, include_dept: bool, is_galpon: bool
) -> tuple[list[tuple[str, str, tuple[int, int, int]]], bool, bool]:
    """
    Monta as células (texto, estilo, cor) de uma linha na ordem das colunas.
    include_dept controla a coluna DEPTO (presente na tabela única, ausente nos
    blocos por departamento). Retorna também (bold, flagged) da linha.
    """
    flagged = row.flagged_status is not None
    bold = row.is_courtesy and not flagged
    base_style = "B" if bold else ""

    obs = row.observations
    if flagged:
        obs = f"{row.flagged_status} · {obs}" if obs else row.flagged_status

    cells: list[tuple[str, str, tuple[int, int, int]]] = []
    if include_dept:
        cells.append((row.department, base_style, DARK))
    cells.append(
        (
            "Sim" if row.is_courtesy else "Não",
            "B" if row.is_courtesy else "",
            ORANGE if row.is_courtesy else DARK,
        )
    )
    cells.append((row.os_number, base_style, GRAY if not bold else DARK))
    # No galpão, a LOJA (destino) vem logo após a coluna O.S.
    if is_galpon:
        cells.append((row.store_name, base_style, DARK))
    cells.append((row.plate, base_style, DARK))
    cells.append((row.vehicle, base_style, DARK))
    cells.append((row.service, base_style, DARK))
    cells.append((row.workers, base_style, DARK))
    cells.append((obs, base_style, ORANGE if flagged else GRAY))
    cells.append((_brl(row.value), "B", DARK))

    if flagged:
        cells = [(text, style, GRAY if color == DARK else color) for text, style, color in cells]
    return cells, bold, flagged


_ROW_LINE_H = 3.3


def _compute_row_layout(
    pdf: _DailySummaryPDF,
    row: SummaryRow,
    cols: list[tuple[str, int, str]],
    include_dept: bool,
) -> tuple[list[tuple[str, str, tuple[int, int, int]]], list[list[str]], float, float]:
    """
    Calcula o layout de uma linha (células, linhas quebradas por coluna, tamanho
    da fonte e altura). Usado tanto para medir a altura do bloco quanto para
    desenhar — garante que medida e desenho nunca divirjam. SERVIÇOS/OBSERVAÇÕES
    ficam em 1 linha (o excedente é cortado).
    """
    cells, bold, _flagged = _build_row_cells(row, include_dept, pdf.is_galpon)
    font_size = 7.0 if bold else 6.5
    wrapped: list[list[str]] = []
    max_lines = 1
    for (text, style, _), (title, width, _align) in zip(cells, cols, strict=True):
        pdf.set_font("helvetica", style, font_size)
        if title in SINGLE_LINE_TITLES:
            lines = [_fit_line(pdf, str(text), width)]
        else:
            lines = _wrap_text(pdf, str(text), width)
        wrapped.append(lines)
        max_lines = max(max_lines, len(lines))
    row_h = max_lines * _ROW_LINE_H + 1.6
    return cells, wrapped, font_size, row_h


def _draw_data_rows(
    pdf: _DailySummaryPDF,
    rows: list[SummaryRow],
    cols: list[tuple[str, int, str]],
    include_dept: bool,
) -> None:
    """Desenha as linhas de dados de uma tabela; redesenha o cabeçalho ao quebrar página."""
    line_h = _ROW_LINE_H
    for row in rows:
        cells, wrapped, font_size, row_h = _compute_row_layout(pdf, row, cols, include_dept)

        if pdf.get_y() + row_h > pdf.page_break_trigger:
            pdf.add_page()
            _draw_table_header(pdf, cols)

        y = pdf.get_y()
        x = MARGIN
        for (_text, style, color), lines, (_, width, align) in zip(
            cells, wrapped, cols, strict=True
        ):
            pdf.set_font("helvetica", style, font_size)
            pdf.set_text_color(*color)
            for idx, line in enumerate(lines):
                pdf.set_xy(x, y + 0.8 + idx * line_h)
                pdf.cell(width - 1, line_h, line, align=align)
            x += width
        pdf.set_y(y + row_h)
        pdf.set_draw_color(*LINE_GRAY)
        pdf.set_line_width(0.15)
        pdf.line(MARGIN, pdf.get_y(), MARGIN + CONTENT_W, pdf.get_y())


def _draw_table(pdf: _DailySummaryPDF, section: SectionData) -> None:
    pdf.set_font("helvetica", "B", 8)
    pdf.set_text_color(*DARK)
    pdf.cell(0, 5, _latin1("SERVIÇOS DO DIA"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(0.5)
    cols = _table_cols(pdf.is_galpon)
    _draw_table_header(pdf, cols)

    if not section.rows:
        pdf.set_font("helvetica", "I", 8)
        pdf.set_text_color(*GRAY)
        pdf.cell(0, 8, _latin1("Nenhuma O.S. lançada no dia."), new_x="LMARGIN", new_y="NEXT")

    _draw_data_rows(pdf, section.rows, cols, include_dept=True)

    # Total do dia
    pdf.ln(1.5)
    pdf.set_font("helvetica", "", 8)
    pdf.set_text_color(*GRAY)
    total_label_w = CONTENT_W - 30
    pdf.cell(total_label_w, 5, _latin1("Total do Dia"), align="R")
    pdf.set_font("helvetica", "B", 9)
    pdf.set_text_color(*ORANGE)
    pdf.cell(30, 5, _latin1(_brl(section.total_day)), align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)


def _draw_signatures(pdf: _DailySummaryPDF) -> None:
    """
    Linhas de assinatura ao fim de um bloco: Gerente e Encarregado, lado a lado
    e alinhadas à esquerda (comprovam que os carros do departamento foram feitos).
    """
    pdf.ln(4)
    if pdf.get_y() + 8 > pdf.page_break_trigger:
        pdf.add_page()
    line_w = 60
    gap = 12
    y = pdf.get_y()
    x = MARGIN
    pdf.set_draw_color(*DARK)
    pdf.set_line_width(0.3)
    for label in ("Assinatura do Gerente", "Assinatura do Encarregado"):
        pdf.line(x, y, x + line_w, y)
        pdf.set_xy(x, y + 0.6)
        pdf.set_font("helvetica", "", 6)
        pdf.set_text_color(*GRAY)
        pdf.cell(line_w, 3, _latin1(label), align="C")
        x += line_w + gap
    pdf.set_y(y + 4.5)
    pdf.ln(3)


def _department_block_height(
    pdf: _DailySummaryPDF, rows: list[SummaryRow], cols: list[tuple[str, int, str]]
) -> float:
    """
    Altura total estimada do bloco de um departamento (título + cabeçalho +
    linhas + subtotal + assinaturas). Espelha os incrementos de _draw_department_block.
    """
    rows_h = sum(_compute_row_layout(pdf, r, cols, include_dept=False)[3] for r in rows)
    title_h = 5 + 0.5  # cell do título + ln(0.5)
    header_h = 4.5  # _draw_table_header
    subtotal_h = 1.2 + 5  # ln(1.2) + cell
    signatures_h = 4 + 4.5 + 3  # ln(4) + área da linha + ln(3)
    return title_h + header_h + rows_h + subtotal_h + signatures_h


def _draw_department_block(pdf: _DailySummaryPDF, title: str, rows: list[SummaryRow]) -> None:
    """Um bloco de departamento: título, tabela, subtotal e assinaturas (Gerente/Encarregado)."""
    cols = _grouped_table_cols(pdf.is_galpon)

    # Mantém o bloco inteiro junto: se não couber no que resta da página mas
    # couber numa página inteira, começa numa página nova (evita assinatura
    # órfã separada da sua tabela). Blocos maiores que uma página inteira caem
    # no fluxo normal, com quebra linha a linha.
    block_h = _department_block_height(pdf, rows, cols)
    remaining = pdf.page_break_trigger - pdf.get_y()
    full_page = pdf.page_break_trigger - MARGIN
    if remaining < block_h <= full_page:
        pdf.add_page()

    pdf.set_font("helvetica", "B", 9)
    pdf.set_text_color(*DARK)
    pdf.cell(0, 5, _latin1(title), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(0.5)
    _draw_table_header(pdf, cols)
    _draw_data_rows(pdf, rows, cols, include_dept=False)

    # Subtotal do departamento (mesma regra faturável do total do dia)
    subtotal = sum((r.counted_value for r in rows if r.flagged_status is None), Decimal("0"))
    pdf.ln(1.2)
    pdf.set_font("helvetica", "", 7.5)
    pdf.set_text_color(*GRAY)
    pdf.cell(CONTENT_W - 30, 5, _latin1(f"Total {title}"), align="R")
    pdf.set_font("helvetica", "B", 8.5)
    pdf.set_text_color(*ORANGE)
    pdf.cell(30, 5, _latin1(_brl(subtotal)), align="R", new_x="LMARGIN", new_y="NEXT")

    _draw_signatures(pdf)


def _draw_department_blocks(pdf: _DailySummaryPDF, rows: list[SummaryRow]) -> None:
    """
    Desenha a Estética dividida em blocos por departamento na ordem da operação
    (VN, VU, Venda Direta, Oficina Cortesia, Oficina Serviços, Funilaria),
    ocultando os departamentos sem carro no dia. Linhas de departamentos não
    previstos caem num bloco final "OUTROS" (nunca são descartadas em silêncio).
    """
    if not rows:
        pdf.set_font("helvetica", "I", 8)
        pdf.set_text_color(*GRAY)
        pdf.cell(0, 8, _latin1("Nenhuma O.S. lançada no dia."), new_x="LMARGIN", new_y="NEXT")
        return

    used = [False] * len(rows)
    for code, title, courtesy in _ESTETICA_GROUPS:
        group: list[SummaryRow] = []
        for i, r in enumerate(rows):
            if used[i]:
                continue
            if r.dept_code == code and (courtesy is None or r.is_courtesy == courtesy):
                group.append(r)
                used[i] = True
        if group:
            _draw_department_block(pdf, title, group)

    leftover = [r for i, r in enumerate(rows) if not used[i]]
    if leftover:
        _draw_department_block(pdf, "OUTROS", leftover)


def _draw_blank_box(pdf: _DailySummaryPDF, title: str, n_lines: int) -> None:
    line_h = 5.0
    box_h = 6 + n_lines * line_h
    if pdf.get_y() + box_h > pdf.page_break_trigger:
        pdf.add_page()
    y = pdf.get_y()
    pdf.set_draw_color(*ORANGE)
    pdf.set_line_width(0.7)
    pdf.line(MARGIN, y, MARGIN + CONTENT_W, y)
    pdf.set_draw_color(*LINE_GRAY)
    pdf.set_line_width(0.25)
    pdf.rect(MARGIN, y, CONTENT_W, box_h)
    pdf.set_xy(MARGIN + 3, y + 1.5)
    pdf.set_font("helvetica", "B", 8)
    pdf.set_text_color(*DARK)
    pdf.cell(0, 4.5, _latin1(title))
    pdf.set_draw_color(*LINE_GRAY)
    pdf.set_line_width(0.2)
    for i in range(n_lines):
        line_y = y + 6 + (i + 1) * line_h - 1
        pdf.line(MARGIN + 3, line_y, MARGIN + CONTENT_W - 3, line_y)
    pdf.set_y(y + box_h + 3)


def _draw_section(pdf: _DailySummaryPDF, section: SectionData) -> None:
    _section_label(pdf, section.title)
    _draw_cards(pdf, section)
    _draw_table(pdf, section)


def generate_daily_summary_pdf(data: DailySummaryData, film_only: bool = False) -> bytes:
    """
    Gera o PDF do Resumo Diário (A4 retrato).

    Layout padrão (film_only=False): Estética + Fechamento do Dia. A seção de
    Película está OCULTA por enquanto (a pedido da operação).

    film_only=True: relatório apenas de Película/PPF/Pel. Segurança, numa única
    página (sem a seção de Estética) — usado no Resumo Diário do Agendamento
    (carros finalizados no dia). Não afetado pela ocultação acima.
    """
    pdf = _DailySummaryPDF(data.store_name, data.report_date, is_galpon=data.is_galpon)

    if film_only:
        # Página única: cabeçalho + Película + fechamento do dia (sem bloco de equipe)
        pdf.add_page()
        _draw_header(pdf, data)
        _draw_section(pdf, data.pelicula)
        pdf.ln(1)
        _section_label(pdf, "FECHAMENTO DO DIA")
        _draw_blank_box(pdf, "JUSTIFICATIVAS DE CORTESIA", 2)
        _draw_blank_box(pdf, "OBSERVAÇÕES GERAIS", 2)
        _draw_blank_box(pdf, "OCORRÊNCIAS", 2)
        return bytes(pdf.output())

    # Página 1: cabeçalho + Estética (dividida em blocos por departamento).
    # O bloco de equipe (Equipe Presente/Faltas/Ausentes) foi removido do PDF a
    # pedido da operação — os dados ainda são coletados em gather_daily_summary.
    pdf.add_page()
    _draw_header(pdf, data)
    _section_label(pdf, data.estetica.title)
    _draw_cards(pdf, data.estetica)
    _draw_department_blocks(pdf, data.estetica.rows)

    # Seção de Película OCULTA por enquanto (a pedido da operação): o relatório
    # segue apenas com Estética + Fechamento do Dia. Os dados de película ainda
    # são coletados em gather_daily_summary — basta voltar a renderizá-los aqui.

    pdf.ln(1)
    _section_label(pdf, "FECHAMENTO DO DIA")
    _draw_blank_box(pdf, "JUSTIFICATIVAS DE CORTESIA", 2)
    _draw_blank_box(pdf, "OBSERVAÇÕES GERAIS", 2)
    _draw_blank_box(pdf, "OCORRÊNCIAS", 2)

    return bytes(pdf.output())
