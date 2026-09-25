import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(value);
}

/** Formato compacto para eixos de gráfico (ex: "R$10k", "R$1,2mi"). */
export function formatCompactCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        notation: 'compact',
        minimumFractionDigits: 0,
    }).format(value);
}

/** Formata metros de película (ex: 2430 → "2.430m", 2430.5 → "2.430,5m"). */
export function formatMeters(value: number, decimals = 0): string {
    if (!isFinite(value)) return '—';
    return `${value.toLocaleString('pt-BR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    })}m`;
}

/** Formata delta em pontos percentuais (ex: 0.3 → "+0,3pp", -1.2 → "-1,2pp"). */
export function formatPercentPoints(value: number): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toLocaleString('pt-BR', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    })}pp`;
}

/**
 * Converte minutos em texto "Xh Ym" (ex: 75 → "1h 15m", 30 → "30m", 60 → "1h").
 * Usado nos cards de SLA e KPIs de tempo.
 */
export function formatMinutes(minutes: number): string {
    if (!isFinite(minutes) || minutes < 0) return '—';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}
