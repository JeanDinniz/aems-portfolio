/**
 * Helpers de formatação numérica em pt-BR para o Dashboard (e reuso geral).
 * Usa Intl (disponível no Hermes/RN com `Intl` habilitado no Expo SDK 54).
 */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** "R$ 1.234,56" — `null`/`undefined`/NaN viram "R$ 0,00". */
export function formatCurrencyBRL(value: number | null | undefined): string {
    return BRL.format(Number.isFinite(value as number) ? (value as number) : 0);
}

/** Inteiro com separador de milhar pt-BR. */
export function formatInt(value: number | null | undefined): string {
    return INT.format(Number.isFinite(value as number) ? Math.round(value as number) : 0);
}

/** "12,3%" — uma casa decimal. */
export function formatPercent(value: number | null | undefined, digits = 1): string {
    const n = Number.isFinite(value as number) ? (value as number) : 0;
    return `${n.toFixed(digits).replace('.', ',')}%`;
}

/**
 * Minutos → "Xh Ymin" (ou "Ymin" abaixo de 60). Arredonda para inteiro.
 * `null`/NaN → "—".
 */
export function formatMinutes(value: number | null | undefined): string {
    if (!Number.isFinite(value as number)) return '—';
    const total = Math.round(value as number);
    if (total < 60) return `${total}min`;
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    return mins === 0 ? `${hours}h` : `${hours}h ${mins}min`;
}
