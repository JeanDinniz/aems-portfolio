"""Export Excel dos Pedidos de Material.

Uma aba por loja, no formato da planilha original: linha 1 com o nome da loja
(título), linha 2 com o cabeçalho (itens nas linhas, datas dos pedidos nas
colunas); célula = metros (película) ou quantidade (ferramenta).
"""

import re
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from app.modules.material_requests.models import MaterialRequest

_HEADER_FILL = PatternFill("solid", fgColor="1F2937")
_HEADER_FONT = Font(bold=True, color="FFFFFF")
_SECTION_FILL = PatternFill("solid", fgColor="E5E7EB")
_SECTION_FONT = Font(bold=True)
_TITLE_FONT = Font(bold=True, size=14)
_INVALID_SHEET = re.compile(r"[\[\]:*?/\\]")


def _safe_sheet_title(name: str, used: set[str]) -> str:
    title = _INVALID_SHEET.sub(" ", name or "Loja").strip()[:28] or "Loja"
    candidate = title
    i = 2
    while candidate.lower() in used:
        suffix = f" {i}"
        candidate = title[: 28 - len(suffix)] + suffix
        i += 1
    used.add(candidate.lower())
    return candidate


def _film_key(roll) -> str:
    name = roll.film_type.name if roll.film_type else f"Tipo #{roll.film_type_id}"
    return f"{name} {roll.tonality}".strip() if roll.tonality else name


def _build_store_sheet(
    wb: Workbook, store_name: str, requests: list[MaterialRequest], used: set[str]
):
    ws = wb.create_sheet(_safe_sheet_title(store_name, used))

    # Colunas = datas dos pedidos (ordenadas).
    dates = sorted({r.request_date for r in requests})
    date_index = {d: i for i, d in enumerate(dates)}

    # Acumula item -> [valor por data]. Películas em metros, ferramentas em unidades.
    film_rows: dict[str, list[float]] = {}
    tool_rows: dict[str, list[float]] = {}

    def _acc(bucket: dict[str, list[float]], key: str, col: int, value: float) -> None:
        row = bucket.setdefault(key, [0.0] * len(dates))
        row[col] += value

    for req in requests:
        col = date_index[req.request_date]
        for roll in req.film_rolls:
            _acc(film_rows, _film_key(roll), col, float(roll.total_meters or 0))
        for tool in req.tools:
            _acc(tool_rows, tool.name, col, float(tool.quantity or 0))

    # Cabeçalho (datas com ano de 2 dígitos: 23/09/26)
    header = ["Item"] + [d.strftime("%d/%m/%y") for d in dates]

    # Linha 1: título com o nome da loja (mesclado sobre todas as colunas).
    last_col = get_column_letter(len(header))
    ws.merge_cells(f"A1:{last_col}1")
    title_cell = ws.cell(row=1, column=1, value=store_name)
    title_cell.font = _TITLE_FONT
    title_cell.alignment = Alignment(horizontal="left", vertical="center")

    # Linha 2: cabeçalho.
    for c, value in enumerate(header, start=1):
        cell = ws.cell(row=2, column=c, value=value)
        cell.fill = _HEADER_FILL
        cell.font = _HEADER_FONT
        cell.alignment = Alignment(horizontal="center")

    r = 3

    def _section(title: str) -> None:
        nonlocal r
        cell = ws.cell(row=r, column=1, value=title)
        cell.fill = _SECTION_FILL
        cell.font = _SECTION_FONT
        for c in range(2, len(header) + 1):
            ws.cell(row=r, column=c).fill = _SECTION_FILL
        r += 1

    def _emit(bucket: dict[str, list[float]]) -> None:
        nonlocal r
        for key in sorted(bucket):
            ws.cell(row=r, column=1, value=key)
            for col, value in enumerate(bucket[key]):
                if value:
                    # ':g' remove zeros à direita (15.0 -> 15)
                    ws.cell(row=r, column=col + 2, value=float(f"{value:g}"))
            r += 1

    if film_rows:
        _section("Películas (metros)")
        _emit(film_rows)
    if tool_rows:
        _section("Ferramentas / Insumos (unidades)")
        _emit(tool_rows)

    # Larguras
    ws.column_dimensions["A"].width = 32
    for c in range(2, len(header) + 1):
        ws.column_dimensions[get_column_letter(c)].width = 12
    ws.freeze_panes = "B3"


def generate_material_requests_excel(requests: list[MaterialRequest]) -> bytes:
    """Gera o workbook com uma aba por loja. Sem pedidos → aba única vazia."""
    wb = Workbook()
    wb.remove(wb.active)  # remove a aba default

    by_store: dict[int, tuple[str, list[MaterialRequest]]] = {}
    for req in requests:
        store_name = req.store.name if req.store else f"Loja #{req.store_id}"
        by_store.setdefault(req.store_id, (store_name, []))[1].append(req)

    used: set[str] = set()
    for _store_id, (store_name, reqs) in sorted(by_store.items(), key=lambda kv: kv[1][0]):
        _build_store_sheet(wb, store_name, reqs, used)

    if not wb.sheetnames:
        ws = wb.create_sheet("Pedidos")
        ws["A1"] = "Nenhum pedido no período"

    buffer = BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
