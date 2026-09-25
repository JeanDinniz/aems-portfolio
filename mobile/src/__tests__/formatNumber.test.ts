import {
    formatCurrencyBRL,
    formatDecimalBRL,
    formatInt,
    formatPercent,
    formatMinutes,
} from '@/utils/formatNumber';

/**
 * Dashboard 3a — helpers de formatação numérica em pt-BR.
 * Cobre os 4 formatters: moeda, inteiro, percentual e minutos → "Xh Ymin".
 *
 * NBSP gotcha: o Intl pt-BR usa espaço NÃO-quebrável entre "R$" e o número, então
 * comparamos por substring (toContain) em vez de string exata na moeda.
 */
describe('formatCurrencyBRL', () => {
    it('formata valor positivo como R$ com separadores pt-BR', () => {
        const out = formatCurrencyBRL(1234.56);
        expect(out).toContain('R$');
        expect(out).toContain('1.234,56');
    });

    it('null/undefined/NaN viram R$ 0,00', () => {
        expect(formatCurrencyBRL(null)).toContain('0,00');
        expect(formatCurrencyBRL(undefined)).toContain('0,00');
        expect(formatCurrencyBRL(NaN)).toContain('0,00');
    });
});

describe('formatDecimalBRL', () => {
    it('formata a STRING do Decimal do backend como R$ pt-BR', () => {
        // O backend (Pydantic v2) manda Decimal como string, ex.: "150.00".
        const out = formatDecimalBRL('150.00');
        expect(out).toContain('R$');
        expect(out).toContain('150,00');
    });

    it('formata número também', () => {
        expect(formatDecimalBRL(1234.5)).toContain('1.234,50');
    });

    it('null/undefined/vazio/NaN → "—"', () => {
        expect(formatDecimalBRL(null)).toBe('—');
        expect(formatDecimalBRL(undefined)).toBe('—');
        expect(formatDecimalBRL('')).toBe('—');
        expect(formatDecimalBRL('abc')).toBe('—');
    });
});

describe('formatInt', () => {
    it('arredonda e aplica separador de milhar', () => {
        expect(formatInt(1234)).toBe('1.234');
        expect(formatInt(1234.7)).toBe('1.235');
    });

    it('null/undefined/NaN → "0"', () => {
        expect(formatInt(null)).toBe('0');
        expect(formatInt(undefined)).toBe('0');
        expect(formatInt(NaN)).toBe('0');
    });
});

describe('formatPercent', () => {
    it('uma casa decimal com vírgula e sufixo %', () => {
        expect(formatPercent(12.34)).toBe('12,3%');
        expect(formatPercent(0)).toBe('0,0%');
    });

    it('respeita o número de dígitos informado', () => {
        expect(formatPercent(12.345, 2)).toBe('12,35%');
    });

    it('null/undefined/NaN → "0,0%"', () => {
        expect(formatPercent(null)).toBe('0,0%');
        expect(formatPercent(undefined)).toBe('0,0%');
        expect(formatPercent(NaN)).toBe('0,0%');
    });
});

describe('formatMinutes', () => {
    it('abaixo de 60 → "Ymin"', () => {
        expect(formatMinutes(45)).toBe('45min');
        expect(formatMinutes(0)).toBe('0min');
    });

    it('hora exata → "Xh"', () => {
        expect(formatMinutes(120)).toBe('2h');
    });

    it('hora + minutos → "Xh Ymin"', () => {
        expect(formatMinutes(125)).toBe('2h 5min');
        expect(formatMinutes(90)).toBe('1h 30min');
    });

    it('arredonda para inteiro', () => {
        expect(formatMinutes(59.6)).toBe('1h');
    });

    it('null/undefined/NaN → "—"', () => {
        expect(formatMinutes(null)).toBe('—');
        expect(formatMinutes(undefined)).toBe('—');
        expect(formatMinutes(NaN)).toBe('—');
    });
});
