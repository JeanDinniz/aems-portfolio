import apiClient from './client';

export interface BrandItem {
    id: number;
    name: string;
    code: string;
    is_active: boolean;
    created_at: string;
    updated_at: string | null;
}

export interface CreateBrandPayload {
    name: string;
    code: string;
}

export interface UpdateBrandPayload {
    name?: string;
    is_active?: boolean;
}

interface BrandListResponse {
    items: BrandItem[];
    pagination: object;
}

const brandsService = {
    list: async (params?: { is_active?: boolean }): Promise<BrandListResponse> =>
        apiClient.get('/brands', { params }).then((r) => r.data),

    getById: async (id: number): Promise<BrandItem> =>
        apiClient.get(`/brands/${id}`).then((r) => r.data),

    create: async (payload: CreateBrandPayload): Promise<BrandItem> =>
        apiClient.post('/brands', payload).then((r) => r.data),

    update: async (id: number, payload: UpdateBrandPayload): Promise<BrandItem> =>
        apiClient.patch(`/brands/${id}`, payload).then((r) => r.data),

    deactivate: async (id: number): Promise<BrandItem> =>
        apiClient.delete(`/brands/${id}`).then((r) => r.data),

    hardDelete: async (id: number): Promise<{ id: number; name: string }> =>
        apiClient.delete(`/brands/${id}/permanent`).then((r) => r.data),
};

export default brandsService;
