/**
 * base64 → Uint8Array — decodificador puro em JS, sem depender de `Buffer` global
 * nem de `atob` (nenhum dos dois é garantido no runtime do RN/Hermes).
 *
 * Usado no pipeline de embedding facial: `expo-file-system` lê o JPEG 112×112 em
 * base64 e este helper converte para os bytes crus que o `jpeg-js` decodifica.
 */

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Tabela reversa char → valor de 6 bits (montada uma vez). */
const B64_LOOKUP: Int16Array = (() => {
    const table = new Int16Array(256).fill(-1);
    for (let i = 0; i < B64_CHARS.length; i++) {
        table[B64_CHARS.charCodeAt(i)] = i;
    }
    return table;
})();

/**
 * Converte uma string base64 (padrão, com ou sem padding `=`) para Uint8Array.
 * Ignora espaços em branco e quebras de linha. Caracteres inválidos são pulados.
 */
export function base64ToUint8Array(input: string): Uint8Array {
    const str = input.replace(/[^A-Za-z0-9+/=]/g, '');
    const len = str.length;

    // Conta o padding para dimensionar o buffer de saída exatamente.
    let padding = 0;
    if (len > 0 && str[len - 1] === '=') padding++;
    if (len > 1 && str[len - 2] === '=') padding++;

    const outLen = Math.floor((len * 3) / 4) - padding;
    const out = new Uint8Array(outLen > 0 ? outLen : 0);

    let outIndex = 0;
    for (let i = 0; i < len; i += 4) {
        const e0 = B64_LOOKUP[str.charCodeAt(i)];
        const e1 = B64_LOOKUP[str.charCodeAt(i + 1)];
        const e2 = B64_LOOKUP[str.charCodeAt(i + 2)];
        const e3 = B64_LOOKUP[str.charCodeAt(i + 3)];

        const chunk = (e0 << 18) | (e1 << 12) | ((e2 & 0x3f) << 6) | (e3 & 0x3f);

        if (outIndex < outLen) out[outIndex++] = (chunk >> 16) & 0xff;
        if (e2 !== -1 && outIndex < outLen) out[outIndex++] = (chunk >> 8) & 0xff;
        if (e3 !== -1 && outIndex < outLen) out[outIndex++] = chunk & 0xff;
    }

    return out;
}
