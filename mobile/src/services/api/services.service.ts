import { apiClient } from './client';

/** Portado de frontend/src/services/api/services.service.ts (apenas leitura para pickers). */

export type ServiceCategory = 'insulfilm' | 'pelicula_seguranca' | 'ppf' | 'estetica';

export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
    insulfilm: 'Película',
    pelicula_seguranca: 'Película de Segurança',
    ppf: 'PPF',
    estetica: 'Estética',
};

export interface ServiceItem {
    id: number;
    name: string;
    description: string | null;
    department: string;
    // Decimal do backend → chega como STRING (Pydantic v2). Formatar via
    // formatDecimalBRL; nunca aritmética/`.toFixed` direto.
    base_price: string;
    has_variable_price: boolean;
    is_active: boolean;
    brand_id: number;
    brand?: { id: number; name: string; code: string } | null;
    code?: string | null;
    category: ServiceCategory | null;
    /** Serviço exclusivo de cortesia — só aparece em lançamentos/agendamentos de cortesia. */
    is_courtesy_only?: boolean;
    execution_time_minutes: number | null;
    created_at?: string;
    updated_at?: string | null;
}

export interface ServiceListParams {
    department?: string;
    brand_id?: number;
    is_active?: boolean;
    search?: string;
    skip?: number;
    limit?: number;
}

export interface ServiceListResponse {
    items: ServiceItem[];
    total: number;
}

export const servicesService = {
    list: async (params?: ServiceListParams): Promise<ServiceListResponse> => {
        const queryParams: Record<string, string | number | boolean> = {
            limit: params?.limit ?? 200,
            skip: params?.skip ?? 0,
        };
        if (params?.department) queryParams.department = params.department;
        if (params?.brand_id !== undefined) queryParams.brand_id = params.brand_id;
        if (params?.is_active !== undefined) queryParams.is_active = params.is_active;
        if (params?.search) queryParams.search = params.search;

        const response = await apiClient.get('/services', { params: queryParams });
        return {
            items: response.data.items ?? [],
            total: response.data.total ?? response.data.pagination?.total ?? 0,
        };
    },

    getById: async (id: number): Promise<ServiceItem> =>
        apiClient.get(`/services/${id}`).then((r) => r.data),

    /** Soft delete (DELETE /services/{id}) → is_active=false (Owner only). */
    deactivate: async (id: number): Promise<ServiceItem> =>
        apiClient.delete(`/services/${id}`).then((r) => r.data),

    /** Reativa via PATCH /services/{id} { is_active: true }. */
    activate: async (id: number): Promise<ServiceItem> =>
        apiClient.patch(`/services/${id}`, { is_active: true }).then((r) => r.data),
};
