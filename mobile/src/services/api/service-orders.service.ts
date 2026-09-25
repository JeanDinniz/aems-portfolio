import { apiClient } from './client';
import { resolveMediaUrl } from '@/lib/resolveMediaUrl';
import { downloadAndShareExcel } from '@/utils/exportShare';
import type {
    ServiceOrder,
    CreateServiceOrderData,
    ServiceOrderFilters,
    ServiceOrderStatus,
    FinalizeServiceOrderPayload,
} from '@/types/service-order.types';

/**
 * Service de Ordens de Serviço (OS-01) — portado 1:1 de
 * frontend/src/services/api/service-orders.service.ts.
 *
 * Única adaptação mobile: o import do apiClient segue o padrão dos services
 * mobile (named import `{ apiClient }` de './client', igual a stores/auth).
 * Toda a lógica de mapeamento e os métodos são idênticos ao web.
 */

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
    execution_notes?: string | null;
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
    items?: Array<{
        service_id: number;
        quantity: number;
        unit_price?: number;
        notes?: string;
        tonality?: string;
        roll_code?: string;
        service_name?: string | null;
        service_code?: string | null;
        service_department?: string | null;
        film_roll_id?: number | null;
        film_type_id?: number | null;
        // Retalho (sobra de corte anterior): nada é debitado da bobina.
        used_scrap?: boolean;
        scrap_source_roll_id?: number | null;
        film_applications?: Array<{
            tonality: string;
            region?: string | null;
            film_roll_id?: number | null;
            roll_code?: string | null;
            used_scrap?: boolean;
            scrap_source_roll_id?: number | null;
        }> | null;
    }>;
    services?: BackendService[];
    service_date?: string | null;
    is_verified?: boolean;
    verified_at?: string | null;
    vehicle_model_id?: number | null;
    completion_photos?: string | string[] | null;
    updated_at?: string | null;
    updated_by_name?: string | null;
    original_service_order_id?: number | null;
    video_url?: string | null;
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
    // resolveMediaUrl: troca host local (localhost/127.0.0.1) pelo IP da API para
    // a foto carregar no device físico (só exibição — não afeta o payload de envio).
    const photos = parseJson<string[]>(raw.photos, []).map(resolveMediaUrl);
    const damagePhotos = parseJson<string[]>(raw.damage_photos, []).map(resolveMediaUrl);

    const workers = (raw.workers || []).map((w: BackendWorker, idx: number) => ({
        id: Number(w.id ?? w.employee_id ?? 0),
        employee_id: Number(w.employee_id ?? w.id ?? 0),
        name: w.employee_name || `Funcionário ${w.employee_id}`,
        isPrimary: idx === 0,
    }));

    const items = (raw.items || []).map((item) => ({
        service_id: item.service_id,
        quantity: item.quantity,
        unit_price: item.unit_price ?? 0,
        notes: item.notes,
        tonality: item.tonality,
        roll_code: item.roll_code,
        service_name: item.service_name ?? null,
        service_code: item.service_code ?? null,
        service_department: item.service_department ?? null,
        film_roll_id: item.film_roll_id ?? null,
        film_type_id: item.film_type_id ?? null,
        // Retalho: serviço feito com sobra já debitada em corte anterior.
        used_scrap: item.used_scrap ?? false,
        scrap_source_roll_id: item.scrap_source_roll_id ?? null,
        // Tonalidades por região (finalize por tonalidade). null = item legado.
        film_applications: item.film_applications ?? null,
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
        vehicle_model_id: raw.vehicle_model_id ?? null,
        vehicle_year: raw.vehicle_year ?? null,
        internal_notes: raw.internal_notes ?? null,
        notes: raw.notes ?? null,
        execution_notes: raw.execution_notes ?? null,
        service_date: raw.service_date ?? null,
        is_verified: raw.is_verified ?? false,
        verified_at: raw.verified_at ?? null,
        original_service_order_id: raw.original_service_order_id ?? null,
        updated_at: raw.updated_at ?? undefined,
        updated_by_name: raw.updated_by_name ?? null,
        video_url: raw.video_url ?? null,
    } as unknown as ServiceOrder;
}

// ─── Tipos públicos (A3/A4) ─────────────────────────────────────────────────
export interface ConferenceStoreSummaryItem {
    store_id: number;
    store_name: string;
    total: number;
    verified: number;
    waiting: number;
    wrong: number;
    cancelled: number;
    percent_verified: number;
}

export interface DuplicateOrderMatch {
    id: number;
    order_number: string | null;
    vehicle_plate: string;
    department: string;
    service_date: string | null;
    matched_services: string[];
}

export interface DuplicateAppointmentMatch {
    id: number;
    vehicle_plate: string;
    department: string;
    delivery_date: string;
    service_order_id: number | null;
    matched_services: string[];
}

export interface DuplicateCheckResult {
    service_orders: DuplicateOrderMatch[];
    appointments: DuplicateAppointmentMatch[];
}

/** Sugestão de O.S. de origem ao marcar Retorno (GET /service-orders/return-origin-suggestion). */
export interface ReturnOriginSuggestion {
    id: number;
    order_number: string | null;
    external_os_number: string | null;
    service_date: string | null;
    services: string[];
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
        if (filters?.is_verified !== undefined)
            params.append('is_verified', String(filters.is_verified));
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

    /**
     * Desfaz o "Lançado Errado" restaurando o status ANTERIOR (tipicamente
     * Finalizado), em vez de reabrir para Aguardando. Evita que corrigir um falso
     * "Lançado Errado" de uma O.S. já finalizada a faça ressurgir como "Atrasado".
     * Endpoint dedicado — não usar `updateStatus(id, 'waiting')` para isso.
     */
    undoWrong: async (id: number): Promise<ServiceOrder> => {
        const response = await apiClient.post<BackendServiceOrder>(
            `/service-orders/${id}/undo-wrong`,
            {}
        );
        return mapServiceOrder(response.data);
    },

    finalize: async (
        id: number,
        payload: FinalizeServiceOrderPayload
    ): Promise<ServiceOrder> => {
        const { data } = await apiClient.post<BackendServiceOrder>(
            `/service-orders/${id}/finalize`,
            payload
        );
        return mapServiceOrder(data);
    },

    cancel: async (id: number, reason?: string): Promise<ServiceOrder> => {
        const params = reason ? { reason } : undefined;
        const response = await apiClient.delete<BackendServiceOrder>(`/service-orders/${id}`, {
            params,
        });
        return mapServiceOrder(response.data);
    },

    delete: async (id: number) => {
        await apiClient.delete(`/service-orders/${id}`);
    },

    // Endpoint leve dedicado: PATCH /service-orders/{id}/verify { verified }
    // (mais rápido que o update genérico + broadcast WS em background).
    verify: async (id: number): Promise<ServiceOrder> => {
        const response = await apiClient.patch<BackendServiceOrder>(
            `/service-orders/${id}/verify`,
            { verified: true }
        );
        return mapServiceOrder(response.data);
    },

    unverify: async (id: number): Promise<ServiceOrder> => {
        const response = await apiClient.patch<BackendServiceOrder>(
            `/service-orders/${id}/verify`,
            { verified: false }
        );
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
    }): Promise<
        Array<{
            department: string;
            total: number;
            verified: number;
            waiting: number;
            wrong: number;
            cancelled: number;
            percent_verified: number;
        }>
    > => {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => {
            if (v === undefined || v === null) return;
            if (Array.isArray(v)) {
                v.forEach((item) => searchParams.append(k, String(item)));
            } else {
                searchParams.append(k, String(v));
            }
        });
        const response = await apiClient.get<
            Array<{
                department: string;
                total: number;
                verified: number;
                waiting: number;
                wrong: number;
                cancelled: number;
                percent_verified: number;
            }>
        >(`/service-orders/conference/summary?${searchParams.toString()}`);
        return response.data;
    },

    // ─── Resumo de conferência por LOJA (A4) ─────────────────────────────────
    // GET /service-orders/conference/summary/by-store — mesmos filtros do resumo
    // por departamento, mas agrupando por loja.
    getConferenceSummaryByStore: async (params: {
        store_ids?: number[];
        date_from?: string;
        date_to?: string;
        plate?: string;
        worker_id?: number;
        include_cancelled?: boolean;
        is_courtesy?: boolean;
    }): Promise<ConferenceStoreSummaryItem[]> => {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => {
            if (v === undefined || v === null) return;
            if (Array.isArray(v)) {
                v.forEach((item) => searchParams.append(k, String(item)));
            } else {
                searchParams.append(k, String(v));
            }
        });
        const response = await apiClient.get<ConferenceStoreSummaryItem[]>(
            `/service-orders/conference/summary/by-store?${searchParams.toString()}`
        );
        return response.data;
    },

    // ─── Checagem de duplicidade ao lançar O.S. (A3) ─────────────────────────
    // GET /service-orders/duplicate-check — não bloqueia, apenas informa.
    // service_ids é repetido na query (um param por id).
    duplicateCheck: async (params: {
        plate: string;
        service_date: string; // YYYY-MM-DD
        department: string;
        service_ids: number[];
    }): Promise<DuplicateCheckResult> => {
        const searchParams = new URLSearchParams();
        searchParams.append('plate', params.plate);
        searchParams.append('service_date', params.service_date);
        searchParams.append('department', params.department);
        params.service_ids.forEach((id) => searchParams.append('service_ids', String(id)));
        const response = await apiClient.get<DuplicateCheckResult>(
            `/service-orders/duplicate-check?${searchParams.toString()}`
        );
        return {
            service_orders: response.data.service_orders ?? [],
            appointments: response.data.appointments ?? [],
        };
    },

    // ─── Sugestão de O.S. de origem para Retorno ─────────────────────────────
    // GET /service-orders/return-origin-suggestion — retorna a O.S. anterior mais
    // recente da placa/chassi. `exclude_os_id` evita sugerir a própria O.S. em
    // edição. Quando `store_id` (loja onde o retorno será aberto) é informado, a
    // busca inclui as O.S. de outras lojas da mesma marca. Quando `department` é
    // informado, a origem é restrita ao mesmo departamento. Retorna null quando não
    // há origem.
    suggestReturnOrigin: async (
        plate: string,
        excludeOsId?: number,
        storeId?: number,
        department?: string
    ): Promise<ReturnOriginSuggestion | null> => {
        const { data } = await apiClient.get<{ suggestion?: ReturnOriginSuggestion | null }>(
            '/service-orders/return-origin-suggestion',
            { params: { plate, exclude_os_id: excludeOsId, store_id: storeId, department } }
        );
        return data.suggestion ?? null;
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
            params: { plate },
        });
        return response.data;
    },

    // ─── Exportações de Excel (Sprint 6 — Fatia 4) ──────────────────────────
    // Todas baixam um .xlsx e abrem o compartilhamento nativo via
    // `downloadAndShareExcel`. Params undefined são omitidos pelo axios.
    // `flag` é serializado como chaves repetidas (`flag=courtesy&flag=galpon`).
    exportConferencia: async (params: {
        store_id?: number;
        date_from?: string;
        date_to?: string;
        department?: string;
        is_verified?: boolean;
        status?: 'cancelled' | 'wrong';
        flag?: Array<'courtesy' | 'galpon' | 'retorno'>;
        plate?: string;
        worker_id?: number;
    }): Promise<void> => {
        await downloadAndShareExcel({
            path: '/service-orders/export/conferencia',
            params,
            filename: `conferencia_${params.date_from ?? 'inicio'}_${params.date_to ?? 'fim'}.xlsx`,
        });
    },

    exportFechamento: async (params: {
        store_id?: number;
        date_from?: string;
        date_to?: string;
        department?: string;
        is_courtesy?: boolean;
        is_return?: boolean;
        service_name_contains?: string | string[];
        service_name_not_contains?: string | string[];
        status?: string;
        loja?: string;
    }): Promise<void> => {
        const { loja, ...query } = params;
        await downloadAndShareExcel({
            path: '/service-orders/export/fechamento',
            params: query,
            filename: `fechamento_${loja ?? 'todas'}_${params.date_from ?? 'inicio'}_${params.date_to ?? 'fim'}.xlsx`,
        });
    },

    exportFechamentoResumo: async (params: {
        store_id?: number;
        date_from?: string;
        date_to?: string;
        loja?: string;
    }): Promise<void> => {
        const { loja, ...query } = params;
        await downloadAndShareExcel({
            path: '/service-orders/export/fechamento-resumo',
            params: query,
            filename: `resumo_fechamento_${loja ?? 'todas'}_${params.date_from ?? 'inicio'}_${params.date_to ?? 'fim'}.xlsx`,
        });
    },

    exportFechamentoSecao: async (params: {
        store_id?: number;
        date_from?: string;
        date_to?: string;
        dept_key: 'workshop_courtesy' | 'workshop_lavagem' | 'bodywork' | 'vn' | 'vd' | 'vu';
        loja?: string;
    }): Promise<void> => {
        const { loja, ...query } = params;
        await downloadAndShareExcel({
            path: '/service-orders/export/fechamento-secao',
            params: query,
            filename: `fechamento_${params.dept_key}_${loja ?? 'todas'}_${params.date_from ?? 'inicio'}_${params.date_to ?? 'fim'}.xlsx`,
        });
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
        const response = await apiClient.get<BackendPaginatedResponse>(
            `/service-orders?${searchParams.toString()}`
        );
        const raw = response.data;
        return {
            items: (raw.items || []).map(mapServiceOrder),
            total: raw.pagination?.total ?? 0,
        };
    },
};
