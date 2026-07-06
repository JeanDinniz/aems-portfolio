import { apiClient, mapUser } from './client';
import type { LoginCredentials, LoginResponse, User } from '@/types/auth.types';

/**
 * Auth service (DATA-05) — portado de frontend/src/services/api/auth.service.ts.
 * ⚠️ `/auth/login` usa application/x-www-form-urlencoded (OAuth2 `username`).
 */
export const authService = {
    async login(credentials: LoginCredentials): Promise<LoginResponse> {
        const formData = new URLSearchParams();
        formData.append('username', credentials.email);
        formData.append('password', credentials.password);

        const loginResponse = await apiClient.post('/auth/login', formData.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        // Backend: { access_token, refresh_token, expires_in, must_change_password }
        const { access_token, refresh_token, expires_in, must_change_password } =
            loginResponse.data;

        // Busca os dados do usuário com o novo token (sem mutar defaults do client).
        const userResponse = await apiClient.get('/auth/me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        return {
            user: mapUser(userResponse.data, must_change_password),
            tokens: {
                accessToken: access_token,
                refreshToken: refresh_token,
                expiresIn: expires_in,
            },
            must_change_password,
        };
    },

    async logout(): Promise<void> {
        await apiClient.post('/auth/logout');
    },

    async getCurrentUser(): Promise<User> {
        const response = await apiClient.get('/auth/me');
        return response.data;
    },

    async forgotPassword(email: string): Promise<void> {
        await apiClient.post('/auth/forgot-password', { email });
    },

    async resetPassword(token: string, newPassword: string): Promise<void> {
        await apiClient.post('/auth/reset-password', { token, password: newPassword });
    },

    async updateProfile(data: Partial<User>): Promise<User> {
        const response = await apiClient.patch('/auth/profile', data);
        return response.data;
    },

    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
        await apiClient.post('/auth/change-password', {
            current_password: currentPassword,
            new_password: newPassword,
        });
    },
};
