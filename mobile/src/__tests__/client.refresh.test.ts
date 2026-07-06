import axios, { AxiosError } from 'axios';

import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Testa o response interceptor de 401: refresh único + fila de deduplicação.
 * Usa um adapter custom na instância (sem rede) que devolve 401 na 1ª chamada
 * de cada URL e 200 na repetição; o refresh (`axios` cru) é mockado.
 */
describe('apiClient — refresh token + fila de 401', () => {
    const okUser = {
        id: 1,
        full_name: 'User',
        email: 'u@aems.com',
        role: 'owner',
        is_active: true,
        created_at: '2024-01-01',
    };

    beforeEach(() => {
        useAuthStore.setState({
            user: okUser as never,
            tokens: { accessToken: 'a1', refreshToken: 'r1', expiresIn: 1800 },
            isAuthenticated: true,
            isLoading: false,
            effectivePermissions: null,
        });
        jest.restoreAllMocks();
    });

    function installAdapter() {
        const callsByUrl: Record<string, number> = {};
        apiClient.defaults.adapter = async (config) => {
            const url = config.url ?? '';
            callsByUrl[url] = (callsByUrl[url] ?? 0) + 1;
            const first = callsByUrl[url] === 1;
            const response = {
                data: first ? { detail: 'expired' } : { url, ok: true },
                status: first ? 401 : 200,
                statusText: '',
                headers: {},
                config,
            };
            // Adapter custom precisa rejeitar em não-2xx (axios não aplica validateStatus aqui).
            if (first) {
                throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config as never, null, response as never);
            }
            return response as never;
        };
        return callsByUrl;
    }

    function mockRefresh() {
        const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({
            data: {
                access_token: 'a2',
                refresh_token: 'r2',
                expires_in: 1800,
                must_change_password: false,
            },
        } as never);
        const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({ data: okUser } as never);
        return { postSpy, getSpy };
    }

    it('um 401 dispara um refresh e repete a requisição com o novo token', async () => {
        installAdapter();
        const { postSpy } = mockRefresh();

        const res = await apiClient.get('/protected');

        expect(res.data).toEqual({ url: '/protected', ok: true });
        // refresh chamado exatamente uma vez
        expect(postSpy).toHaveBeenCalledTimes(1);
        expect(postSpy).toHaveBeenCalledWith(
            expect.stringContaining('/auth/refresh'),
            { refresh_token: 'r1' }
        );
        // novos tokens persistidos no store
        expect(useAuthStore.getState().tokens?.accessToken).toBe('a2');
    });

    it('requisições concorrentes em 401 disparam um ÚNICO refresh (fila)', async () => {
        installAdapter();
        const { postSpy } = mockRefresh();

        const [r1, r2] = await Promise.all([
            apiClient.get('/p1'),
            apiClient.get('/p2'),
        ]);

        expect(r1.data).toEqual({ url: '/p1', ok: true });
        expect(r2.data).toEqual({ url: '/p2', ok: true });
        expect(postSpy).toHaveBeenCalledTimes(1);
    });

    it('refresh inválido limpa a sessão (clearAuth)', async () => {
        installAdapter();
        jest.spyOn(axios, 'post').mockRejectedValue({
            response: { data: { detail: 'Sessão encerrada' } },
        });

        await expect(apiClient.get('/protected')).rejects.toBeDefined();
        expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
});
