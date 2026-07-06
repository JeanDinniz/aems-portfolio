import { useQuery } from '@tanstack/react-query';

import { employeesService } from '@/services/api/employees.service';
import { useStoreStore } from '@/stores/store.store';
import type { EmployeeFilters } from '@/types/employee.types';

/**
 * Funcionários para pickers de O.S. (leitura). Portado/adaptado de
 * frontend/src/hooks/useEmployees.ts — só os helpers usados nos fluxos de O.S.
 *
 * Regra de loja: `store_id` explícito do form tem precedência; quando ausente,
 * cai para a loja selecionada globalmente. `null` = Todas as Lojas.
 */
export function useEmployees(filters?: EmployeeFilters, page = 1, pageSize = 200) {
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);
    const storeId = filters?.store_id ?? selectedStoreId ?? undefined;
    const effectiveFilters: EmployeeFilters = {
        is_active: true,
        ...filters,
        store_id: storeId,
    };

    const query = useQuery({
        queryKey: ['employees', effectiveFilters, page, pageSize],
        queryFn: () => employeesService.list(effectiveFilters, page, pageSize),
        staleTime: 1000 * 60 * 5,
    });

    return {
        ...query,
        employees: query.data?.employees ?? [],
        total: query.data?.total ?? 0,
    };
}

/** Funcionários ativos de uma loja específica. */
export function useEmployeesByStore(storeId: number | undefined) {
    return useQuery({
        queryKey: ['employees', 'by-store', storeId],
        queryFn: () => employeesService.listByStore(storeId!),
        enabled: !!storeId,
        staleTime: 1000 * 60 * 5,
    });
}

/** Funcionários ativos de uma loja filtrados por departamento. */
export function useEmployeesByDepartment(
    storeId: number | undefined,
    department: string | undefined
) {
    return useQuery({
        queryKey: ['employees', 'by-department', storeId, department],
        queryFn: () => employeesService.listByStoreAndDepartment(storeId!, department),
        enabled: !!(storeId && department),
        staleTime: 1000 * 60 * 5,
    });
}

/**
 * Instaladores de película de todas as lojas. Espelha o web: filtra por
 * departamento `film` no backend (o parâmetro `department` é mantido na
 * assinatura por paridade, mas o backend usa `film` para película/PPF).
 */
export function useFilmInstallers(department: 'film' | 'security_film' | 'ppf') {
    return useQuery({
        queryKey: ['employees', 'film-installers', department],
        queryFn: () => employeesService.listByDepartmentAllStores('film'),
        staleTime: 5 * 60 * 1000,
    });
}

/** Funcionários habilitados para o galpão. */
export function useGalponEmployees() {
    return useQuery({
        queryKey: ['employees', 'galpon'],
        queryFn: () => employeesService.listForGalpon(),
        staleTime: 5 * 60 * 1000,
    });
}
