import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { brandsService } from '@/services/api/brands.service';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/api-error';

/**
 * Marcas (Admin — Fatia 5b). Lista TODAS as marcas (inclusive inativas) e expõe
 * o toggle de `is_active`. QueryKey ['brands-admin'] separada de ['brands'] (que
 * serve os pickers com `select: items`); ao alternar, invalidamos ambas.
 */
export function useBrandsAdmin() {
    return useQuery({
        queryKey: ['brands-admin'],
        queryFn: () => brandsService.list(),
        select: (data) => data.items,
        staleTime: 60 * 1000,
    });
}

export function useToggleBrandActive() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
            isActive ? brandsService.activate(id) : brandsService.deactivate(id),
        onSuccess: (_data, { isActive }) => {
            queryClient.invalidateQueries({ queryKey: ['brands-admin'] });
            queryClient.invalidateQueries({ queryKey: ['brands'] });
            toast.success(isActive ? 'Marca ativada.' : 'Marca desativada.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao atualizar a marca.'));
        },
    });
}
