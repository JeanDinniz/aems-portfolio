import apiClient from './client';
import type {
    DailyReportResponse,
    IndividualReportResponse,
    SummaryReportResponse,
    ReturnsReportResponse,
    DailyFilters,
    IndividualFilters,
    SummaryFilters,
    ReturnsFilters,
} from '@/types/installerPerformance.types';

function buildDailyParams(filters: DailyFilters): Record<string, unknown> {
    const params: Record<string, unknown> = { date: filters.date };
    if (filters.store_id != null) params.store_id = filters.store_id;
    if (filters.employee_ids && filters.employee_ids.length > 0) params.employee_ids = filters.employee_ids;
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

const installerPerformanceService = {
    getDaily: async (filters: DailyFilters): Promise<DailyReportResponse> =>
        apiClient
            .get('/installer-performance/daily', {
                params: buildDailyParams(filters),
                paramsSerializer: { indexes: null },
            })
            .then((r) => r.data),

    getIndividual: async (filters: IndividualFilters): Promise<IndividualReportResponse> =>
        apiClient
            .get('/installer-performance/individual', { params: buildIndividualParams(filters) })
            .then((r) => r.data),

    exportDaily: async (filters: DailyFilters): Promise<Blob> =>
        apiClient
            .get('/installer-performance/export/daily', {
                params: buildDailyParams(filters),
                paramsSerializer: { indexes: null },
                responseType: 'blob',
            })
            .then((r) => r.data),

    exportIndividual: async (filters: IndividualFilters): Promise<Blob> =>
        apiClient
            .get('/installer-performance/export/individual', {
                params: buildIndividualParams(filters),
                responseType: 'blob',
            })
            .then((r) => r.data),

    getSummary: async (filters: SummaryFilters): Promise<SummaryReportResponse> =>
        apiClient
            .get('/installer-performance/summary', { params: buildSummaryParams(filters) })
            .then((r) => r.data),

    exportSummary: async (filters: SummaryFilters): Promise<Blob> =>
        apiClient
            .get('/installer-performance/export/summary', {
                params: buildSummaryParams(filters),
                responseType: 'blob',
            })
            .then((r) => r.data),

    getReturns: async (filters: ReturnsFilters): Promise<ReturnsReportResponse> =>
        apiClient
            .get('/installer-performance/returns', { params: buildReturnsParams(filters) })
            .then((r) => r.data),

    exportReturns: async (filters: ReturnsFilters): Promise<Blob> =>
        apiClient
            .get('/installer-performance/export/returns', {
                params: buildReturnsParams(filters),
                responseType: 'blob',
            })
            .then((r) => r.data),
};

export default installerPerformanceService;
