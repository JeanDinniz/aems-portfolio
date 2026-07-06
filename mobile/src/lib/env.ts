import Constants from 'expo-constants';

/**
 * Resolução da URL da API por ambiente, sem hardcode de IP.
 *
 * - Em __DEV__: deriva o host do IP do Metro via `Constants.expoConfig.hostUri`
 *   (formato "192.168.1.7:8081"); usa esse IP para falar com o backend FastAPI
 *   na porta 8000. Assim o app no Expo Go (device físico) alcança o backend
 *   rodando na mesma máquina/rede sem precisar editar IP manualmente.
 * - Em staging/prod: lê de `Constants.expoConfig.extra` (apiUrl/wsUrl/env),
 *   que serão injetados pelo app.config.ts / eas.json no Bloco D.
 */

type AppEnv = 'development' | 'staging' | 'production';

interface Env {
    API_URL: string;
    WS_URL: string;
    ENV: AppEnv;
    /**
     * DSN do Sentry (HARD-02). VAZIO por padrão — o app.config.ts injeta de
     * `process.env.SENTRY_DSN` (EAS secret) quando houver projeto Sentry. Sem
     * DSN, o crash reporting NÃO inicializa (no-op total). Ver `src/lib/sentry.ts`.
     */
    SENTRY_DSN: string;
}

interface ExtraConfig {
    apiUrl?: string;
    wsUrl?: string;
    env?: AppEnv;
    sentryDsn?: string;
}

const DEV_BACKEND_PORT = 8000;

function getMetroHost(): string {
    // hostUri ex.: "192.168.1.7:8081" — pegamos somente o IP/host.
    const hostUri = Constants.expoConfig?.hostUri;
    if (hostUri) {
        const host = hostUri.split(':')[0];
        if (host) return host;
    }
    return 'localhost';
}

function resolveEnv(): Env {
    const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;

    // Override explícito de API_URL (qualquer ambiente, inclusive __DEV__):
    // permite apontar o Expo Go para o HML/prod sem recompilar —
    // ex.: `API_URL=http://192.0.2.10/api/v1 WS_URL=ws://192.0.2.10/ws npx expo start`.
    // Sem override (apiUrl vazio), cai na derivação pelo IP do Metro abaixo.
    if (extra.apiUrl) {
        const apiUrl = extra.apiUrl;
        const wsUrl =
            extra.wsUrl ||
            // Deriva WS_URL de API_URL removendo o sufixo /api/v1 e trocando o protocolo.
            apiUrl.replace(/^http/, 'ws').replace(/\/api\/v1\/?$/, '');
        return {
            API_URL: apiUrl,
            WS_URL: wsUrl,
            ENV: extra.env ?? (__DEV__ ? 'development' : 'production'),
            SENTRY_DSN: extra.sentryDsn ?? '',
        };
    }

    // Desenvolvimento: deriva do IP do Metro.
    const host = getMetroHost();
    return {
        API_URL: `http://${host}:${DEV_BACKEND_PORT}/api/v1`,
        WS_URL: `ws://${host}:${DEV_BACKEND_PORT}`,
        ENV: extra.env ?? 'development',
        SENTRY_DSN: extra.sentryDsn ?? '',
    };
}

export const env: Env = resolveEnv();
