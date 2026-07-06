import { apiClient } from './client';

/** Portado de frontend/src/services/api/brands.service.ts (leitura para pickers). */

export interface BrandItem {
    id: number;
    name: string;
    code: string;
    is_active: boolean;
    created_at: string;
    updated_at: string | null;
}

interface BrandListResponse {
    items: BrandItem[];
    pagination: object;
}

export const brandsService = {
    list: async (params?: { is_active?: boolean }): Promise<BrandListResponse> =>
        apiClient.get('/brands', { params }).then((r) => r.data),

    getById: async (id: number): Promise<BrandItem> =>
        apiClient.get(`/brands/${id}`).then((r) => r.data),

    /** Soft delete no backend (DELETE /brands/{id}) → marca is_active=false. */
    deactivate: async (id: number): Promise<BrandItem> =>
        apiClient.delete(`/brands/${id}`).then((r) => r.data),

    /** Reativa via PATCH /brands/{id} { is_active: true } (Owner only no backend). */
    activate: async (id: number): Promise<BrandItem> =>
        apiClient.patch(`/brands/${id}`, { is_active: true }).then((r) => r.data),
};

export default brandsService;
