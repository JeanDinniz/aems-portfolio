import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { servicesService, type ServiceListParams } from '@/services/api/services.service';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/api-error';

/**
 * Serviços do catálogo (Admin — Fatia 5b). Lista com filtros (marca/departamento/
 * status/busca) e expõe o toggle de `is_active`. QueryKey ['services-admin', ...]
 * separada de ['services'] (pickers). Ao alternar, invalidamos ambas.
 */
export function useServicesAdmin(params?: ServiceListParams) {
    return useQuery({
        queryKey: ['services-admin', params],
        queryFn: () => servicesService.list(params),
        select: (data) => data.items,
        staleTime: 60 * 1000,
    });
}

export function useToggleServiceActive() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
            isActive ? servicesService.activate(id) : servicesService.deactivate(id),
        onSuccess: (_data, { isActive }) => {
            queryClient.invalidateQueries({ queryKey: ['services-admin'] });
            queryClient.invalidateQueries({ queryKey: ['services'] });
            toast.success(isActive ? 'Serviço ativado.' : 'Serviço desativado.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao atualizar o serviço.'));
        },
    });
}
