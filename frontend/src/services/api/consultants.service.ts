import apiClient from './client';
import type {
    Consultant,
    CreateConsultantPayload,
    UpdateConsultantPayload,
    ConsultantFilters,
    ConsultantsListResponse,
} from '@/types/consultant.types';

export const consultantsService = {
    async list(filters?: ConsultantFilters, page = 1, pageSize = 20): Promise<ConsultantsListResponse> {
        const params = new URLSearchParams();
        if (filters?.store_id) params.append('store_id', filters.store_id.toString());
        if (filters?.dealership_id) params.append('dealership_id', filters.dealership_id.toString());
        if (filters?.is_active !== undefined) params.append('is_active', filters.is_active.toString());
        if (filters?.search) params.append('search', filters.search);
        params.append('page', page.toString());
        params.append('limit', pageSize.toString());

        const response = await apiClient.get<{ items: Consultant[]; pagination: { total: number } }>(`/consultants?${params.toString()}`);
        return {
            consultants: response.data.items,
            total: response.data.pagination.total,
            page,
            pageSize,
        };
    },

    async getById(id: number): Promise<Consultant> {
        const response = await apiClient.get<Consultant>(`/consultants/${id}`);
        return response.data;
    },

    async create(payload: CreateConsultantPayload): Promise<Consultant> {
        const response = await apiClient.post<Consultant>('/consultants', payload);
        return response.data;
    },

    async update(id: number, payload: UpdateConsultantPayload): Promise<Consultant> {
        const response = await apiClient.patch<Consultant>(`/consultants/${id}`, payload);
        return response.data;
    },

    async delete(id: number): Promise<void> {
        await apiClient.delete(`/consultants/${id}`);
    },

    async activate(id: number): Promise<Consultant> {
        const response = await apiClient.patch<Consultant>(`/consultants/${id}`, { is_active: true });
        return response.data;
    },

    async deactivate(id: number): Promise<Consultant> {
        const response = await apiClient.patch<Consultant>(`/consultants/${id}`, { is_active: false });
        return response.data;
    },
};
