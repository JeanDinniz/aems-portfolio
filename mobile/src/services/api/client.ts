import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';

import { env } from '@/lib/env';
import { useAuthStore } from '@/stores/auth.store';
import { addBreadcrumb } from '@/lib/sentry';
import type { User } from '@/types/auth.types';

/**
 * apiClient (DATA-03) — portado de frontend/src/services/api/client.ts.
 *
 * Camadas: UI → hooks → services → apiClient → SecureStore.
 * - baseURL via `env.API_URL` (IP do Metro em dev; extra em prod).
 * - Request interceptor lê o access token da MEMÓRIA do store (que reflete o
 *   SecureStore) — NUNCA window/localStorage.
 * - Response 401: refresh único com fila de deduplicação. Em falha, dispara
 *   `clearAuth()` (o RootNavigator reage ao estado) — sem `window.location`.
 */

/** Helper puro reaproveitado do web — mapeia o payload de usuário do backend. */
export function mapUser(userData: Record<string, unknown>, mustChangePassword: boolean): User {
    return {
        id: userData.id as number,
        full_name: userData.full_name as string,
        email: userData.email as string,
        role: userData.role as User['role'],
        is_active: userData.is_active as boolean,
        must_change_password: mustChangePassword,
        store_id: userData.store_id as number | null | undefined,
        store_name: userData.store_name as string | null | undefined,
        supervised_store_ids: (userData.supervised_store_ids as number[] | undefined) || [],
        phone: userData.phone as string | null | undefined,
        last_login: userData.last_login as string | null | undefined,
        created_at: userData.created_at as string,
        updated_at: userData.updated_at as string | null | undefined,
    };
}

/**
 * Notificação de "sessão encerrada / login em outro aparelho".
 * A camada de UI (App/RootNavigator) registra um handler para exibir um Alert.
 */
type SessionEndedHandler = (reason: string) => void;
let sessionEndedHandler: SessionEndedHandler | null = null;
export function setSessionEndedHandler(handler: SessionEndedHandler | null): void {
    sessionEndedHandler = handler;
}

/**
 * Origin enviado em toda requisição. O `CSRFProtectionMiddleware` do backend
 * valida Origin/Referer em métodos mutantes (POST/PUT/PATCH/DELETE) e, em
 * produção (DEBUG=false), BLOQUEIA com 403 quando o header está ausente.
 * Um app React Native não é um browser e não envia `Origin` automaticamente,
 * então o definimos explicitamente como a origin da própria API (que está na
 * ALLOWED_ORIGINS do backend). Derivado removendo o sufixo `/api/v1` da base.
 */
const API_ORIGIN = env.API_URL.replace(/\/api\/v1\/?$/, '');

const apiClient = axios.create({
    baseURL: env.API_URL,
    headers: {
        'Content-Type': 'application/json',
        Origin: API_ORIGIN,
    },
    timeout: 30000, // upload de fotos usa 120s por request (ver upload service)
});

/**
 * Caminho seguro para breadcrumbs: remove a query string (pode carregar tokens
 * assinados) e o método. NUNCA logamos o header Authorization nem o body.
 */
function safePath(config?: { method?: string; url?: string }): {
    method: string;
    path: string;
} {
    const method = (config?.method ?? 'GET').toUpperCase();
    const path = (config?.url ?? '').split('?')[0];
    return { method, path };
}

// Request interceptor — injeta o access token a partir do store em memória.
apiClient.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
        const { tokens } = useAuthStore.getState();
        if (tokens?.accessToken) {
            config.headers.Authorization = `Bearer ${tokens.accessToken}`;
        }
        // Breadcrumb de API SEM credenciais: só método + caminho (sem query).
        const { method, path } = safePath(config);
        addBreadcrumb('api', `${method} ${path}`);
        return config;
    },
    (error) => Promise.reject(error)
);

// Response interceptor — refresh token automático com fila de deduplicação.
interface QueueItem {
    resolve: (value?: unknown) => void;
    reject: (reason?: unknown) => void;
}

let isRefreshing = false;
let failedQueue: QueueItem[] = [];

const processQueue = (error: Error | null, token: string | null = null) => {
    failedQueue.forEach((prom) => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve(token);
        }
    });
    failedQueue = [];
};

apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        // Breadcrumb de erro de API SEM corpo/credenciais: método, caminho, status.
        const { method, path } = safePath(originalRequest);
        addBreadcrumb('api', `error ${method} ${path}`, {
            status: error.response?.status,
        });

        if (error.response?.status === 401 && !originalRequest._retry) {
            if (isRefreshing) {
                // Enfileira requisições concorrentes enquanto o refresh acontece.
                return new Promise((resolve, reject) => {
                    failedQueue.push({ resolve, reject });
                })
                    .then((token) => {
                        originalRequest.headers.Authorization = `Bearer ${token}`;
                        return apiClient(originalRequest);
                    })
                    .catch((err) => Promise.reject(err));
            }

            originalRequest._retry = true;
            isRefreshing = true;

            const { tokens, setAuth, clearAuth } = useAuthStore.getState();

            if (!tokens?.refreshToken) {
                clearAuth();
                isRefreshing = false;
                return Promise.reject(error);
            }

            try {
                // axios "cru" para não recursar nos interceptors.
                const refreshResponse = await axios.post(
                    `${apiClient.defaults.baseURL}/auth/refresh`,
                    { refresh_token: tokens.refreshToken }
                );

                const { access_token, refresh_token, expires_in, must_change_password } =
                    refreshResponse.data;

                // Busca dados do usuário com o novo token.
                const userResponse = await axios.get(`${apiClient.defaults.baseURL}/auth/me`, {
                    headers: { Authorization: `Bearer ${access_token}` },
                });

                const user = mapUser(userResponse.data, must_change_password);

                const newTokens = {
                    accessToken: access_token,
                    refreshToken: refresh_token,
                    expiresIn: expires_in,
                };

                setAuth(user, newTokens);
                processQueue(null, newTokens.accessToken);

                originalRequest.headers.Authorization = `Bearer ${newTokens.accessToken}`;
                return apiClient(originalRequest);
            } catch (refreshError) {
                processQueue(refreshError as Error, null);
                const detail =
                    (refreshError as { response?: { data?: { detail?: string } } })?.response?.data
                        ?.detail ?? '';
                if (detail.includes('Sessão encerrada') || detail.includes('Outro dispositivo')) {
                    sessionEndedHandler?.(detail);
                }
                clearAuth();
                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        }

        return Promise.reject(error);
    }
);

export { apiClient };
export default apiClient;
