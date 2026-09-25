/**
 * Base da API (sem o sufixo /api/v1), normalizada contra mixed content.
 *
 * Se a página está servida em HTTPS mas VITE_API_URL foi buildado como HTTP
 * (build antigo ou env de deploy mal configurada), o browser bloqueia as
 * chamadas XHR/WebSocket como "Mixed Content". Aqui fazemos o upgrade para
 * HTTPS quando a página é HTTPS, garantindo que o front nunca chame a API por
 * HTTP a partir de uma página segura. Em dev (página HTTP em localhost) nada
 * muda.
 */
export function getApiBaseUrl(): string {
    const configured = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';
    if (
        typeof window !== 'undefined' &&
        window.location.protocol === 'https:' &&
        configured.startsWith('http://')
    ) {
        return `https://${configured.slice('http://'.length)}`;
    }
    return configured;
}
