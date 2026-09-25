import { AxiosError } from 'axios';

import { apiClient } from './client';

/**
 * Portado de frontend/src/services/api/inventory.service.ts.
 * Camada de dados de Estoque (INV-01):
 * - LEITURA: listRolls / listFilmTypes / getRoll / listRollConsumptions /
 *   listCriticalRolls / getForecast
 * - ESCRITA (bobinas): createRoll (com tratamento de 409 + X-Has-Critical-Rolls),
 *   transferRoll, exhaustRoll, restoreRoll, openRoll, deleteRoll
 * - ESCRITA (tipos de película): createFilmType / updateFilmType / deleteFilmType /
 *   addServiceToFilmType / removeServiceFromFilmType
 *
 * Consumo de bobina NÃO é manual no mobile — é automático na finalização da O.S.
 */

export type FilmDepartment = 'film' | 'ppf' | 'security_film';

// ─── Film Types ─────────────────────────────────────────────────────────────

export interface FilmTypeServiceLink {
    service_id: number;
    service_name: string;
    service_code: string;
    meters_consumed: number;
}

export interface FilmType {
    id: number;
    name: string;
    department: FilmDepartment;
    yellow_threshold_meters: number;
    red_threshold_meters: number;
    is_active: boolean;
    services: FilmTypeServiceLink[];
    /**
     * Tonalidades configuradas para este tipo (A7). Base
     * `["G05","G20","G35","G50","G75"]`; `security_film` inclui também
     * `"Incolor"`. Pode vir ausente em backends antigos — trate com fallback
     * à lista base via `getTonalityOptionsForFilmType`.
     */
    available_tonalities?: string[];
}

export interface FilmTypeListResponse {
    items: FilmType[];
    total: number;
}

export interface CreateFilmTypePayload {
    name: string;
    department: FilmDepartment;
    yellow_threshold_meters: number;
    red_threshold_meters: number;
}

export interface UpdateFilmTypePayload {
    name?: string;
    department?: FilmDepartment;
    yellow_threshold_meters?: number;
    red_threshold_meters?: number;
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
    // Decimal do backend chega como STRING (Pydantic v2 serializa Decimal como
    // string JSON). Formatar via formatDecimalBRL — nunca `.toFixed` direto.
    cost: string | null;
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
    /** Múltiplos status numa única request (tem prioridade sobre `status`). */
    statuses?: FilmRollStatus[];
    department?: FilmDepartment;
    page?: number;
    limit?: number;
    use_galpon_store?: boolean;
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

/**
 * Ajuste de metros restantes (conferência física de estoque). O gestor corrige o
 * saldo do sistema para bater com o físico, com MOTIVO obrigatório. Espelha
 * `frontend/src/services/api/inventory.service.ts` (adjustRollMeters).
 */
export interface AdjustMetersPayload {
    /** Novo saldo físico: 0 ≤ valor ≤ total_meters (o teto é validado client-side). */
    remaining_meters: number;
    /** Motivo do ajuste (obrigatório, 1..200). */
    note: string;
}

/**
 * Edição de metadados da bobina (todos os campos opcionais). Espelha o
 * `FilmRollUpdate` do web. Alterar `total_meters` NÃO edita o saldo — o backend
 * recalcula preservando o consumo. As flags `clear_*` esvaziam o campo respectivo
 * (envie a flag em vez de string vazia). `cost` é Decimal (aceita number|string;
 * nunca `.toFixed` direto).
 */
export interface UpdateFilmRollPayload {
    film_type_id?: number;
    tonality?: string | null;
    supplier_id?: number;
    nfe_number?: string;
    cost?: number | string;
    lot_number?: string;
    total_meters?: number;
    receipt_date?: string;
    clear_supplier?: boolean;
    clear_nfe?: boolean;
    clear_cost?: boolean;
    clear_lot?: boolean;
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

// ─── Film Withdrawals (saída avulsa) ─────────────────────────────────────────

/**
 * Saída avulsa de película: baixa de metros de uma bobina para um funcionário
 * (ex.: pedaço pedido pelo instalador, descontado no fim do mês). Espelha
 * `frontend/src/services/api/inventory.service.ts` (FilmWithdrawal). O estorno é
 * soft: `is_reversed` marca a saída como estornada (sai do total do funcionário)
 * sem restaurar bobina esgotada.
 */
export interface FilmWithdrawal {
    id: number;
    film_roll_id: number;
    roll_visual_id: string;
    /** Data de recebimento da bobina (para rótulo legível). Ausente em backends antigos. */
    roll_receipt_date: string | null;
    /** Metragem total da bobina (para rótulo legível). Ausente em backends antigos. */
    roll_total_meters: number | null;
    film_type_name: string | null;
    tonality: string | null;
    store_id: number;
    store_name: string | null;
    employee_id: number;
    employee_name: string | null;
    meters: number;
    reason: string | null;
    created_by_name: string | null;
    created_at: string;
    reversed_at: string | null;
    reversed_by_name: string | null;
    is_reversed: boolean;
}

export interface CreateFilmWithdrawalPayload {
    film_roll_id: number;
    employee_id: number;
    meters: number;
    reason?: string;
}

export interface FilmWithdrawalListParams {
    store_id?: number;
    employee_id?: number;
    film_type_id?: number;
    date_from?: string;
    date_to?: string;
    page?: number;
    limit?: number;
}

export interface FilmWithdrawalListResponse {
    items: FilmWithdrawal[];
    total: number;
    total_pages: number;
}

export interface FilmWithdrawalSummaryItem {
    employee_id: number;
    employee_name: string;
    withdrawal_count: number;
    total_meters: number;
}

export interface FilmWithdrawalSummaryResponse {
    items: FilmWithdrawalSummaryItem[];
    total_meters: number;
}

// ─── Forecast (Sprint 6 — só camada de dados, sem hook/uso ainda) ─────────────

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
    film_type_name: string;
    tonalities: TonalityForecastDetail[];
    tonalities_analyzed: number;
    tonalities_attention_count: number;
    tonalities_critical_count: number;
    unattributed_items: FilmTypeForecastItem[];
    unattributed_meters: number;
}

// ─── Erro tipado: bobinas críticas pendentes ──────────────────────────────────

/**
 * Lançado por `createRoll` quando o backend responde 409 com o header
 * `X-Has-Critical-Rolls: true` — indica que existem bobinas críticas do mesmo
 * tipo/loja pendentes. A tela deve oferecer "registrar mesmo assim"
 * (chamar `createRoll(payload, true)`).
 *
 * Espelha o fluxo do web (InventoryPage), que detecta o 409 e abre um modal de
 * confirmação. Aqui modelamos isso como erro tipado para a UI inspecionar a flag
 * `hasCriticalRolls` sem reabrir o objeto Axios.
 */
export class CriticalRollsError extends Error {
    readonly hasCriticalRolls = true;
    readonly status = 409;
    /** Erro Axios original, caso a tela precise da mensagem do backend. */
    readonly cause?: AxiosError;

