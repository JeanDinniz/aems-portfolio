import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api-error';
import { epiService } from '@/services/api/epi.service';
import type {
    CreateCargoMapPayload,
    CreateDeliveryPayload,
    CreateEPIPayload,
    PendenciaEstado,
    UpdateEPIPayload,
} from '@/types/epi.types';

// ---- Catálogo ----
export function useEpiCatalog(page = 1, onlyActive = true) {
    return useQuery({
        queryKey: ['epi-catalog', page, onlyActive],
        queryFn: () => epiService.listCatalog({ page, limit: 100, only_active: onlyActive }),
    });
}

export function useEpiCatalogMutations() {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['epi-catalog'] });

    const create = useMutation({
        mutationFn: (payload: CreateEPIPayload) => epiService.createEpi(payload),
        onSuccess: () => { invalidate(); toast({ title: 'EPI cadastrado' }); },
        onError: (e: Error) => toast({ variant: 'destructive', title: 'Erro ao cadastrar', description: getApiErrorMessage(e) }),
    });
    const update = useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: UpdateEPIPayload }) => epiService.updateEpi(id, payload),
        onSuccess: () => { invalidate(); toast({ title: 'EPI atualizado' }); },
        onError: (e: Error) => toast({ variant: 'destructive', title: 'Erro ao atualizar', description: getApiErrorMessage(e) }),
    });
    const deactivate = useMutation({
        mutationFn: (id: number) => epiService.deactivateEpi(id),
        onSuccess: () => { invalidate(); toast({ title: 'EPI desativado' }); },
        onError: (e: Error) => toast({ variant: 'destructive', title: 'Erro ao desativar', description: getApiErrorMessage(e) }),
    });
    return { create, update, deactivate };
}

// ---- Mapeamento cargo -> EPI ----
export function useCargoMap(cargo?: string) {
    return useQuery({
        queryKey: ['epi-cargo-map', cargo ?? null],
        queryFn: () => epiService.listCargoMap({ cargo, limit: 500 }),
    });
}

export function useCargoMapMutations() {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['epi-cargo-map'] });

    const create = useMutation({
        mutationFn: (payload: CreateCargoMapPayload) => epiService.createCargoMap(payload),
        onSuccess: () => { invalidate(); toast({ title: 'EPI vinculado ao cargo' }); },
        onError: (e: Error) => toast({ variant: 'destructive', title: 'Erro ao vincular', description: getApiErrorMessage(e) }),
    });
    const remove = useMutation({
        mutationFn: (id: number) => epiService.deleteCargoMap(id),
        onSuccess: () => { invalidate(); toast({ title: 'Vínculo removido' }); },
        onError: (e: Error) => toast({ variant: 'destructive', title: 'Erro ao remover', description: getApiErrorMessage(e) }),
    });
    return { create, remove };
}

// ---- Entregas ----
export function useDeliveries(employeeId?: number, page = 1) {
    return useQuery({
        queryKey: ['epi-deliveries', employeeId ?? null, page],
        queryFn: () => epiService.listDeliveries({ employee_id: employeeId, page, limit: 50 }),
        enabled: employeeId !== undefined,
    });
}

export function useCreateDelivery() {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: (payload: CreateDeliveryPayload) => epiService.createDelivery(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['epi-deliveries'] });
            queryClient.invalidateQueries({ queryKey: ['epi-pendencias'] });
            toast({ title: 'Entrega registrada', description: 'Assinatura salva com sucesso.' });
        },
        onError: (e: Error) => toast({ variant: 'destructive', title: 'Erro ao registrar entrega', description: getApiErrorMessage(e) }),
    });
}

// ---- Pendências ----
export function usePendencias(estado?: PendenciaEstado, storeIds?: number[]) {
    return useQuery({
        queryKey: ['epi-pendencias', estado ?? null, storeIds ?? null],
        queryFn: () => epiService.listPendencias({ estado, store_ids: storeIds }),
    });
}
