import { useQuery } from '@tanstack/react-query';

import { installerPerformanceService } from '@/services/api/installer-performance.service';
import type {
    DailyFilters,
    IndividualFilters,
    SummaryFilters,
    ReturnsFilters,
} from '@/services/api/installer-performance.service';

/**
 * Desempenho de Instaladores — hooks TanStack Query (portado de
 * `frontend/src/hooks/useInstallerPerformance.ts`).
 *
 * QueryKeys: `['installer-performance','daily'|'individual'|'summary'|'returns',filters]`.
 * O individual só dispara com um instalador selecionado (`enabled`).
 */
export function useInstallerDaily(filters: DailyFilters) {
    return useQuery({
        queryKey: ['installer-performance', 'daily', filters],
        queryFn: () => installerPerformanceService.getDaily(filters),
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 10,
    });
}

export function useInstallerIndividual(filters: IndividualFilters | null) {
    return useQuery({
        queryKey: ['installer-performance', 'individual', filters],
        queryFn: () => installerPerformanceService.getIndividual(filters!),
        enabled: filters !== null && !!filters.employee_id,
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 10,
    });
}

export function useInstallerSummary(filters: SummaryFilters) {
    return useQuery({
        queryKey: ['installer-performance', 'summary', filters],
        queryFn: () => installerPerformanceService.getSummary(filters),
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 10,
    });
}

export function useInstallerReturns(filters: ReturnsFilters) {
    return useQuery({
        queryKey: ['installer-performance', 'returns', filters],
        queryFn: () => installerPerformanceService.getReturns(filters),
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 10,
    });
}
