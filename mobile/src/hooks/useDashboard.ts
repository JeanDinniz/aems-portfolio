import { useQuery } from '@tanstack/react-query';

import { analyticsService } from '@/services/api/analytics.service';
import type { DashboardParams, DashboardGranularity } from '@/services/api/analytics.service';

/**
 * Hooks do Dashboard executivo (Fatia 3a) — paridade de queryKeys com o web.
 *
 * QueryKeys:
 *  - ['dashboard','overview', params]
 *  - ['dashboard','stores', params]
 *  - ['dashboard','services', params, department]
 *  - ['dashboard','departments', params]
 *  - ['dashboard','employees', params, department]
 *  - ['dashboard','sla', params]
 *  - ['dashboard','timeseries', params, granularity]
 *  - ['dashboard','timeseries-by-type', params, granularity]
 *  - ['dashboard','film-ppf-ranking', params]
 *
 * `staleTime` 60s em todos. Tudo só dispara com período definido
 * (`enabled: !!start_date && !!end_date`).
 */

const STALE = 60_000;

export function useDashboardOverview(params: DashboardParams) {
    return useQuery({
        queryKey: ['dashboard', 'overview', params],
        queryFn: () => analyticsService.getOverview(params),
        enabled: !!params.start_date && !!params.end_date,
        staleTime: STALE,
    });
}

export function useDashboardStoresRanking(params: DashboardParams) {
    return useQuery({
        queryKey: ['dashboard', 'stores', params],
        queryFn: () => analyticsService.getStoresRanking(params),
        enabled: !!params.start_date && !!params.end_date,
        staleTime: STALE,
    });
}

export function useDashboardServicesRanking(params: DashboardParams, department?: string) {
    return useQuery({
        queryKey: ['dashboard', 'services', params, department],
        queryFn: () => analyticsService.getServicesRanking({ ...params, department, limit: 10 }),
        enabled: !!params.start_date && !!params.end_date,
        staleTime: STALE,
    });
}

export function useDashboardDepartmentBreakdown(params: DashboardParams) {
    return useQuery({
        queryKey: ['dashboard', 'departments', params],
        queryFn: () => analyticsService.getDepartmentBreakdown(params),
        enabled: !!params.start_date && !!params.end_date,
        staleTime: STALE,
    });
}

export function useDashboardEmployeesRanking(params: DashboardParams, department?: string) {
    return useQuery({
        queryKey: ['dashboard', 'employees', params, department],
        queryFn: () => analyticsService.getEmployeesRanking({ ...params, department, limit: 10 }),
        enabled: !!params.start_date && !!params.end_date,
        staleTime: STALE,
    });
}

export function useDashboardSla(params: DashboardParams) {
    return useQuery({
        queryKey: ['dashboard', 'sla', params],
        queryFn: () => analyticsService.getSla(params),
        enabled: !!params.start_date && !!params.end_date,
        staleTime: STALE,
    });
}

export function useDashboardTimeseries(params: DashboardParams, granularity: DashboardGranularity) {
    return useQuery({
        queryKey: ['dashboard', 'timeseries', params, granularity],
        queryFn: () => analyticsService.getTimeseries({ ...params, granularity }),
        enabled: !!params.start_date && !!params.end_date,
        staleTime: STALE,
    });
}

export function useDashboardTimeseriesByType(
    params: DashboardParams,
    granularity: DashboardGranularity
) {
    return useQuery({
        queryKey: ['dashboard', 'timeseries-by-type', params, granularity],
        queryFn: () => analyticsService.getTimeseriesByType({ ...params, granularity }),
        enabled: !!params.start_date && !!params.end_date,
        staleTime: STALE,
    });
}

export function useDashboardFilmPpfRanking(params: DashboardParams) {
    return useQuery({
        queryKey: ['dashboard', 'film-ppf-ranking', params],
        queryFn: () => analyticsService.getFilmPpfRanking(params),
        enabled: !!params.start_date && !!params.end_date,
        staleTime: STALE,
    });
}
