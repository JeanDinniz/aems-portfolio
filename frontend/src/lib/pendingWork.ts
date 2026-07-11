/**
 * Registro global de "trabalho não salvo" (formulários sujos).
 *
 * Vive fora do React porque o consumidor principal é o auto-update do PWA
 * (setupPWAUpdate, que roda no bootstrap, fora da árvore de componentes).
 * Um formulário crítico registra sua chave enquanto tem dados não salvos; o
 * PWA consulta hasPendingWork() antes de recarregar a página pós-deploy, para
 * não descartar uma O.S. em digitação (fotos são blobs e não sobrevivem ao
 * reload — melhor não recarregar do que tentar restaurar).
 */

const dirtyKeys = new Set<string>();
const listeners = new Set<() => void>();

export function markDirty(key: string): void {
    if (!dirtyKeys.has(key)) {
        dirtyKeys.add(key);
        listeners.forEach((fn) => fn());
    }
}

export function markClean(key: string): void {
    if (dirtyKeys.delete(key)) {
        listeners.forEach((fn) => fn());
    }
}

export function hasPendingWork(): boolean {
    return dirtyKeys.size > 0;
}

/** Assina mudanças; retorna função de cleanup. Usado pelo PWA para recarregar
 *  assim que o último formulário sujo for salvo/fechado. */
export function onPendingWorkChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
