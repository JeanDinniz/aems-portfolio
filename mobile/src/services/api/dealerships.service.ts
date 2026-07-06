import { apiClient } from './client';

import type { Dealership, DealershipFilters } from '@/types/dealership.types';

/**
 * Concessionárias (Admin — Fatia 5b). Leitura + ativar/desativar (soft delete).
 * Molde dos demais services de catálogo. Gate de exibição/ação é por `isOwner()`
 * na tela (não há submódulo de permissão `dealerships`); a autorização real é do
 * backend (PATCH/DELETE exigem Owner).
 */

interface DealershipListResponse {
    items: Dealership[];
    total: number;
}

export const dealershipsService = {
    list: async (filters?: DealershipFilters): Promise<DealershipListResponse> => {
        const params: Record<string, string | number | boolean> = { page: 1, limit: 200 };
        if (filters?.store_id !== undefined) params.store_id = filters.store_id;
        if (filters?.is_active !== undefined) params.is_active = filters.is_active;
        const response = await apiClient.get('/dealerships', { params });
        return {
            items: response.data.items ?? [],
            total: response.data.total ?? response.data.pagination?.total ?? 0,
        };
    },

    getById: async (id: number): Promise<Dealership> =>
        apiClient.get(`/dealerships/${id}`).then((r) => r.data),

    /** Soft delete (DELETE /dealerships/{id}) → is_active=false (Owner only). */
    deactivate: async (id: number): Promise<Dealership> =>
        apiClient.delete(`/dealerships/${id}`).then((r) => r.data),

    /** Reativa via PATCH /dealerships/{id} { is_active: true }. */
    activate: async (id: number): Promise<Dealership> =>
        apiClient.patch(`/dealerships/${id}`, { is_active: true }).then((r) => r.data),
};

export default dealershipsService;
