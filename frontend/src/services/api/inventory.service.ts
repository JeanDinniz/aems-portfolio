import apiClient from './client';

// ─── Film Types ───────────────────────────────────────────────────────────────

export interface FilmTypeServiceLink {
    service_id: number;
    service_name: string;
    service_code: string;
    meters_consumed: number;
}

export interface FilmType {
    id: number;
    name: string;
    department: 'film' | 'ppf' | 'security_film';
    yellow_threshold_meters: number;
    red_threshold_meters: number;
    is_active: boolean;
    available_tonalities: string[];
    services: FilmTypeServiceLink[];
}

export interface FilmTypeListResponse {
    items: FilmType[];
    total: number;
}

export interface CreateFilmTypePayload {
    name: string;
    department: 'film' | 'ppf' | 'security_film';
    yellow_threshold_meters: number;
    red_threshold_meters: number;
    available_tonalities?: string[];
}

export interface UpdateFilmTypePayload {
    name?: string;
    department?: 'film' | 'ppf' | 'security_film';
    yellow_threshold_meters?: number;
    red_threshold_meters?: number;
    available_tonalities?: string[];
}

export interface AddServiceToFilmTypePayload {
    service_id: number;
    meters_consumed: number;
}

// ─── Film Rolls (Inventory) ───────────────────────────────────────────────────

export type FilmRollStatus = 'em_estoque' | 'em_uso' | 'esgotada';
export type FilmRollColor = 'blue' | 'green' | 'yellow' | 'red';

export interface FilmRoll {
    id: number;
    store_id: number;
    store_name: string | null;
    film_type_id: number;
    film_type_name: string;
    tonality: string | null;
    supplier: string | null;
    supplier_id: number | null;
    supplier_name: string | null;
    nfe_number: string | null;
    total_meters: number;
    remaining_meters: number;
    receipt_date: string;
    status: FilmRollStatus;
    visual_id: string;
    color: FilmRollColor;
    created_at: string;
    cost: number | null;
    lot_number: string | null;
}

export interface FilmRollListResponse {
    items: FilmRoll[];
    total: number;
}

export interface FilmRollListParams {
    store_id?: number;
    film_type_id?: number;
    service_id?: number;
    status?: FilmRollStatus | '';
    department?: 'film' | 'ppf' | 'security_film';
    page?: number;
    limit?: number;
    use_galpon_store?: boolean;
    /** Bobinas que devem aparecer sempre, ignorando filtros de status/tipo (ex.: bobina já vinculada à O.S., mesmo esgotada). */
    include_roll_ids?: number[];
}

export interface CreateFilmRollPayload {
    store_id: number;
    film_type_id: number;
    tonality?: string;
    supplier?: string;
    supplier_id?: number;
    nfe_number?: string;
    total_meters: number;
    receipt_date: string;
    cost?: number;
    lot_number?: string;
}

export interface FilmConsumption {
    id: number;
    film_roll_id: number;
    service_order_item_id: number | null;
    meters_consumed: number;
    vehicle_model: string | null;
    plate: string | null;
    created_at: string;
}

// Keep old name as alias for backwards compatibility
export type FilmRollConsumption = FilmConsumption;

export interface FilmTypeForecastItem {
    service_order_id: number | null;
    appointment_id: number | null;
    vehicle_model: string | null;
    vehicle_plate: string | null;
    service_name: string | null;
    meters_consumed: number;
    tonality: string | null;
}

export interface TonalityForecastDetail {
    tonality: string | null;
    available_meters: number;
    consumed_meters: number;
    balance_meters: number;
    scheduled_orders_count: number;
    usage_percentage: number;
    status: 'critical' | 'attention' | 'ok';
    items: FilmTypeForecastItem[];
}

