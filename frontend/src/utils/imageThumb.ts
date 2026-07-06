/**
 * Deriva a URL da miniatura (_thumb.jpg) a partir da URL da foto original.
 *
 * O backend gera o thumbnail no mesmo caminho, com sufixo `_thumb` e extensão
 * `.jpg` (ex.: `.../photos/abc.jpg` → `.../photos/abc_thumb.jpg`; no modo local
 * `.../uploads/photos_abc.jpg` → `.../uploads/photos_abc_thumb.jpg`).
 *
 * Use SEMPRE com `onError` no <img> para cair na URL original: fotos enviadas
 * antes desta feature não têm thumbnail, e a geração é best-effort no servidor.
 */
export function toThumbUrl(url: string): string {
    if (!url) return url;
    return url.replace(/\.[^./?#]+($|[?#])/, '_thumb.jpg$1');
}
