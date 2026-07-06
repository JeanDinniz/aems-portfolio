import apiClient from './client';
import type { ServiceOrder, CreateServiceOrderData, ServiceOrderFilters, ServiceOrderStatus } from '@/types/service-order.types';

// ─── Duplicate check ──────────────────────────────────────────────────────────
export interface DuplicateCheckSOItem {
    id: number;
    order_number: string | null;
    vehicle_plate: string;
    department: string;
    service_date: string | null;
    matched_services: string[];
}

export interface DuplicateCheckAppointmentItem {
    id: number;
    vehicle_plate: string;
    department: string;
    delivery_date: string;
    service_order_id: number | null;
    matched_services: string[];
}

export interface DuplicateCheckResult {
    service_orders: DuplicateCheckSOItem[];
    appointments: DuplicateCheckAppointmentItem[];
}
// ─── Backend types ──────────────────────────────────────────────────────────
interface BackendWorker {
    id?: number;
    employee_id?: number;
    employee_name?: string;
    name?: string;
}

interface BackendService {
    id: number;
    name?: string;
    service_name?: string;
}

interface BackendServiceOrder {
    id: number;
    order_number?: string;
    status: string;
    vehicle_plate?: string;
    plate?: string;
    vehicle_model?: string;
    vehicle_brand?: string;
    vehicle_color?: string;
    vehicle_year?: number | null;
    department?: string;
    internal_notes?: string | null;
    store_id?: number;
    location_id?: number;
    location_name?: string;
    store_name?: string;
    start_time?: string;
    started_at?: string;
    completion_time?: string;
    completed_at?: string;
    entry_time?: string;
    created_at?: string;
    photos?: string | string[];
    damage_photos?: string | string[];
    workers?: BackendWorker[];
    elapsed_minutes?: number;
    total_value?: number;
    dealership_name?: string;
    dealership_id?: number;
    is_galpon?: boolean;
    consultant_id?: number;
    consultant_name?: string;
    external_os_number?: string;
    notes?: string;
    damage_map?: string;
    invoice_number?: string;
    items?: Array<{ service_id: number; quantity: number; unit_price?: number; notes?: string; tonality?: string; roll_code?: string; service_name?: string | null; service_code?: string | null; film_roll_id?: number | null }>;
    services?: BackendService[];
    service_date?: string | null;
    is_verified?: boolean;
    verified_at?: string | null;
    completion_photos?: string | string[] | null;
    [key: string]: unknown;
}

interface BackendPaginatedResponse {
    items: BackendServiceOrder[];
    pagination: { total: number };
}

// ─── Status mapping ──────────────────────────────────────────────────────────
// Backend: 'waiting' | 'in_progress' | 'completed' | 'cancelled' | 'wrong'
// Frontend: 'waiting' | 'doing'       | 'ready'     | 'cancelled' | 'wrong'

const STATUS_B2F: Record<string, ServiceOrderStatus> = {
    in_progress: 'doing',
    completed: 'ready',
};

const STATUS_F2B: Record<string, string> = {
    doing: 'in_progress',
    ready: 'completed',
};

function toFrontendStatus(s: string): ServiceOrderStatus {
    return (STATUS_B2F[s] ?? s) as ServiceOrderStatus;
}

function toBackendStatus(s: string): string {
    return STATUS_F2B[s] ?? s;
}

