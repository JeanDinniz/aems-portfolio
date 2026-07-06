import apiClient from './client';

export interface Store {
    id: number;
    name: string;
    code: string;
    city: string;
    state: string;
    address?: string;
    phone?: string;
    is_active: boolean;
    is_galpon_store: boolean;
    has_shared_inventory: boolean;
    linked_inventory_store_ids: number[];
    store_type: 'dealership';
    dealership_id?: number | null;
    dealership_brand?: string | null;
    brand_id?: number;
    brand?: { id: number; name: string; code: string } | null;
}

export interface CreateStorePayload {
    name: string;
    code: string;
    brand_id: number;
    address?: string | null;
    phone?: string | null;
}

export interface UpdateStorePayload {
    name?: string;
    is_active?: boolean;
    is_galpon_store?: boolean;
    has_shared_inventory?: boolean;
    linked_inventory_store_ids?: number[];
    city?: string;
    state?: string;
    address?: string;
    phone?: string;
}

export const storesService = {
    async list(): Promise<Store[]> {
        const response = await apiClient.get<{ items: Store[] }>('/stores');
        return response.data.items || [];
    },

    async getById(id: number): Promise<Store> {
        const response = await apiClient.get<Store>(`/stores/${id}`);
        return response.data;
    },

    async create(data: CreateStorePayload): Promise<Store> {
        const response = await apiClient.post<Store>('/stores', data);
        return response.data;
    },

    async update(id: number, data: UpdateStorePayload): Promise<Store> {
        const response = await apiClient.patch<Store>(`/stores/${id}`, data);
        return response.data;
    },

    async delete(id: number): Promise<Store> {
        const response = await apiClient.delete<Store>(`/stores/${id}`);
        return response.data;
    },
};
