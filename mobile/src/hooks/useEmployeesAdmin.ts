import { useQuery } from '@tanstack/react-query';

import { employeesService } from '@/services/api/employees.service';

/**
 * Hooks de administração de Funcionários (Fatia 5a). A LISTA reusa `useEmployees`;
 * aqui ficam as leituras específicas do admin: indicadores (stats) e histórico de
 * movimentações. Nenhuma mutação nesta passada.
 *
 * QueryKeys:
 *  - ['employees', 'stats', storeId]      — indicadores de RH
 *  - ['employees', id, 'movements', page] — movimentações (paginado)
 */
export function useEmployeeStats(storeId?: number) {
    return useQuery({
        queryKey: ['employees', 'stats', storeId ?? null],
        queryFn: () => employeesService.getStats(storeId),
        staleTime: 60 * 1000,
    });
}

export function useEmployee(id?: number) {
    return useQuery({
        queryKey: ['employee', id],
        queryFn: () => employeesService.getById(id!),
        enabled: !!id,
        staleTime: 60 * 1000,
    });
}

export function useEmployeeMovements(id?: number, page = 1) {
    return useQuery({
        queryKey: ['employees', id, 'movements', page],
        queryFn: () => employeesService.listMovements(id!, page),
        enabled: !!id,
        staleTime: 60 * 1000,
    });
}
