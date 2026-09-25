import { apiClient } from './client';

/**
 * Desempenho de Instaladores — camada de dados (portado 1:1 de
 * `frontend/src/services/api/installerPerformance.service.ts`).
 *
 * Quatro visões:
 *  - Diário (`getDaily`): produção do dia agrupada por instalador.
 *  - Individual (`getIndividual`): relatório de um instalador num período.
 *  - Resumo (`getSummary`): totais do período + ranking de instaladores.
 *  - Retornos (`getReturns`): O.S. de retorno vinculadas à O.S. de origem.
 *
 * Os exports em PDF NÃO passam por aqui: a tela chama `downloadAndSharePdf`
 * (utils/exportShare) diretamente com o path/params, que baixa o binário e abre
 * o compartilhamento nativo.
 *
 * Serialização de arrays: `employee_ids` precisa virar `employee_ids=1&employee_ids=2`
 * (o backend lê chaves repetidas), por isso `paramsSerializer: { indexes: null }`.
 * Tipos inline aqui (estilo `inventory.service.ts`).
 */

// ─── Diário ───────────────────────────────────────────────────────────────────

export interface DailyVehicleRow {
    os_id: number;
    order_number: string | null;
    external_os_number: string | null;
    plate: string;
    vehicle: string | null;
    store_name: string | null;
    services: string[];
    is_courtesy: boolean;
    /** Algum serviço feito por mais de um instalador (produção dividida). */
    has_shared: boolean;
    value: number;
}

export interface DailyInstallerGroup {
    employee_id: number;
    employee_name: string;
    vehicles: DailyVehicleRow[];
    total_cars: number;
    total_revenue: number;
}

export interface DailyReportResponse {
    report_date: string;
    store_name: string | null;
    groups: DailyInstallerGroup[];
    grand_total_cars: number;
    grand_total_revenue: number;
}

// ─── Individual ─────────────────────────────────────────────────────────────

export interface IndividualServiceRow {
    completion_date: string;
    os_id: number;
    order_number: string | null;
    external_os_number: string | null;
    plate: string;
    vehicle: string | null;
    store_name: string | null;
    services: string[];
    is_courtesy: boolean;
    is_return: boolean;
    /** Algum serviço feito por mais de um instalador (produção dividida). */
    has_shared: boolean;
    value: number;
    points: number;
}

export interface IndividualReportResponse {
    employee_id: number;
    employee_name: string;
    period_start: string;
    period_end: string;
    store_name: string | null;
    total_cars: number;
    /** Fracionado: serviço compartilhado entre K instaladores conta 1/K. */
    total_services: number;
    total_revenue: number;
    total_points: number;
    rows: IndividualServiceRow[];
}

// ─── Resumo ───────────────────────────────────────────────────────────────

export interface SummaryRankingRow {
    employee_id: number;
    employee_name: string;
    orders_count: number;
    services_count: number;
    cars_count: number;
    points: number;
    revenue: number;
}

export interface SummaryTotals {
    total_cars: number;
    total_services: number;
    total_points: number;
    total_revenue: number;
    film_cost: number;
}

export interface SummaryReportResponse {
    period_start: string;
    period_end: string;
    store_name: string | null;
    totals: SummaryTotals;
    rows: SummaryRankingRow[];
}

// ─── Retornos ─────────────────────────────────────────────────────────────

export interface ReturnRow {
    return_os_id: number;
    return_date: string;
    return_workers: string[];
    return_notes: string | null;
    return_services: string[];
    origin_os_id: number | null;
    origin_date: string | null;
    origin_workers: string[];
    origin_notes: string | null;
    origin_services: string[];
    model: string | null;
    chassis: string | null;
    color: string | null;
}

export interface ReturnsReportResponse {
    period_start: string;
    period_end: string;
    store_name: string | null;
    rows: ReturnRow[];
}

// ─── Filtros ────────────────────────────────────────────────────────────────

export interface DailyFilters {
    date: string;
    store_id?: number;
    employee_ids?: number[];
}

export interface IndividualFilters {
    start: string;
    end: string;
    employee_id: number;
    store_id?: number;
}

export interface SummaryFilters {
    start: string;
    end: string;
    store_id?: number | null;
}

export interface ReturnsFilters {
    start: string;
    end: string;
    store_id?: number | null;
}

function buildDailyParams(filters: DailyFilters): Record<string, unknown> {
    const params: Record<string, unknown> = { date: filters.date };
    if (filters.store_id != null) params.store_id = filters.store_id;
    if (filters.employee_ids && filters.employee_ids.length > 0) {
        params.employee_ids = filters.employee_ids;
    }
    return params;
}

function buildIndividualParams(filters: IndividualFilters): Record<string, string | number> {
    const params: Record<string, string | number> = {
        start: filters.start,
        end: filters.end,
        employee_id: filters.employee_id,
    };
    if (filters.store_id != null) params.store_id = filters.store_id;
    return params;
}

function buildSummaryParams(filters: SummaryFilters): Record<string, string | number> {
    const params: Record<string, string | number> = {
        start: filters.start,
        end: filters.end,
    };
    if (filters.store_id != null) params.store_id = filters.store_id;
    return params;
}

function buildReturnsParams(filters: ReturnsFilters): Record<string, string | number> {
    const params: Record<string, string | number> = {
        start: filters.start,
        end: filters.end,
    };
    if (filters.store_id != null) params.store_id = filters.store_id;
    return params;
}

export const installerPerformanceService = {
    getDaily: async (filters: DailyFilters): Promise<DailyReportResponse> => {
        const response = await apiClient.get('/installer-performance/daily', {
            params: buildDailyParams(filters),
            paramsSerializer: { indexes: null },
        });
        return response.data;
    },

    getIndividual: async (filters: IndividualFilters): Promise<IndividualReportResponse> => {
        const response = await apiClient.get('/installer-performance/individual', {
            params: buildIndividualParams(filters),
        });
        return response.data;
    },

    getSummary: async (filters: SummaryFilters): Promise<SummaryReportResponse> => {
        const response = await apiClient.get('/installer-performance/summary', {
            params: buildSummaryParams(filters),
        });
        return response.data;
    },

    getReturns: async (filters: ReturnsFilters): Promise<ReturnsReportResponse> => {
        const response = await apiClient.get('/installer-performance/returns', {
            params: buildReturnsParams(filters),
        });
        return response.data;
    },
};

export default installerPerformanceService;
