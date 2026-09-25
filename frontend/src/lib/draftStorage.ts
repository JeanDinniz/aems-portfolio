/**
 * Persistência de RASCUNHO (draft) de formulário via localStorage — versão web
 * do padrão já usado no mobile (`mobile/src/services/draft/osDraftStorage.ts`).
 *
 * Funções puras, com try/catch silencioso: localStorage pode lançar em modo
 * privado/quota excedida — nesse caso o rascunho simplesmente não persiste,
 * sem quebrar o formulário. Nunca guarde mídia (foto/vídeo) aqui — só campos
 * de texto/seleção serializáveis em JSON.
 *
 * As chaves recebidas já vêm namespaced pelo chamador (`aems-draft:<form>`).
 */

/** Carrega o rascunho salvo em `key`, ou `null` se ausente/corrompido. */
export function loadDraft<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

/** Grava (substitui) o rascunho em `key`. Falha silenciosamente. */
export function saveDraft<T>(key: string, value: T): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // localStorage indisponível (modo privado) ou quota excedida — ignora.
    }
}

/** Apaga o rascunho em `key`. Falha silenciosamente. */
export function clearDraft(key: string): void {
    try {
        localStorage.removeItem(key);
    } catch {
        // idem — ignora.
    }
}
