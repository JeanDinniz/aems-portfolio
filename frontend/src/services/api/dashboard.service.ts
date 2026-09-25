import apiClient from './client';
import type {
  DashboardOverview,
  StoreRankingItem,
  ServiceRankingItem,
  DepartmentBreakdownItem,
  EmployeeRankingItem,
  TimeSeriesByTypePoint,
  RevenueForecast,
  FilmPpfStoreRankingItem,
  DealershipRankingItem,
} from '@/types/dashboard.types';

export interface DashboardParams {
  start_date: string;
  end_date: string;
  store_id?: number;
}

export const dashboardService = {
  getOverview: (params: DashboardParams) =>
    apiClient.get<DashboardOverview>('/analytics/dashboard/overview', { params }).then((r) => r.data),

  getStoresRanking: (params: DashboardParams) =>
    apiClient.get<StoreRankingItem[]>('/analytics/dashboard/stores', { params }).then((r) => r.data),

  getServicesRanking: (params: DashboardParams & { department?: string; limit?: number }) =>
    apiClient.get<ServiceRankingItem[]>('/analytics/dashboard/services', { params }).then((r) => r.data),

  getDepartmentBreakdown: (params: DashboardParams) =>
    apiClient.get<DepartmentBreakdownItem[]>('/analytics/dashboard/departments', { params }).then((r) => r.data),

  getEmployeesRanking: ({
    departments,
    ...params
  }: DashboardParams & { departments?: string[]; limit?: number }) => {
    // Lista vira parâmetro repetido (?departments=a&departments=b) — padrão FastAPI
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) searchParams.append(k, String(v));
    });
    (departments ?? []).forEach((d) => searchParams.append('departments', d));
    return apiClient
      .get<EmployeeRankingItem[]>(`/analytics/dashboard/employees?${searchParams.toString()}`)
      .then((r) => r.data);
  },

  getTimeseriesByType: (params: DashboardParams & { granularity: 'day' | 'week' | 'month' }) =>
    apiClient.get<TimeSeriesByTypePoint[]>('/analytics/dashboard/timeseries-by-type', { params }).then((r) => r.data),

  getFilmPpfRanking: (params: DashboardParams) =>
    apiClient.get<FilmPpfStoreRankingItem[]>('/analytics/dashboard/film-ppf-ranking', { params }).then((r) => r.data),

  getDealershipsRanking: (params: DashboardParams & { limit?: number }) =>
    apiClient.get<DealershipRankingItem[]>('/analytics/dashboard/dealerships', { params }).then((r) => r.data),

  // Previsão do mês corrente — só filtro de loja (período não se aplica)
  getRevenueForecast: (storeId?: number) =>
    apiClient
      .get<RevenueForecast>('/analytics/dashboard/revenue-forecast', {
        params: storeId != null ? { store_id: storeId } : {},
      })
      .then((r) => r.data),
};
