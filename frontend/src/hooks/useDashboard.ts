import { useQuery } from '@tanstack/react-query';
import { dashboardService } from '@/services/api/dashboard.service';
import type { DashboardParams } from '@/services/api/dashboard.service';

const STALE_TIME = 60_000;

export function useDashboardOverview(params: DashboardParams) {
  return useQuery({
    queryKey: ['dashboard', 'overview', params],
    queryFn: () => dashboardService.getOverview(params),
    staleTime: STALE_TIME,
    enabled: !!params.start_date && !!params.end_date,
  });
}

export function useDashboardStoresRanking(params: DashboardParams) {
  return useQuery({
    queryKey: ['dashboard', 'stores', params],
    queryFn: () => dashboardService.getStoresRanking(params),
    staleTime: STALE_TIME,
    enabled: !!params.start_date && !!params.end_date,
  });
}

export function useDashboardServicesRanking(
  params: DashboardParams,
  department?: string
) {
  return useQuery({
    queryKey: ['dashboard', 'services', params, department],
    queryFn: () => dashboardService.getServicesRanking({ ...params, department, limit: 10 }),
    staleTime: STALE_TIME,
    enabled: !!params.start_date && !!params.end_date,
  });
}

export function useDashboardDepartmentBreakdown(params: DashboardParams) {
  return useQuery({
    queryKey: ['dashboard', 'departments', params],
    queryFn: () => dashboardService.getDepartmentBreakdown(params),
    staleTime: STALE_TIME,
    enabled: !!params.start_date && !!params.end_date,
  });
}

export function useDashboardEmployeesRanking(
  params: DashboardParams,
  department?: string
) {
  return useQuery({
    queryKey: ['dashboard', 'employees', params, department],
    queryFn: () => dashboardService.getEmployeesRanking({ ...params, department, limit: 20 }),
    staleTime: STALE_TIME,
    enabled: !!params.start_date && !!params.end_date,
  });
}

export function useDashboardConsultantsRanking(params: DashboardParams) {
  return useQuery({
    queryKey: ['dashboard', 'consultants', params],
    queryFn: () => dashboardService.getConsultantsRanking({ ...params, limit: 20 }),
    staleTime: STALE_TIME,
    enabled: !!params.start_date && !!params.end_date,
  });
}

export function useDashboardSla(params: DashboardParams) {
  return useQuery({
    queryKey: ['dashboard', 'sla', params],
    queryFn: () => dashboardService.getSla(params),
    staleTime: STALE_TIME,
    enabled: !!params.start_date && !!params.end_date,
  });
}

export function useDashboardQueue() {
  return useQuery({
    queryKey: ['dashboard', 'queue'],
    queryFn: () => dashboardService.getQueue(),
    staleTime: STALE_TIME,
    // O WebSocket (semaphore_updated) é o invalidador primário; o interval
    // fica só como fallback para conexões WS caídas silenciosamente.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useDashboardTimeseries(
  params: DashboardParams,
  granularity: 'day' | 'week' | 'month'
) {
  return useQuery({
    queryKey: ['dashboard', 'timeseries', params, granularity],
    queryFn: () => dashboardService.getTimeseries({ ...params, granularity }),
    staleTime: STALE_TIME,
    enabled: !!params.start_date && !!params.end_date,
  });
}

export function useDashboardTimeseriesByType(
  params: DashboardParams,
  granularity: 'day' | 'week' | 'month'
) {
  return useQuery({
    queryKey: ['dashboard', 'timeseries-by-type', params, granularity],
    queryFn: () => dashboardService.getTimeseriesByType({ ...params, granularity }),
    staleTime: STALE_TIME,
    enabled: !!params.start_date && !!params.end_date,
  });
}

export function useDashboardFilmPpfRanking(params: DashboardParams) {
  return useQuery({
    queryKey: ['dashboard', 'film-ppf-ranking', params],
    queryFn: () => dashboardService.getFilmPpfRanking(params),
    staleTime: STALE_TIME,
    enabled: !!params.start_date && !!params.end_date,
  });
}
