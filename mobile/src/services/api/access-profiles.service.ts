import { apiClient } from './client';
import type {
    AccessProfile,
    AccessProfileCreate,
    AccessProfileUpdate,
    AccessProfileListResponse,
    EffectivePermissions,
} from '@/types/accessProfile.types';

/** Portado de frontend/src/services/api/access-profiles.service.ts. */
export interface AccessProfileFilters {
    is_active?: boolean;
    page?: number;
    limit?: number;
    search?: string;
    store_id?: number;
}

export const accessProfilesService = {
    async list(filters?: AccessProfileFilters): Promise<AccessProfileListResponse> {
        const params = new URLSearchParams();
        if (filters?.is_active !== undefined)
            params.append('is_active', filters.is_active.toString());
        if (filters?.page !== undefined) params.append('page', filters.page.toString());
        if (filters?.limit !== undefined) params.append('limit', filters.limit.toString());
        if (filters?.search) params.append('search', filters.search);
        if (filters?.store_id !== undefined) params.append('store_id', filters.store_id.toString());

        const qs = params.toString();
        const response = await apiClient.get<AccessProfileListResponse>(
            `/access-profiles${qs ? `?${qs}` : ''}`
        );
        return response.data;
    },

    async get(id: string): Promise<AccessProfile> {
        const response = await apiClient.get<AccessProfile>(`/access-profiles/${id}`);
        return response.data;
    },

    async create(data: AccessProfileCreate): Promise<AccessProfile> {
        const response = await apiClient.post<AccessProfile>('/access-profiles', data);
        return response.data;
    },

    async update(id: string, data: AccessProfileUpdate): Promise<AccessProfile> {
        const response = await apiClient.put<AccessProfile>(`/access-profiles/${id}`, data);
        return response.data;
    },

    async remove(id: string): Promise<void> {
        await apiClient.delete(`/access-profiles/${id}`);
    },

    async addUsers(id: string, user_ids: string[]): Promise<void> {
        await apiClient.post(`/access-profiles/${id}/users`, { user_ids });
    },

    async removeUsers(id: string, user_ids: string[]): Promise<void> {
        await apiClient.delete(`/access-profiles/${id}/users`, { data: { user_ids } });
    },

    async getMyPermissions(): Promise<EffectivePermissions> {
        const response = await apiClient.get<EffectivePermissions>('/users/me/permissions');
        return response.data;
    },
};
