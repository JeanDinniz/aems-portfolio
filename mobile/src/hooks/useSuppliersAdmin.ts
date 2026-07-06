import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { suppliersService } from '@/services/api/suppliers.service';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/api-error';

/**
 * Fornecedores (Admin — Fatia 5b). Lista com busca server-side e expõe o toggle
 * de `is_active`. Não há submódulo de permissão `suppliers` — a tela gateia por
 * `isOwner()`; o backend também exige Owner nas mutações. QueryKey
 * ['suppliers-admin', search]; ao alternar invalidamos também ['suppliers']
 * (picker da entrada de bobina — INV-04).
 */
export function useSuppliersAdmin(search?: string) {
    return useQuery({
        queryKey: ['suppliers-admin', search],
        queryFn: () => suppliersService.list({ search }),
        select: (data) => data.items,
        staleTime: 60 * 1000,
    });
}

export function useToggleSupplierActive() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
            isActive ? suppliersService.activate(id) : suppliersService.deactivate(id),
        onSuccess: (_data, { isActive }) => {
            queryClient.invalidateQueries({ queryKey: ['suppliers-admin'] });
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            toast.success(isActive ? 'Fornecedor ativado.' : 'Fornecedor desativado.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao atualizar o fornecedor.'));
        },
    });
}
