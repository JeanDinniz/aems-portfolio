import { useAuthStore } from '@/stores/auth.store';
import { resolveMediaUrl } from '@/lib/resolveMediaUrl';

/**
 * Fonte de imagem para MÍDIA PROTEGIDA (`/uploads/*`).
 *
 * Em HML/produção o Nginx fecha `/uploads/` com `auth_request` → `/upload/media-auth`,
 * exigindo `Authorization: Bearer <access>` (ou cookie no web). Uma `<Image>` sem
 * esse header recebe 401 e mostra "Não foi possível carregar a imagem".
 *
 * Este helper resolve o host (via `resolveMediaUrl`) e anexa o header de auth,
 * lido de forma síncrona do `useAuthStore` (o token fica em memória). Serve tanto
 * para `expo-image` quanto para a `Image` do react-native (ambas aceitam
 * `source={{ uri, headers }}`).
 */

export interface MediaSource {
    uri: string;
    headers?: Record<string, string>;
}

/** Header de auth para mídia (ou `undefined` se não houver sessão). */
export function mediaHeaders(): Record<string, string> | undefined {
    const token = useAuthStore.getState().tokens?.accessToken;
    return token ? { Authorization: `Bearer ${token}` } : undefined;
}

/** Fonte `{ uri, headers }` a partir de uma URL de mídia do backend. */
export function mediaSource(url?: string | null): MediaSource | undefined {
    const uri = resolveMediaUrl(url);
    if (!uri) return undefined;
    return { uri, headers: mediaHeaders() };
}

/** Fonte para uma uri JÁ resolvida (ex.: recebida pelo PhotoViewer). */
export function mediaSourceFromUri(uri?: string | null): MediaSource | undefined {
    if (!uri) return undefined;
    return { uri, headers: mediaHeaders() };
}
