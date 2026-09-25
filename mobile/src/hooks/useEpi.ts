import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { epiService } from '@/services/api/epi.service';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/api-error';
import type {
    CreateCargoMapPayload,
    CreateEPIPayload,
    PendenciaEstado,
    UpdateEPIPayload,
} from '@/types/epi.types';

/**
 * Controle de EPIs — hooks TanStack Query v5 (portado de
 * `frontend/src/hooks/useEpi.ts`). QueryKeys idênticas ao web
 * (`['epi-catalog']`, `['epi-cargo-map']`, `['epi-deliveries']`,
 * `['epi-pendencias']`) para invalidação em cascata consistente.
 */

// ── Catálogo ──────────────────────────────────────────────────────
export function useEpiCatalog(page = 1, onlyActive = true) {
    return useQuery({
        queryKey: ['epi-catalog', page, onlyActive],
        queryFn: () => epiService.listCatalog({ page, limit: 100, only_active: onlyActive }),
        staleTime: 1000 * 60 * 5,
    });
}

export function useEpiCatalogMutations() {
    const queryClient = useQueryClient();
    const toast = useToast();
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['epi-catalog'] });

    const create = useMutation({
        mutationFn: (payload: CreateEPIPayload) => epiService.createEpi(payload),
        onSuccess: () => {
            invalidate();
            toast.success('EPI cadastrado.');
        },
        onError: (e: Error) =>
            toast.error(getApiErrorMessage(e, 'Não foi possível cadastrar o EPI.')),
    });

    const update = useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: UpdateEPIPayload }) =>
            epiService.updateEpi(id, payload),
        onSuccess: () => {
            invalidate();
            toast.success('EPI atualizado.');
        },
        onError: (e: Error) =>
            toast.error(getApiErrorMessage(e, 'Não foi possível atualizar o EPI.')),
    });

    const deactivate = useMutation({
        mutationFn: (id: number) => epiService.deactivateEpi(id),
        onSuccess: () => {
            invalidate();
            queryClient.invalidateQueries({ queryKey: ['epi-cargo-map'] });
            queryClient.invalidateQueries({ queryKey: ['epi-pendencias'] });
            toast.success('EPI desativado.');
        },
        onError: (e: Error) =>
            toast.error(getApiErrorMessage(e, 'Não foi possível desativar o EPI.')),
    });

    return { create, update, deactivate };
}

// ── Mapeamento cargo -> EPI ───────────────────────────────────────
export function useCargoMap(cargo?: string) {
    return useQuery({
        queryKey: ['epi-cargo-map', cargo ?? null],
        queryFn: () => epiService.listCargoMap({ cargo, limit: 500 }),
        staleTime: 1000 * 60 * 5,
    });
}

export function useCargoMapMutations() {
    const queryClient = useQueryClient();
    const toast = useToast();
    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['epi-cargo-map'] });
        queryClient.invalidateQueries({ queryKey: ['epi-pendencias'] });
    };

    const create = useMutation({
        mutationFn: (payload: CreateCargoMapPayload) => epiService.createCargoMap(payload),
        onSuccess: () => {
            invalidate();
            toast.success('EPI vinculado ao cargo.');
        },
        onError: (e: Error) =>
            toast.error(getApiErrorMessage(e, 'Não foi possível vincular o EPI ao cargo.')),
    });

    const remove = useMutation({
        mutationFn: (id: number) => epiService.deleteCargoMap(id),
        onSuccess: () => {
            invalidate();
            toast.success('Vínculo removido.');
        },
        onError: (e: Error) =>
            toast.error(getApiErrorMessage(e, 'Não foi possível remover o vínculo.')),
    });

    return { create, remove };
}

// ── Pendências ────────────────────────────────────────────────────
export function usePendencias(estado?: PendenciaEstado, storeIds?: number[]) {
    return useQuery({
        queryKey: ['epi-pendencias', estado ?? null, storeIds ?? null],
        queryFn: () => epiService.listPendencias({ estado, store_ids: storeIds }),
        staleTime: 1000 * 60,
    });
}
