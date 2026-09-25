import { apiClient } from './client';
import type {
    DashboardOverview,
    StoreRankingItem,
    ServiceRankingItem,
    DepartmentBreakdownItem,
    EmployeeRankingItem,
    SLAMetrics,
    TimeSeriesPoint,
    TimeSeriesByTypePoint,
    FilmPpfStoreRankingItem,
} from '@/types/dashboard.types';

/**
 * Portado de frontend/src/services/api/dashboard.service.ts.
 * Camada de dados do Dashboard executivo (analytics).
 *
 * `start_date`/`end_date` são datetime ISO OBRIGATÓRIOS — enviamos "YYYY-MM-DD"
 * (o FastAPI parseia). `store_id` opcional: omitir = todas as lojas.
 *
 * `getTimeseries*` e `getFilmPpfRanking` só serão consumidos na Fatia 3b
 * (gráficos via dev build), mas a camada de dados já fica pronta aqui.
 */

export type DashboardGranularity = 'day' | 'week' | 'month';

export interface DashboardParams {
    start_date: string;
    end_date: string;
    store_id?: number;
}

export const analyticsService = {
    getOverview: async (params: DashboardParams): Promise<DashboardOverview> => {
        const response = await apiClient.get('/analytics/dashboard/overview', { params });
        return response.data;
    },

    getStoresRanking: async (params: DashboardParams): Promise<StoreRankingItem[]> => {
        const response = await apiClient.get('/analytics/dashboard/stores', { params });
        return response.data;
    },

    getServicesRanking: async (
        params: DashboardParams & { department?: string; limit?: number }
    ): Promise<ServiceRankingItem[]> => {
        const response = await apiClient.get('/analytics/dashboard/services', { params });
        return response.data;
    },

    getDepartmentBreakdown: async (
        params: DashboardParams
    ): Promise<DepartmentBreakdownItem[]> => {
        const response = await apiClient.get('/analytics/dashboard/departments', { params });
        return response.data;
    },

    getEmployeesRanking: async (
        params: DashboardParams & { department?: string; limit?: number }
    ): Promise<EmployeeRankingItem[]> => {
        const response = await apiClient.get('/analytics/dashboard/employees', { params });
        return response.data;
    },

    getSla: async (params: DashboardParams): Promise<SLAMetrics> => {
        const response = await apiClient.get('/analytics/dashboard/sla', { params });
        return response.data;
    },

    getTimeseries: async (
        params: DashboardParams & { granularity: DashboardGranularity }
    ): Promise<TimeSeriesPoint[]> => {
        const response = await apiClient.get('/analytics/dashboard/timeseries', { params });
        return response.data;
    },

    getTimeseriesByType: async (
        params: DashboardParams & { granularity: DashboardGranularity }
    ): Promise<TimeSeriesByTypePoint[]> => {
        const response = await apiClient.get('/analytics/dashboard/timeseries-by-type', {
            params,
        });
        return response.data;
    },

    getFilmPpfRanking: async (params: DashboardParams): Promise<FilmPpfStoreRankingItem[]> => {
        const response = await apiClient.get('/analytics/dashboard/film-ppf-ranking', { params });
        return response.data;
    },
};
