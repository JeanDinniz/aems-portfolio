import axios from 'axios';
import { useAuthStore } from '@/stores/auth.store';
import { getApiBaseUrl } from '@/lib/apiBase';
import type { User } from '@/types/auth.types';

export function mapUser(userData: Record<string, unknown>, mustChangePassword: boolean): User {
    return {
        id: userData.id as number,
        full_name: userData.full_name as string,
        email: userData.email as string,
        role: userData.role as User['role'],
        is_active: userData.is_active as boolean,
        must_change_password: mustChangePassword,
        store_id: userData.store_id as number | null | undefined,
        supervised_store_ids: (userData.supervised_store_ids as number[] | undefined) || [],
        last_login: userData.last_login as string | null | undefined,
        created_at: userData.created_at as string,
        updated_at: userData.updated_at as string | null | undefined,
    };
}

export const apiClient = axios.create({
    baseURL: `${getApiBaseUrl()}/api/v1`,
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 30000,
});

// Request interceptor - adiciona token
apiClient.interceptors.request.use(
    (config) => {
        // Header explícito tem prioridade: o login busca /auth/me com o token
        // RECÉM-emitido antes do setAuth — sobrescrever com o token do store
        // (sessão anterior) fazia o novo login assumir a identidade antiga.
        if (config.headers.Authorization) return config;
        const { tokens } = useAuthStore.getState();
        if (tokens?.accessToken) {
            config.headers.Authorization = `Bearer ${tokens.accessToken}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Response interceptor - refresh token automático
let isRefreshing = false;
let failedQueue: Array<{
    resolve: (value?: unknown) => void;
    reject: (reason?: unknown) => void;
}> = [];

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

        if (error.response?.status === 401 && !originalRequest._retry) {
            if (isRefreshing) {
                // Enfileirar requisições enquanto refresh acontece
                return new Promise((resolve, reject) => {
                    failedQueue.push({ resolve, reject });
                })
                    .then((token) => {
                        // W2 (auditoria): headers pode vir indefinido em requests
                        // sem headers — garantir o objeto antes de escrever.
                        originalRequest.headers = originalRequest.headers ?? {};
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
                window.location.href = '/login';
                return Promise.reject(error);
            }

            try {
                const refreshResponse = await axios.post(
                    `${apiClient.defaults.baseURL}/auth/refresh`,
                    { refresh_token: tokens.refreshToken }
                );

                // Backend returns: { access_token, refresh_token, expires_in, must_change_password }
                const { access_token, refresh_token, expires_in, must_change_password } = refreshResponse.data;

                // Fetch user data with new token
                const userResponse = await axios.get(
                    `${apiClient.defaults.baseURL}/auth/me`,
                    { headers: { Authorization: `Bearer ${access_token}` } }
                );

                const user = mapUser(userResponse.data, must_change_password);

                const newTokens = {
                    accessToken: access_token,
                    refreshToken: refresh_token,
                    expiresIn: expires_in,
                };

                setAuth(user, newTokens);

                processQueue(null, newTokens.accessToken);

                // W2 (auditoria): garantir headers antes de escrever (ver acima).
                originalRequest.headers = originalRequest.headers ?? {};
                originalRequest.headers.Authorization = `Bearer ${newTokens.accessToken}`;
                return apiClient(originalRequest);
            } catch (refreshError) {
                processQueue(refreshError as Error, null);
                const detail =
                    (refreshError as { response?: { data?: { detail?: string } } })?.response?.data
                        ?.detail ?? '';
                if (detail.includes('Sessão encerrada') || detail.includes('Outro dispositivo')) {
                    sessionStorage.setItem('session_ended_reason', detail);
                }
                clearAuth();
                window.location.href = '/login';
                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        }

        return Promise.reject(error);
    }
);

export default apiClient;
