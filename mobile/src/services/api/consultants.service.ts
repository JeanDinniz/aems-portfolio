import { apiClient } from './client';
import type {
    Consultant,
    ConsultantFilters,
    ConsultantsListResponse,
} from '@/types/consultant.types';

/** Portado de frontend/src/services/api/consultants.service.ts (leitura para pickers). */
export const consultantsService = {
    async list(
        filters?: ConsultantFilters,
        page = 1,
        pageSize = 20
    ): Promise<ConsultantsListResponse> {
        const params = new URLSearchParams();
        if (filters?.store_id) params.append('store_id', filters.store_id.toString());
        if (filters?.dealership_id)
            params.append('dealership_id', filters.dealership_id.toString());
        if (filters?.is_active !== undefined)
            params.append('is_active', filters.is_active.toString());
        if (filters?.search) params.append('search', filters.search);
        params.append('page', page.toString());
        params.append('limit', pageSize.toString());

        const response = await apiClient.get<{
            items: Consultant[];
            pagination: { total: number };
        }>(`/consultants?${params.toString()}`);
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

    /**
     * Caminho do endpoint de export .xlsx (`GET /consultants/export`). O download
     * em si é feito pelo util `downloadAndShareExcel` (Bearer + share nativo); aqui
     * expomos só o path para manter a assinatura previsível e testável.
     */
    exportPath(): string {
        return '/consultants/export';
    },
};
