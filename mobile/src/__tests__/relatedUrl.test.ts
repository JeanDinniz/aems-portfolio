/**
 * relatedUrl — parse do `related_url` de notificação → alvo navegável.
 * Puro; sem navegação nem RN.
 */
import { parseRelatedUrl } from '@/utils/relatedUrl';

describe('parseRelatedUrl', () => {
    it('extrai o id da bobina de /estoque?roll=<id>', () => {
        expect(parseRelatedUrl('/estoque?roll=123')).toEqual({ type: 'roll', id: 123 });
    });

    it('ignora outros params e ainda acha o roll', () => {
        expect(parseRelatedUrl('/estoque?tab=x&roll=7&foo=bar')).toEqual({ type: 'roll', id: 7 });
    });

    it('aceita URL absoluta com query', () => {
        expect(parseRelatedUrl('https://app.exemplo/estoque?roll=9')).toEqual({
            type: 'roll',
            id: 9,
        });
    });

    it('retorna null sem query', () => {
        expect(parseRelatedUrl('/estoque')).toBeNull();
    });

    it('retorna null para roll não numérico / não positivo', () => {
        expect(parseRelatedUrl('/estoque?roll=abc')).toBeNull();
        expect(parseRelatedUrl('/estoque?roll=0')).toBeNull();
        expect(parseRelatedUrl('/estoque?roll=-5')).toBeNull();
        expect(parseRelatedUrl('/estoque?roll=1.5')).toBeNull();
        expect(parseRelatedUrl('/estoque?roll=')).toBeNull();
    });

    it('retorna null para query sem o param roll', () => {
        expect(parseRelatedUrl('/agendamento?id=5')).toBeNull();
    });

    it('retorna null para entradas vazias/nulas', () => {
        expect(parseRelatedUrl(undefined)).toBeNull();
        expect(parseRelatedUrl(null)).toBeNull();
        expect(parseRelatedUrl('')).toBeNull();
    });
});
