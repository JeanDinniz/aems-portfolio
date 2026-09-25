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
  departments?: string[]
) {
  return useQuery({
    queryKey: ['dashboard', 'employees', params, departments],
    queryFn: () => dashboardService.getEmployeesRanking({ ...params, departments, limit: 20 }),
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

export function useDashboardDealershipsRanking(params: DashboardParams) {
  return useQuery({
    queryKey: ['dashboard', 'dealerships', params],
    queryFn: () => dashboardService.getDealershipsRanking({ ...params, limit: 20 }),
    staleTime: STALE_TIME,
    enabled: !!params.start_date && !!params.end_date,
  });
}

/**
 * Previsão de faturamento do mês corrente (run-rate por dias úteis).
 * Ignora o filtro de período de propósito — só a loja se aplica.
 */
export function useDashboardRevenueForecast(storeId: number | null) {
  return useQuery({
    queryKey: ['dashboard', 'revenue-forecast', storeId],
    queryFn: () => dashboardService.getRevenueForecast(storeId ?? undefined),
    staleTime: STALE_TIME,
  });
}
