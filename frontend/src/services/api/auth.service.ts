import apiClient, { mapUser } from './client';
import type { LoginCredentials, LoginResponse, User } from '@/types/auth.types';

export const authService = {
    async login(credentials: LoginCredentials): Promise<LoginResponse> {
        // Backend expects x-www-form-urlencoded with 'username' field (OAuth2 standard)
        const formData = new URLSearchParams();
        formData.append('username', credentials.email);
        formData.append('password', credentials.password);

        const loginResponse = await apiClient.post('/auth/login', formData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        // Backend returns: { access_token, refresh_token, expires_in, must_change_password }
        // We need to fetch user data separately
        const { access_token, refresh_token, expires_in, must_change_password } = loginResponse.data;

        // Fetch user data using the new token directly in the request header
        // (avoids mutating apiClient.defaults which persists even on login failure)
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
            must_change_password: must_change_password,
        };
    },

    async logout(): Promise<void> {
        await apiClient.post('/auth/logout');
    },

    async refreshToken(refreshToken: string): Promise<LoginResponse> {
        const response = await apiClient.post('/auth/refresh', { refresh_token: refreshToken });
        return response.data;
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