export interface FilmTypeForecastResponse {
    film_type_id: number;
    store_id: number;
    items: FilmTypeForecastItem[];
    total_scheduled_meters: number;
    available_meters: number;
    will_exhaust: boolean;
    // HML-155
    film_type_name: string;
    tonalities: TonalityForecastDetail[];
    tonalities_analyzed: number;
    tonalities_attention_count: number;
    tonalities_critical_count: number;
    unattributed_items: FilmTypeForecastItem[];
    unattributed_meters: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const inventoryService = {
    // Film Types
    listFilmTypes: async (params?: { page?: number; limit?: number; department?: 'film' | 'ppf' | 'security_film' }): Promise<FilmTypeListResponse> => {
        const queryParams: Record<string, string | number> = {
            page: params?.page ?? 1,
            limit: params?.limit ?? 200,
        };
        if (params?.department) queryParams.department = params.department;
        const response = await apiClient.get('/film-types', { params: queryParams });
        return {
            items: response.data.items ?? [],
            total: response.data.total ?? response.data.pagination?.total ?? 0,
        };
    },

    createFilmType: async (payload: CreateFilmTypePayload): Promise<FilmType> => {
        const response = await apiClient.post('/film-types', payload);
        return response.data;
    },

    updateFilmType: async (id: number, payload: UpdateFilmTypePayload): Promise<FilmType> => {
        const response = await apiClient.patch(`/film-types/${id}`, payload);
        return response.data;
    },

    deleteFilmType: async (id: number): Promise<void> => {
        await apiClient.delete(`/film-types/${id}`);
    },

    addServiceToFilmType: async (filmTypeId: number, payload: AddServiceToFilmTypePayload): Promise<FilmTypeServiceLink> => {
        const response = await apiClient.post(`/film-types/${filmTypeId}/services`, payload);
        return response.data;
    },

    removeServiceFromFilmType: async (filmTypeId: number, serviceId: number): Promise<void> => {
        await apiClient.delete(`/film-types/${filmTypeId}/services/${serviceId}`);
    },

    // Film Rolls
    listRolls: async (params?: FilmRollListParams): Promise<FilmRollListResponse> => {
        const queryParams: Record<string, string | number> = {
            page: params?.page ?? 1,
            limit: params?.limit ?? 500,
        };
        if (params?.store_id) queryParams.store_id = params.store_id;
        if (params?.film_type_id) queryParams.film_type_id = params.film_type_id;
        if (params?.service_id) queryParams.service_id = params.service_id;
        if (params?.status) queryParams.status = params.status;
        if (params?.department) queryParams.department = params.department;
        if (params?.use_galpon_store) queryParams.use_galpon_store = 'true';

        // include_roll_ids é uma lista — serializa como repetição (include_roll_ids=1&include_roll_ids=2)
        const search = new URLSearchParams();
        Object.entries(queryParams).forEach(([k, v]) => search.append(k, String(v)));
        if (params?.include_roll_ids?.length) {
            params.include_roll_ids.forEach((id) => search.append('include_roll_ids', String(id)));
        }

        const response = await apiClient.get(`/inventory/rolls?${search.toString()}`);
        return {
            items: response.data.items ?? [],
            total: response.data.total ?? response.data.pagination?.total ?? 0,
        };
    },

    createRoll: async (payload: CreateFilmRollPayload, force = false): Promise<FilmRoll> => {
        const response = await apiClient.post('/inventory/rolls', payload, {
            params: { force },
        });
        return response.data;
    },

    exhaustRoll: async (id: number): Promise<FilmRoll> => {
        const response = await apiClient.patch(`/inventory/rolls/${id}/exhaust`);
        return response.data;
    },

    restoreRoll: async (id: number): Promise<FilmRoll> => {
        const response = await apiClient.patch(`/inventory/rolls/${id}/restore`);
        return response.data;
    },

    listCriticalRolls: async (storeId?: number): Promise<FilmRoll[]> => {
        const params: Record<string, number> = {};
        if (storeId) params.store_id = storeId;
        const response = await apiClient.get('/inventory/rolls/critical', { params });
        return response.data ?? [];
    },

    listRollConsumptions: async (rollId: number): Promise<FilmConsumption[]> => {
        const response = await apiClient.get(`/inventory/rolls/${rollId}/consumptions`);
        return response.data ?? [];
    },

    transferRoll: async (rollId: number, targetStoreId: number): Promise<FilmRoll> => {
        const response = await apiClient.post(`/inventory/rolls/${rollId}/transfer`, {
            target_store_id: targetStoreId,
        });
        return response.data;
    },

    exportRolls: async (params?: Omit<FilmRollListParams, 'page' | 'limit'>): Promise<Blob> => {
        const queryParams: Record<string, string | number> = {};
        if (params?.store_id) queryParams.store_id = params.store_id;
        if (params?.film_type_id) queryParams.film_type_id = params.film_type_id;
        if (params?.status) queryParams.status = params.status;
        if (params?.department) queryParams.department = params.department;
        const response = await apiClient.get('/inventory/export', {
            params: queryParams,
            responseType: 'blob',
        });
        return response.data;
    },

    deleteRoll: async (id: number): Promise<void> => {
        await apiClient.delete(`/inventory/rolls/${id}`);
    },

    exportRoll: async (rollId: number): Promise<Blob> => {
        const response = await apiClient.get(`/inventory/rolls/${rollId}/export`, {
            responseType: 'blob',
        });
        return response.data;
    },

    getForecast: async (filmTypeId: number, storeId: number): Promise<FilmTypeForecastResponse> => {
        const response = await apiClient.get(`/film-types/${filmTypeId}/forecast`, {
            params: { store_id: storeId },
        });
        return response.data;
    },

    // Helper: find available rolls for a given service (for QuickCreateModal)
    listAvailableRollsForService: async (storeId: number, filmTypeId: number): Promise<FilmRoll[]> => {
        const response = await apiClient.get('/inventory/rolls', {
            params: {
                store_id: storeId,
                film_type_id: filmTypeId,
                status: 'em_estoque',
                limit: 100,
            },
        });
        const items: FilmRoll[] = response.data.items ?? [];
        // Also include 'em_uso' rolls as fallback
        const inUseResponse = await apiClient.get('/inventory/rolls', {
            params: {
                store_id: storeId,
                film_type_id: filmTypeId,
                status: 'em_uso',
                limit: 100,
            },
        });
        const inUse: FilmRoll[] = inUseResponse.data.items ?? [];
        return [...items, ...inUse];
    },
};
