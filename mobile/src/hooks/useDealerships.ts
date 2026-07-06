import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dealershipsService } from '@/services/api/dealerships.service';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/api-error';
import type { DealershipFilters } from '@/types/dealership.types';

/**
 * Concessionárias (Admin — Fatia 5b). Lista + ativar/desativar (soft delete).
 * Sem submódulo de permissão — a tela gateia por `isOwner()`; o backend exige
 * Owner nas mutações. QueryKey ['dealerships', filters].
 */
export function useDealerships(filters?: DealershipFilters) {
    return useQuery({
        queryKey: ['dealerships', filters],
        queryFn: () => dealershipsService.list(filters),
        select: (data) => data.items,
        staleTime: 60 * 1000,
    });
}

export function useToggleDealershipActive() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
            isActive ? dealershipsService.activate(id) : dealershipsService.deactivate(id),
        onSuccess: (_data, { isActive }) => {
            queryClient.invalidateQueries({ queryKey: ['dealerships'] });
            toast.success(isActive ? 'Concessionária ativada.' : 'Concessionária desativada.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao atualizar a concessionária.'));
        },
    });
}
