import apiClient from './client';
import type {
    Supplier,
    SupplierCreate,
    SupplierUpdate,
    SupplierFilters,
    SuppliersListResponse,
} from '@/types/supplier';

export const suppliersService = {
    async list(filters?: SupplierFilters): Promise<SuppliersListResponse> {
        const params = new URLSearchParams();
        if (filters?.search) params.append('search', filters.search);
        if (filters?.is_active !== undefined) params.append('is_active', filters.is_active.toString());
        params.append('page', (filters?.page ?? 1).toString());
        params.append('limit', (filters?.limit ?? 20).toString());

        const response = await apiClient.get<SuppliersListResponse>(`/suppliers?${params.toString()}`);
        return response.data;
    },

    async getById(id: number): Promise<Supplier> {
        const response = await apiClient.get<Supplier>(`/suppliers/${id}`);
        return response.data;
    },

    async create(payload: SupplierCreate): Promise<Supplier> {
        const response = await apiClient.post<Supplier>('/suppliers', payload);
        return response.data;
    },

    async update(id: number, payload: SupplierUpdate): Promise<Supplier> {
        const response = await apiClient.patch<Supplier>(`/suppliers/${id}`, payload);
        return response.data;
    },

    async delete(id: number): Promise<void> {
        await apiClient.delete(`/suppliers/${id}`);
    },

    async deactivate(id: number): Promise<Supplier> {
        const response = await apiClient.patch<Supplier>(`/suppliers/${id}`, { is_active: false });
        return response.data;
    },

    async activate(id: number): Promise<Supplier> {
        const response = await apiClient.patch<Supplier>(`/suppliers/${id}`, { is_active: true });
        return response.data;
    },
};
