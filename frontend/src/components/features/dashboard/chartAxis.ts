export type ChartGranularity = 'day' | 'week' | 'month';

/**
 * Formata o rótulo de data do eixo X dos gráficos de série temporal para o
 * padrão brasileiro, conforme a granularidade selecionada. O backend entrega:
 *   day   → "YYYY-MM-DD" (ex: 2026-07-01) → "01-07-2026"
 *   month → "YYYY-MM"    (ex: 2026-07)    → "07-2026"
 *   week  → "IYYY-IW"    (ex: 2026-27)    → "S27/2026" (ano + semana ISO)
 *
 * Se a string não bater o formato esperado, devolve o valor cru (fallback seguro).
 */
export function formatDateTick(value: string, granularity: ChartGranularity): string {
  const parts = value.split('-');

  if (granularity === 'day' && parts.length === 3) {
    const [y, m, d] = parts;
    return `${d}-${m}-${y}`;
  }
  if (granularity === 'month' && parts.length === 2) {
    const [y, m] = parts;
    return `${m}-${y}`;
  }
  if (granularity === 'week' && parts.length === 2) {
    const [y, w] = parts;
    return `S${w}/${y}`;
  }

  return value;
}
