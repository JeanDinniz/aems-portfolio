import apiClient from './client';

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
    base_price: number;
    has_variable_price: boolean;
    is_courtesy_only: boolean;
    is_active: boolean;
    brand_id: number;
    brand?: { id: number; name: string; code: string } | null;
    code?: string | null;
    category: ServiceCategory | null;
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
    getAll: async (): Promise<ServiceItem[]> => {
        const response = await apiClient.get('/services', {
            params: { limit: 500 },
        });
        const items: ServiceItem[] = response.data.items;
        return items.sort((a, b) => {
            if (!a.code && !b.code) return a.name.localeCompare(b.name);
            if (!a.code) return 1;
            if (!b.code) return -1;
            return a.code.localeCompare(b.code) || a.name.localeCompare(b.name);
        });
    },

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
            total: response.data.total ?? 0,
        };
    },

    create: async (payload: {
        name: string;
        department: string;
        base_price: number;
        has_variable_price?: boolean;
        is_courtesy_only?: boolean;
        brand_id: number;
        code?: string | null;
        category?: ServiceCategory | null;
        execution_time_minutes?: number | null;
    }): Promise<ServiceItem> => {
        const response = await apiClient.post('/services', payload);
        return response.data;
    },

    update: async (id: number, payload: {
        name?: string;
        department?: string;
        base_price?: number;
        has_variable_price?: boolean;
        is_courtesy_only?: boolean;
        brand_id?: number;
        code?: string | null;
        category?: ServiceCategory | null;
        execution_time_minutes?: number | null;
    }): Promise<ServiceItem> => {
        const response = await apiClient.patch(`/services/${id}`, payload);
        return response.data;
    },

    deactivate: async (id: number): Promise<void> => {
        await apiClient.delete(`/services/${id}`);
    },
};
