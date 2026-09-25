import { downloadBlob } from './downloadBlob';

/** Deriva um nome de arquivo a partir da URL (sem query/hash); usa `fallback` se vazio. */
function fileNameFromUrl(url: string, fallback: string): string {
    const name = url.split('?')[0].split('#')[0].split('/').pop() || '';
    return name || fallback;
}

/**
 * Baixa um arquivo protegido por auth (cookie httpOnly `aems_media`). Um
 * `<a download>` cross-origin pode não forçar o salvamento, então buscamos o
 * blob com credenciais e disparamos o download. Em caso de falha, abre em nova aba.
 */
export async function downloadAuthedFile(url: string, fallbackName: string): Promise<void> {
    try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        downloadBlob(await res.blob(), fileNameFromUrl(url, fallbackName));
    } catch {
        window.open(url, '_blank');
    }
}
