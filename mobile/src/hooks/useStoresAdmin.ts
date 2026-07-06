import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { storesService } from '@/services/api/stores.service';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/api-error';

/**
 * Hooks de administração de Lojas (Fatia 5a) — SEPARADO do `useStores`, que serve
 * o seletor de loja global. Aqui listamos TODAS as lojas (inclusive inativas) e
 * expomos o toggle de `is_active`.
 *
 * QueryKey ['stores-admin']. Ao alternar, invalidamos também ['stores'] para o
 * seletor global refletir mudanças de disponibilidade.
 */
export function useStoresAdmin() {
    return useQuery({
        queryKey: ['stores-admin'],
        queryFn: () => storesService.list(),
        staleTime: 60 * 1000,
    });
}

export function useToggleStoreActive() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
            storesService.update(id, { is_active: isActive }),
        onSuccess: (_data, { isActive }) => {
            queryClient.invalidateQueries({ queryKey: ['stores-admin'] });
            queryClient.invalidateQueries({ queryKey: ['stores'] });
            toast.success(isActive ? 'Loja ativada.' : 'Loja desativada.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao atualizar a loja.'));
        },
    });
}
