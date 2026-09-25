import { isCourtesySimpleWash, orderServicesForCourtesy } from '@/utils/serviceOrdering';
import type { ServiceItem } from '@/services/api/services.service';

// Factory mínima de ServiceItem (só os campos que a ordenação usa importam).
function svc(partial: Partial<ServiceItem> & { id: number; name: string }): ServiceItem {
    return {
        description: null,
        department: 'estetica',
        base_price: '0.00',
        has_variable_price: false,
        is_active: true,
        brand_id: 1,
        code: null,
        category: null,
        execution_time_minutes: null,
        ...partial,
    } as ServiceItem;
}

const lavCortesia = svc({
    id: 10,
    name: 'Lavagem Simples',
    code: 'Lav.cortesia',
    is_courtesy_only: true,
});
const lavCompleta = svc({ id: 1, name: 'Lavagem Completa', code: 'LC' });
const enceramento = svc({ id: 2, name: 'Enceramento', code: 'EN' });
const outraCortesia = svc({ id: 3, name: 'Higienização', code: 'HG', is_courtesy_only: true });

describe('isCourtesySimpleWash', () => {
    it('identifica a lavagem simples exclusiva de cortesia', () => {
        expect(isCourtesySimpleWash(lavCortesia)).toBe(true);
    });

    it('não considera lavagem simples que não é exclusiva de cortesia', () => {
        expect(isCourtesySimpleWash(svc({ id: 9, name: 'Lavagem Simples' }))).toBe(false);
    });

    it('não considera outro serviço de cortesia que não seja lavagem simples', () => {
        expect(isCourtesySimpleWash(outraCortesia)).toBe(false);
    });
});

describe('orderServicesForCourtesy', () => {
    it('fora de cortesia devolve a lista inalterada (mesma referência)', () => {
        const list = [lavCompleta, lavCortesia, enceramento];
        expect(orderServicesForCourtesy(list, false)).toBe(list);
    });

    it('em cortesia sobe SOMENTE a lavagem simples de cortesia ao topo', () => {
        const list = [lavCompleta, enceramento, lavCortesia, outraCortesia];
        const ordered = orderServicesForCourtesy(list, true);
        expect(ordered[0]).toBe(lavCortesia);
        // O restante mantém a ordem original (inclui a outra cortesia, que NÃO sobe).
        expect(ordered.slice(1)).toEqual([lavCompleta, enceramento, outraCortesia]);
    });

    it('em cortesia sem a lavagem simples devolve a lista inalterada', () => {
        const list = [lavCompleta, enceramento, outraCortesia];
        expect(orderServicesForCourtesy(list, true)).toBe(list);
    });
});
