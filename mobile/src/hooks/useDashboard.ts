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
 *  - ['dashboard','consultants', params]
 *  - ['dashboard','sla', params]
 *  - ['dashboard','queue']                         ← SEM params (ver nota)
 *  - ['dashboard','timeseries', params, granularity]
 *  - ['dashboard','timeseries-by-type', params, granularity]
 *  - ['dashboard','film-ppf-ranking', params]
 *
 * `staleTime` 60s em todos. Tudo (exceto a fila) só dispara com período definido
 * (`enabled: !!start_date && !!end_date`).
 *
 * NOTA sobre a fila: a queryKey é fixa `['dashboard','queue']` (sem params)
 * porque o `useWebSocket` mobile já invalida exatamente essa key no evento
 * `semaphore_updated`. O `storeId` é repassado ao service via closure no queryFn,
 * mantendo a key estável para a invalidação em tempo real.
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

export function useDashboardConsultantsRanking(params: DashboardParams) {
    return useQuery({
        queryKey: ['dashboard', 'consultants', params],
        queryFn: () => analyticsService.getConsultantsRanking({ ...params, limit: 10 }),
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

/**
 * Fila ao vivo. QueryKey fixa `['dashboard','queue']` (sem params) para casar com
 * a invalidação do WebSocket. Atualiza a cada 30s, mas só em foreground.
 */
export function useDashboardQueue(storeId?: number) {
    return useQuery({
        queryKey: ['dashboard', 'queue'],
        queryFn: () => analyticsService.getQueue(storeId),
        staleTime: STALE,
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
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