    constructor(message = 'Existem bobinas críticas pendentes.', cause?: AxiosError) {
        super(message);
        this.name = 'CriticalRollsError';
        this.cause = cause;
    }
}

/** Type guard para a tela detectar o caso de bobinas críticas. */
export function isCriticalRollsError(error: unknown): error is CriticalRollsError {
    return error instanceof CriticalRollsError;
}

// ─── Service ────────────────────────────────────────────────────────────────

export const inventoryService = {
    listFilmTypes: async (params?: {
        page?: number;
        limit?: number;
        department?: 'film' | 'ppf' | 'security_film';
    }): Promise<FilmTypeListResponse> => {
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

    addServiceToFilmType: async (
        filmTypeId: number,
        payload: AddServiceToFilmTypePayload
    ): Promise<FilmTypeServiceLink> => {
        const response = await apiClient.post(`/film-types/${filmTypeId}/services`, payload);
        return response.data;
    },

    removeServiceFromFilmType: async (filmTypeId: number, serviceId: number): Promise<void> => {
        await apiClient.delete(`/film-types/${filmTypeId}/services/${serviceId}`);
    },

    getForecast: async (filmTypeId: number, storeId: number): Promise<FilmTypeForecastResponse> => {
        const response = await apiClient.get(`/film-types/${filmTypeId}/forecast`, {
            params: { store_id: storeId },
        });
        return response.data;
    },

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

        // statuses[] — serializa como query array (statuses=em_uso&statuses=esgotada)
        const search = new URLSearchParams();
        Object.entries(queryParams).forEach(([k, v]) => search.append(k, String(v)));
        if (params?.statuses?.length) {
            params.statuses.forEach((s) => search.append('statuses', s));
        }

        const response = await apiClient.get(`/inventory/rolls?${search.toString()}`);
        return {
            items: response.data.items ?? [],
            total: response.data.total ?? response.data.pagination?.total ?? 0,
        };
    },

    /**
     * Detalhe de uma bobina. O backend não expõe `GET /inventory/rolls/{id}`
     * isolado (igual ao web), então derivamos o detalhe de `listRolls` — o
     * componente normalmente já tem a bobina em cache/lista; este helper é um
     * fallback que filtra a lista por id.
     */
    getRoll: async (id: number): Promise<FilmRoll | undefined> => {
        const { items } = await inventoryService.listRolls({ limit: 500 });
        return items.find((roll) => roll.id === id);
    },

    listRollConsumptions: async (rollId: number): Promise<FilmConsumption[]> => {
        const response = await apiClient.get(`/inventory/rolls/${rollId}/consumptions`);
        return response.data ?? [];
    },

    /**
     * Registra uma nova bobina. Quando `force` é falso e existem bobinas críticas
     * pendentes do mesmo tipo/loja, o backend responde 409 + header
     * `X-Has-Critical-Rolls: true`. Nesse caso lançamos `CriticalRollsError` para
     * a tela oferecer "registrar mesmo assim" (chamar com `force = true`).
     * Outros erros propagam inalterados.
     */
    createRoll: async (payload: CreateFilmRollPayload, force = false): Promise<FilmRoll> => {
        try {
            const response = await apiClient.post('/inventory/rolls', payload, {
                params: { force },
            });
            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError;
            const status = axiosError.response?.status;
            // Tratamos 409 como "bobinas críticas pendentes" (paridade com o web,
            // que age só pelo status). O backend acompanha com o header
            // `X-Has-Critical-Rolls: true`; lemos para a mensagem/diagnóstico.
            if (!force && status === 409) {
                throw new CriticalRollsError(undefined, axiosError);
            }
            throw error;
        }
    },

    transferRoll: async (rollId: number, targetStoreId: number): Promise<FilmRoll> => {
        const response = await apiClient.post(`/inventory/rolls/${rollId}/transfer`, {
            target_store_id: targetStoreId,
        });
        return response.data;
    },

    /**
     * Corrige o saldo físico de uma bobina (conferência de estoque). Requer
     * can_edit. O backend valida `remaining_meters` (0 ≤ valor ≤ total_meters) e
     * exige `note`; retorna a bobina atualizada (FilmRollResponse).
     */
    adjustRollMeters: async (id: number, payload: AdjustMetersPayload): Promise<FilmRoll> => {
        const response = await apiClient.patch(`/inventory/rolls/${id}/adjust-meters`, payload);
        return response.data;
    },

    /**
     * Edita os metadados de uma bobina (todos os campos opcionais). Requer
     * can_edit. Alterar `total_meters` não mexe no saldo (recálculo no backend).
     */
    updateRoll: async (id: number, payload: UpdateFilmRollPayload): Promise<FilmRoll> => {
        const response = await apiClient.patch(`/inventory/rolls/${id}`, payload);
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

    openRoll: async (id: number): Promise<FilmRoll> => {
        const response = await apiClient.patch(`/inventory/rolls/${id}/open`);
        return response.data;
    },

    /** Pode responder 409 se a bobina tiver consumos — o erro propaga para a UI. */
    deleteRoll: async (id: number): Promise<void> => {
        await apiClient.delete(`/inventory/rolls/${id}`);
    },

    /** Bobinas em nível crítico (cor vermelha). Sprint 6 — só camada de dados. */
    listCriticalRolls: async (storeId?: number): Promise<FilmRoll[]> => {
        const params: Record<string, number> = {};
        if (storeId) params.store_id = storeId;
        const response = await apiClient.get('/inventory/rolls/critical', { params });
        return response.data ?? [];
    },

    // ─── Film Withdrawals (saída avulsa) ─────────────────────────────────────

    /** Registra uma saída avulsa (baixa de metros de uma bobina p/ um funcionário). */
    createWithdrawal: async (
        payload: CreateFilmWithdrawalPayload
    ): Promise<FilmWithdrawal> => {
        const response = await apiClient.post('/inventory/withdrawals', payload);
        return response.data;
    },

    /** Lista paginada de saídas avulsas (filtros: período/loja/funcionário/tipo). */
    listWithdrawals: async (
        params?: FilmWithdrawalListParams
    ): Promise<FilmWithdrawalListResponse> => {
        const queryParams: Record<string, string | number> = {
            page: params?.page ?? 1,
            limit: params?.limit ?? 20,
        };
        if (params?.store_id) queryParams.store_id = params.store_id;
        if (params?.employee_id) queryParams.employee_id = params.employee_id;
        if (params?.film_type_id) queryParams.film_type_id = params.film_type_id;
        if (params?.date_from) queryParams.date_from = params.date_from;
        if (params?.date_to) queryParams.date_to = params.date_to;
        const response = await apiClient.get('/inventory/withdrawals', { params: queryParams });
        return {
            items: response.data.items ?? [],
            total: response.data.pagination?.total ?? 0,
            total_pages: response.data.pagination?.total_pages ?? 1,
        };
    },

    /** Totais por funcionário no período (exclui estornadas). Sem paginação. */
    getWithdrawalsSummary: async (
        params?: Omit<FilmWithdrawalListParams, 'page' | 'limit'>
    ): Promise<FilmWithdrawalSummaryResponse> => {
        const queryParams: Record<string, string | number> = {};
        if (params?.store_id) queryParams.store_id = params.store_id;
        if (params?.employee_id) queryParams.employee_id = params.employee_id;
        if (params?.film_type_id) queryParams.film_type_id = params.film_type_id;
        if (params?.date_from) queryParams.date_from = params.date_from;
        if (params?.date_to) queryParams.date_to = params.date_to;
        const response = await apiClient.get('/inventory/withdrawals/summary', {
            params: queryParams,
        });
        return {
            items: response.data.items ?? [],
            total_meters: response.data.total_meters ?? 0,
        };
    },

    /** Estorno (soft) de uma saída. Requer permissão inventory:can_delete no backend. */
    reverseWithdrawal: async (withdrawalId: number): Promise<FilmWithdrawal> => {
        const response = await apiClient.post(`/inventory/withdrawals/${withdrawalId}/reverse`);
        return response.data;
    },
};
