/**
 * relatedUrl — traduz o `related_url` de uma notificação num alvo navegável.
 *
 * O backend passou a enviar `related_url` (REST em `NotificationResponse` e no
 * `data` da push) apontando para o recurso da notificação, ex.:
 *   `"/estoque?roll=123"` → detalhe da bobina 123.
 *
 * Este parse é PURO (sem navegação/React) para ser reusado tanto pelo handler de
 * toque em push (`pushNavigation`) quanto pela lista in-app (`NotificationsScreen`).
 * Fazemos o parse manual da query (sem `URLSearchParams`, cujo polyfill em RN é
 * historicamente instável) — split em `&`/`=` funciona em qualquer runtime.
 */

/** Alvo navegável derivado do `related_url`. Discriminado por `type` p/ extensão futura. */
export type RelatedTarget = { type: 'roll'; id: number };

/**
 * Extrai o alvo de um `related_url`. Retorna `null` quando não há URL, não há
 * query reconhecida, ou o id é inválido (o chamador então cai no fallback).
 *
 * Hoje mapeia apenas `?roll=<id>` (bobina do Estoque). Novos padrões entram aqui.
 */
export function parseRelatedUrl(url: string | null | undefined): RelatedTarget | null {
    if (!url || typeof url !== 'string') return null;

    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) return null;

    const query = url.slice(queryIndex + 1);
    for (const pair of query.split('&')) {
        if (!pair) continue;
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        const key = safeDecode(pair.slice(0, eq));
        const value = safeDecode(pair.slice(eq + 1));

        if (key === 'roll') {
            const id = Number(value);
            if (Number.isInteger(id) && id > 0) return { type: 'roll', id };
        }
    }

    return null;
}

/** `decodeURIComponent` tolerante — devolve o bruto se a sequência for inválida. */
function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
