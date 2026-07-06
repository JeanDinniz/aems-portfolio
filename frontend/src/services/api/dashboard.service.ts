import apiClient from './client';
import type {
  DashboardOverview,
  StoreRankingItem,
  ServiceRankingItem,
  DepartmentBreakdownItem,
  EmployeeRankingItem,
  ConsultantRankingItem,
  SLAMetrics,
  QueueSnapshotItem,
  TimeSeriesPoint,
  TimeSeriesByTypePoint,
  FilmPpfStoreRankingItem,
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

  getEmployeesRanking: (params: DashboardParams & { department?: string; limit?: number }) =>
    apiClient.get<EmployeeRankingItem[]>('/analytics/dashboard/employees', { params }).then((r) => r.data),

  getConsultantsRanking: (params: DashboardParams & { limit?: number }) =>
    apiClient.get<ConsultantRankingItem[]>('/analytics/dashboard/consultants', { params }).then((r) => r.data),

  getSla: (params: DashboardParams) =>
    apiClient.get<SLAMetrics>('/analytics/dashboard/sla', { params }).then((r) => r.data),

  getQueue: () =>
    apiClient.get<QueueSnapshotItem[]>('/analytics/dashboard/queue').then((r) => r.data),

  getTimeseries: (params: DashboardParams & { granularity: 'day' | 'week' | 'month' }) =>
    apiClient.get<TimeSeriesPoint[]>('/analytics/dashboard/timeseries', { params }).then((r) => r.data),

  getTimeseriesByType: (params: DashboardParams & { granularity: 'day' | 'week' | 'month' }) =>
    apiClient.get<TimeSeriesByTypePoint[]>('/analytics/dashboard/timeseries-by-type', { params }).then((r) => r.data),

  getFilmPpfRanking: (params: DashboardParams) =>
    apiClient.get<FilmPpfStoreRankingItem[]>('/analytics/dashboard/film-ppf-ranking', { params }).then((r) => r.data),
};
