import { apiClient } from '@/services/api/client';
import { authService } from '@/services/api/auth.service';

describe('authService.login', () => {
    afterEach(() => jest.restoreAllMocks());

    it('envia credenciais como x-www-form-urlencoded com campo username', async () => {
        const postSpy = jest.spyOn(apiClient, 'post').mockResolvedValue({
            data: {
                access_token: 'acc',
                refresh_token: 'ref',
                expires_in: 1800,
                must_change_password: false,
            },
        } as never);
        const getSpy = jest.spyOn(apiClient, 'get').mockResolvedValue({
            data: {
                id: 1,
                full_name: 'Fulano',
                email: 'fulano@aems.com',
                role: 'owner',
                is_active: true,
                created_at: '2024-01-01',
            },
        } as never);

        const result = await authService.login({
            email: 'fulano@aems.com',
            password: 'segredo123',
        });

        // Verifica endpoint e header form-urlencoded
        expect(postSpy).toHaveBeenCalledWith(
            '/auth/login',
            expect.any(String),
            expect.objectContaining({
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            })
        );
        // Corpo contém username (não email) e password
        const body = postSpy.mock.calls[0][1] as string;
        expect(body).toContain('username=fulano%40aems.com');
        expect(body).toContain('password=segredo123');

        // Busca /auth/me com o token recém-emitido
        expect(getSpy).toHaveBeenCalledWith('/auth/me', {
            headers: { Authorization: 'Bearer acc' },
        });

        // mapUser normaliza a resposta e injeta must_change_password
        expect(result.user.email).toBe('fulano@aems.com');
        expect(result.user.must_change_password).toBe(false);
        expect(result.tokens).toEqual({
            accessToken: 'acc',
            refreshToken: 'ref',
            expiresIn: 1800,
        });
    });
});
