import { base64ToUint8Array } from '@/services/face/base64';

/**
 * base64ToUint8Array — decoder puro (sem Buffer/atob). Validamos contra o
 * `Buffer` do Node (referência) para várias entradas, incluindo padding.
 */
describe('base64ToUint8Array', () => {
    const cases = ['', 'A', 'AB', 'ABC', 'hello world', 'AEMS', 'f', 'fo', 'foo', 'foob', 'fooba'];

    it.each(cases)('decodifica "%s" igual ao Buffer do Node', (text) => {
        const b64 = Buffer.from(text, 'utf8').toString('base64');
        const out = base64ToUint8Array(b64);
        const expected = Uint8Array.from(Buffer.from(b64, 'base64'));
        expect(Array.from(out)).toEqual(Array.from(expected));
    });

    it('decodifica bytes binários arbitrários (0..255)', () => {
        const bytes = new Uint8Array(256);
        for (let i = 0; i < 256; i++) bytes[i] = i;
        const b64 = Buffer.from(bytes).toString('base64');
        const out = base64ToUint8Array(b64);
        expect(Array.from(out)).toEqual(Array.from(bytes));
    });

    it('ignora espaços em branco e quebras de linha', () => {
        const b64 = Buffer.from('quebra de linha', 'utf8').toString('base64');
        const withWs = b64.slice(0, 4) + '\n' + b64.slice(4, 8) + ' ' + b64.slice(8);
        expect(Array.from(base64ToUint8Array(withWs))).toEqual(
            Array.from(Uint8Array.from(Buffer.from(b64, 'base64')))
        );
    });
});