// ─── JSON field parser ────────────────────────────────────────────────────────
function parseJson<T>(value: unknown, fallback: T): T {
    if (value === null || value === undefined) return fallback;
    if (typeof value !== 'string') return value as unknown as T;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

// ─── Backend → Frontend mapper ────────────────────────────────────────────────
function mapServiceOrder(raw: BackendServiceOrder): ServiceOrder {
    const photos = parseJson<string[]>(raw.photos, []);
    const damagePhotos = parseJson<string[]>(raw.damage_photos, []);

    const workers = (raw.workers || []).map((w: BackendWorker, idx: number) => ({
        id: Number(w.id ?? w.employee_id ?? 0),
        employee_id: Number(w.employee_id ?? w.id ?? 0),
        name: w.employee_name || `Funcionário ${w.employee_id}`,
        isPrimary: idx === 0,
    }));

    const items = (raw.items || []).map(item => ({
        service_id: item.service_id,
        quantity: item.quantity,
        unit_price: item.unit_price ?? 0,
        notes: item.notes,
        tonality: item.tonality,
        roll_code: item.roll_code,
        service_name: item.service_name ?? null,
        service_code: item.service_code ?? null,
        film_roll_id: (item as any).film_roll_id ?? null,
        film_type_id: (item as any).film_type_id ?? null,
    }));

    return {
        ...raw,
        order_number: raw.order_number || `#${raw.id}`,
        status: toFrontendStatus(raw.status),
        plate: raw.vehicle_plate || raw.plate || '',
        location_id: raw.store_id ?? raw.location_id ?? 0,
        location_name: raw.location_name || raw.store_name || '',
        started_at: raw.start_time ?? raw.started_at ?? null,
        completed_at: raw.completion_time ?? raw.completed_at ?? null,
        photos,
        damage_photos: damagePhotos,
        workers,
        items,
        technician_id: raw.workers?.[0]?.employee_id ?? null,
        technician_name: raw.workers?.[0]?.employee_name ?? null,
        elapsed_minutes: raw.elapsed_minutes || 0,
        service_type: raw.department || '',
        total_value: raw.total_value ?? 0,
        dealership_name: raw.dealership_name || '',
        is_galpon: raw.is_galpon ?? false,
        vehicle_brand: raw.vehicle_brand ?? undefined,
        vehicle_model_id: (raw as any).vehicle_model_id ?? null,
        vehicle_year: raw.vehicle_year ?? null,
        internal_notes: raw.internal_notes ?? null,
        service_date: raw.service_date ?? null,
        is_verified: raw.is_verified ?? false,
        verified_at: raw.verified_at ?? null,
    } as unknown as ServiceOrder;
}

// ─── Service ──────────────────────────────────────────────────────────────────
export const serviceOrdersService = {
    getAll: async (filters?: ServiceOrderFilters, skip = 0, limit = 20) => {
        const params = new URLSearchParams();
        if (filters?.status) {
            const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
            statuses.forEach((s) => params.append('status', s));
        }
        if (filters?.location_id) params.append('store_id', filters.location_id.toString());
        if (filters?.store_id) params.append('store_id', filters.store_id.toString());
        if (filters?.start_date) params.append('date_from', filters.start_date);
        if (filters?.end_date) params.append('date_to', filters.end_date);
        if (filters?.date_from) params.append('date_from', filters.date_from);
        if (filters?.date_to) params.append('date_to', filters.date_to);
        if (filters?.search) params.append('plate', filters.search);
        if (filters?.is_verified !== undefined) params.append('is_verified', String(filters.is_verified));
        if (filters?.department) params.append('department', filters.department);
        if (filters?.worker_id) params.append('worker_id', filters.worker_id.toString());
        if (filters?.flag && filters.flag.length > 0) {
            filters.flag.forEach((f) => params.append('flag', f));
        }
        params.append('page', (Math.floor(skip / limit) + 1).toString());
        params.append('limit', limit.toString());

        const response = await apiClient.get<BackendPaginatedResponse>(
            `/service-orders?${params.toString()}`
        );
        const raw = response.data;
        return {
            items: (raw.items || []).map(mapServiceOrder),
            total: raw.pagination?.total ?? 0,
        };
    },

    getById: async (id: number): Promise<ServiceOrder> => {
        const response = await apiClient.get<BackendServiceOrder>(`/service-orders/${id}`);
        return mapServiceOrder(response.data);
    },

    create: async (data: CreateServiceOrderData) => {
        const response = await apiClient.post<BackendServiceOrder>('/service-orders', data);
        return mapServiceOrder(response.data);
    },

    update: async (id: number, data: Partial<CreateServiceOrderData>) => {
        const response = await apiClient.patch<BackendServiceOrder>(`/service-orders/${id}`, data);
        return mapServiceOrder(response.data);
    },

    updateStatus: async (id: number, status: string, extras?: Record<string, unknown>) => {
        const backendStatus = toBackendStatus(status);
        const response = await apiClient.patch<BackendServiceOrder>(
            `/service-orders/${id}/status`,
            { new_status: backendStatus, ...extras }
        );
        return mapServiceOrder(response.data);
    },

    finalize: async (id: number, payload: {
        completion_photos: string[]
        film_roll_assignments: Array<{ service_id: number; film_roll_id: number }>
        employee_ids: number[]
    }): Promise<ServiceOrder> => {
        const { data } = await apiClient.post<BackendServiceOrder>(`/service-orders/${id}/finalize`, payload)
        return mapServiceOrder(data)
    },

    cancel: async (id: number, reason?: string): Promise<ServiceOrder> => {
        const params = reason ? { reason } : undefined;
        const response = await apiClient.delete<BackendServiceOrder>(`/service-orders/${id}`, { params });
        return mapServiceOrder(response.data);
    },

    delete: async (id: number) => {
        await apiClient.delete(`/service-orders/${id}`);
    },

    verify: async (id: number): Promise<ServiceOrder> => {
        const response = await apiClient.patch<BackendServiceOrder>(`/service-orders/${id}/verify`, { verified: true });
        return mapServiceOrder(response.data);
    },

    unverify: async (id: number): Promise<ServiceOrder> => {
        const response = await apiClient.patch<BackendServiceOrder>(`/service-orders/${id}/verify`, { verified: false });
        return mapServiceOrder(response.data);
    },

    async getOSHistory(serviceOrderId: number): Promise<{
        items: Array<{
            id: number;
            from_status: string | null;
            to_status: string;
            changed_by_name: string | null;
            changed_at: string;
            notes: string | null;
        }>;
    }> {
        const response = await apiClient.get(`/service-orders/${serviceOrderId}/history`);
        return response.data;
    },

    getConferenceSummary: async (params: {
        store_ids?: number[];
        date_from?: string;
        date_to?: string;
        plate?: string;
        worker_id?: number;
        include_cancelled?: boolean;
        is_courtesy?: boolean;
    }): Promise<Array<{
        department: string;
        total: number;
        verified: number;
        waiting: number;
        wrong: number;
        cancelled: number;
        percent_verified: number;
    }>> => {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => {
            if (v === undefined || v === null) return;
            if (Array.isArray(v)) {
                v.forEach((item) => searchParams.append(k, String(item)));
            } else {
                searchParams.append(k, String(v));
            }
        });
        const response = await apiClient.get<Array<{
            department: string;
            total: number;
            verified: number;
            waiting: number;
            wrong: number;
            cancelled: number;
            percent_verified: number;
        }>>(`/service-orders/conference/summary?${searchParams.toString()}`);
        return response.data;
    },

    getConferenceSummaryByStore: async (params: {
        store_ids?: number[];
        date_from?: string;
        date_to?: string;
        plate?: string;
        worker_id?: number;
        include_cancelled?: boolean;
        is_courtesy?: boolean;
    }): Promise<Array<{
        store_id: number;
        store_name: string;
        total: number;
        verified: number;
        waiting: number;
        wrong: number;
        cancelled: number;
        percent_verified: number;
    }>> => {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => {
            if (v === undefined || v === null) return;
            if (Array.isArray(v)) {
                v.forEach((item) => searchParams.append(k, String(item)));
            } else {
                searchParams.append(k, String(v));
            }
        });
        const response = await apiClient.get<Array<{
            store_id: number;
            store_name: string;
            total: number;
            verified: number;
            waiting: number;
            wrong: number;
            cancelled: number;
            percent_verified: number;
        }>>(`/service-orders/conference/summary/by-store?${searchParams.toString()}`);
        return response.data;
    },

    async getVehicleHistory(plate: string): Promise<{
        plate: string;
        items: Array<{
            id: number;
            order_number: string;
            service_date: string | null;
            entry_time: string;
            department: string;
            status: string;
            store_name: string | null;
            service_names: string[];
        }>;
    }> {
        const response = await apiClient.get('/service-orders/vehicle-history', {
            params: { plate }
        });
        return response.data;
    },

    checkDuplicate: async (params: {
        plate: string;
        service_date: string;
        department: string;
        service_ids: number[];
    }): Promise<DuplicateCheckResult> => {
        const sp = new URLSearchParams();
        sp.append('plate', params.plate);
        sp.append('service_date', params.service_date);
        sp.append('department', params.department);
        params.service_ids.forEach((id) => sp.append('service_ids', String(id)));
        const response = await apiClient.get(`/service-orders/duplicate-check?${sp.toString()}`);
        return response.data as DuplicateCheckResult;
    },

    getFiltered: async (params: {
        store_id?: number;
        store_ids?: number[];
        is_verified?: boolean;
        flag?: string[];
        status?: string;
        department?: string;
        date_from?: string;
        date_to?: string;
        plate?: string;
        worker_id?: number;
        include_cancelled?: boolean;
        sort_by?: string;
        sort_dir?: 'asc' | 'desc';
        page?: number;
        limit?: number;
    }) => {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => {
            if (v === undefined || v === null) return;
            if (Array.isArray(v)) {
                v.forEach((item) => searchParams.append(k, String(item)));
            } else {
                searchParams.append(k, String(v));
            }
        });
        const response = await apiClient.get<BackendPaginatedResponse>(`/service-orders?${searchParams.toString()}`);
        const raw = response.data;
        return {
            items: (raw.items || []).map(mapServiceOrder),
            total: raw.pagination?.total ?? 0,
        };
    },
};
