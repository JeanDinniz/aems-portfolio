import { env } from './env';

/**
 * Normaliza URLs de mídia (fotos) vindas do backend para algo CARREGÁVEL no
 * device físico.
 *
 * O backend (dev) devolve URLs absolutas com host local — ex.:
 * `http://localhost:8000/uploads/...` (filesystem) ou `http://localhost:9000/...`
 * (MinIO). No celular, `localhost`/`127.0.0.1` é o PRÓPRIO aparelho, então a
 * imagem não carrega ("Não foi possível carregar a imagem"). Aqui trocamos o
 * host local pelo host da API configurada (IP da LAN, derivado do Metro em dev),
 * **preservando porta e caminho**. URLs relativas ganham a origem da API. URLs
 * com host real (produção/CDN, ex.: https://aems.example.com/...) passam
 * intactas.
 *
 * ⚠️ Usar SOMENTE na exibição. Nunca no que é enviado/persistido no backend — o
 * que vai no payload da O.S. deve ser a URL crua do upload (igual ao web).
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

/** Host (IP/domínio) da API — ex.: `192.168.1.7` em dev. */
function apiHost(): string {
    const m = env.API_URL.match(/^https?:\/\/([^/:]+)/);
    return m?.[1] ?? '';
}

/** Origem da API (scheme+host+porta), sem o sufixo `/api/v1`. */
function apiOrigin(): string {
    const m = env.API_URL.match(/^(https?:\/\/[^/]+)/);
    return m?.[1] ?? '';
}

export function resolveMediaUrl(url?: string | null): string {
    if (!url) return '';
    const trimmed = url.trim();
    if (!trimmed) return '';

    // Relativa (ex.: "/uploads/...") → prefixa com a origem da API.
    if (trimmed.startsWith('/')) {
        return `${apiOrigin()}${trimmed}`;
    }

    // Absoluta: se o host for local, troca pelo host da API (preserva porta/caminho).
    const match = trimmed.match(/^(https?:\/\/)([^/:]+)(:\d+)?(\/.*)?$/);
    if (match) {
        const scheme = match[1];
        const host = match[2];
        const port = match[3] ?? '';
        const rest = match[4] ?? '';
        if (LOCAL_HOSTS.has(host.toLowerCase())) {
            const target = apiHost();
            if (target) return `${scheme}${target}${port}${rest}`;
        }
    }

    return trimmed;
}
