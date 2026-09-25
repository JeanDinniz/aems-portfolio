import { buildMonthGrid, monthRange } from '@/utils/monthCalendar';

describe('buildMonthGrid', () => {
    it('gera 42 células (grid 6x7)', () => {
        expect(buildMonthGrid(2026, 7)).toHaveLength(42); // agosto/2026
    });

    it('agosto/2026 começa numa sexta (offset 5 dias do mês anterior)', () => {
        // 2026-08-01 é sábado (getDay()===6). Primeira célula é o dia 1 do mês? não:
        // firstDay=6 → 6 células do mês anterior antes do dia 1.
        const cells = buildMonthGrid(2026, 7);
        const firstCurrent = cells.findIndex((c) => c.currentMonth);
        expect(firstCurrent).toBe(6);
        expect(cells[6]).toEqual({ day: 1, currentMonth: true, dateStr: '2026-08-01' });
    });

    it('marca dias fora do mês como currentMonth=false', () => {
        const cells = buildMonthGrid(2026, 7);
        expect(cells[0].currentMonth).toBe(false);
        expect(cells[41].currentMonth).toBe(false);
    });

    it('vira o ano em dezembro', () => {
        const cells = buildMonthGrid(2026, 11); // dezembro
        const jan = cells.find((c) => c.dateStr.startsWith('2027-01'));
        expect(jan).toBeDefined();
    });
});

describe('monthRange', () => {
    it('retorna 1º e último dia do mês', () => {
        expect(monthRange(2026, 7)).toEqual({ date_from: '2026-08-01', date_to: '2026-08-31' });
    });

    it('fevereiro de ano não bissexto termina em 28', () => {
        expect(monthRange(2026, 1)).toEqual({ date_from: '2026-02-01', date_to: '2026-02-28' });
    });
});
