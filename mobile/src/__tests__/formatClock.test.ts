import { formatClock } from '@/utils/formatDate';

describe('formatClock', () => {
    it('formata "HH:MM:SS" do backend (campo time) para "HH:MM"', () => {
        // Regressão: o backend serializa `delivery_time` (time) com segundos.
        // Montar `1970-01-01T14:30:00:00` quebrava (segundos duplicados) → "—".
        expect(formatClock('14:30:00')).toBe('14:30');
    });

    it('aceita "HH:MM" sem segundos', () => {
        expect(formatClock('09:05')).toBe('09:05');
    });

    it('normaliza hora com 1 dígito', () => {
        expect(formatClock('9:05')).toBe('09:05');
    });

    it('retorna "—" para null/undefined/vazio', () => {
        expect(formatClock(null)).toBe('—');
        expect(formatClock(undefined)).toBe('—');
        expect(formatClock('')).toBe('—');
    });

    it('retorna "—" para valor não-horário', () => {
        expect(formatClock('abc')).toBe('—');
    });
});
