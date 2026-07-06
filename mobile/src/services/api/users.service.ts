import { apiClient } from './client';
import type {
    User,
    CreateUserPayload,
    UpdateUserPayload,
    UserFilters,
    UsersListResponse,
} from '@/types/user.types';

/** Portado de frontend/src/services/api/users.service.ts. */
export const usersService = {
    async list(filters?: UserFilters, page = 1, pageSize = 20): Promise<UsersListResponse> {
        const params = new URLSearchParams();
        if (filters?.role) params.append('role', filters.role);
        if (filters?.is_active !== undefined)
            params.append('is_active', filters.is_active.toString());
        if (filters?.store_id) params.append('store_id', filters.store_id.toString());
        if (filters?.search) params.append('search', filters.search);
        params.append('page', page.toString());
        params.append('limit', pageSize.toString());

        const response = await apiClient.get<{ items: User[]; pagination: { total: number } }>(
            `/users?${params.toString()}`
        );
        return {
            users: response.data.items,
            total: response.data.pagination.total,
            page,
            pageSize,
        };
    },

    async getById(id: number): Promise<User> {
        const response = await apiClient.get<User>(`/users/${id}`);
        return response.data;
    },

    async create(payload: CreateUserPayload): Promise<User> {
        const response = await apiClient.post<User>('/users', payload);
        return response.data;
    },

    async update(id: number, payload: UpdateUserPayload): Promise<User> {
        const response = await apiClient.patch<User>(`/users/${id}`, payload);
        return response.data;
    },

    async delete(id: number): Promise<void> {
        await apiClient.delete(`/users/${id}`);
    },

    async activate(id: number): Promise<User> {
        const response = await apiClient.post<User>(`/users/${id}/activate`);
        return response.data;
    },

    async deactivate(id: number): Promise<User> {
        const response = await apiClient.patch<User>(`/users/${id}`, { is_active: false });
        return response.data;
    },

    async resetPassword(id: number): Promise<{ temporary_password: string }> {
        const response = await apiClient.post<{ temporary_password: string }>(
            `/users/${id}/reset-password`
        );
        return response.data;
    },

    async getWorkers(storeId?: number, department?: string): Promise<User[]> {
        const params = new URLSearchParams();
        if (storeId) params.append('store_id', storeId.toString());
        if (department) params.append('department', department);

        const queryString = params.toString();
        const url = queryString ? `/users/workers?${queryString}` : '/users/workers';

        const response = await apiClient.get<User[]>(url);
        return response.data;
    },
};
