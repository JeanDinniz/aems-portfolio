/** Uma célula do grid mensal do calendário. `dateStr` no formato YYYY-MM-DD. */
export type MonthCell = { day: number; currentMonth: boolean; dateStr: string };

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

function toDateString(year: number, month: number, day: number): string {
    // `month` 0-indexed → +1 para exibição.
    return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/**
 * Constrói o grid 6×7 (42 células) do mês (`month` 0-indexed). Preenche o início
 * com os últimos dias do mês anterior e o fim com os primeiros do mês seguinte,
 * marcando `currentMonth` para diferenciar. Espelha a lógica do web
 * (CalendarMonthView.tsx). NÃO usa Date.now() — puro e determinístico.
 */
export function buildMonthGrid(year: number, month: number): MonthCell[] {
    const firstDay = new Date(year, month, 1).getDay(); // 0=Dom
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const cells: MonthCell[] = [];

    for (let i = firstDay - 1; i >= 0; i--) {
        const d = daysInPrevMonth - i;
        const prevMonth = month === 0 ? 11 : month - 1;
        const prevYear = month === 0 ? year - 1 : year;
        cells.push({ day: d, currentMonth: false, dateStr: toDateString(prevYear, prevMonth, d) });
    }
    for (let d = 1; d <= daysInMonth; d++) {
        cells.push({ day: d, currentMonth: true, dateStr: toDateString(year, month, d) });
    }
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
        const nextMonth = month === 11 ? 0 : month + 1;
        const nextYear = month === 11 ? year + 1 : year;
        cells.push({ day: d, currentMonth: false, dateStr: toDateString(nextYear, nextMonth, d) });
    }
    return cells;
}

/** Primeiro e último dia do mês (`month` 0-indexed) em YYYY-MM-DD. */
export function monthRange(year: number, month: number): { date_from: string; date_to: string } {
    const last = new Date(year, month + 1, 0).getDate();
    return {
        date_from: toDateString(year, month, 1),
        date_to: toDateString(year, month, last),
    };
}
