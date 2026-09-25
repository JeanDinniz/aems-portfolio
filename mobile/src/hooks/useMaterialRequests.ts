import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { materialRequestsService } from '@/services/api/materialRequests.service';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/api-error';
import type {
    MaterialRequestCreate,
    MaterialRequestListParams,
    MaterialRequestUpdate,
    ToolCardParams,
    ToolReceiptConfirmPayload,
} from '@/types/materialRequest.types';

/**
 * Hooks de "Pedidos de Material" — adaptados de
 * frontend/src/hooks/useMaterialRequests.ts para o mobile.
 *
 * QueryKeys (paridade com o web):
 *  - ['material-requests', params]  — lista paginada
 *  - ['material-request', id]       — detalhe
 *
 * As mutations invalidam a lista + as queries de Estoque (['inventory-rolls'] /
 * ['film-types']) porque uma linha de película do pedido CRIA uma bobina no
 * Estoque; excluir/editar mexe no vínculo. Toast do design system mobile
 * (`.success`/`.error`) + `getApiErrorMessage`.
 *
 * NOTA: no web as keys de estoque eram ['inventory'] / ['film-types']; no mobile
 * a lista de bobinas usa ['inventory-rolls'] (ver hooks/useInventory.ts), então
 * invalidamos ambas por segurança.
 */

export function useMaterialRequests(params?: MaterialRequestListParams) {
    return useQuery({
        queryKey: ['material-requests', params],
        queryFn: () => materialRequestsService.list(params),
        staleTime: 1000 * 60 * 2,
        gcTime: 1000 * 60 * 5,
    });
}

export function useMaterialRequest(id?: number) {
    return useQuery({
        queryKey: ['material-request', id],
        queryFn: () => materialRequestsService.getById(id!),
        enabled: !!id,
        staleTime: 1000 * 60 * 2,
    });
}

function invalidateMaterialRequestQueries(queryClient: ReturnType<typeof useQueryClient>) {
    queryClient.invalidateQueries({ queryKey: ['material-requests'] });
    queryClient.invalidateQueries({ queryKey: ['material-request'] });
    // Uma linha de película vira bobina no Estoque → invalida as listas de estoque.
    queryClient.invalidateQueries({ queryKey: ['inventory-rolls'] });
    queryClient.invalidateQueries({ queryKey: ['inventory-critical'] });
    queryClient.invalidateQueries({ queryKey: ['film-types'] });
}

export function useCreateMaterialRequest() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: (payload: MaterialRequestCreate) => materialRequestsService.create(payload),
        onSuccess: () => {
            invalidateMaterialRequestQueries(queryClient);
            toast.success('Pedido de material registrado.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao criar pedido.'));
        },
    });
}

export function useUpdateMaterialRequest() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: MaterialRequestUpdate }) =>
            materialRequestsService.update(id, payload),
        onSuccess: () => {
            invalidateMaterialRequestQueries(queryClient);
            toast.success('Pedido atualizado.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao atualizar pedido.'));
        },
    });
}

export function useDeleteMaterialRequest() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: (id: number) => materialRequestsService.remove(id),
        onSuccess: () => {
            invalidateMaterialRequestQueries(queryClient);
            toast.success('Pedido excluído.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao excluir pedido.'));
        },
    });
}

// ─── Cards de recebimento de ferramentas (Controle de EPIs) ─────────────────────

/** Lista os cards de recebimento de ferramentas. QueryKey ['tool-cards', params]. */
export function useToolCards(params?: ToolCardParams) {
    return useQuery({
        queryKey: ['tool-cards', params],
        queryFn: () => materialRequestsService.toolCards(params),
        staleTime: 1000 * 60 * 2,
    });
}

/** Confirma o recebimento assinado de um card (pedido × funcionário). */
export function useConfirmToolReceipt() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: (payload: ToolReceiptConfirmPayload) =>
            materialRequestsService.confirmToolReceipt(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tool-cards'] });
            toast.success('Recebimento registrado.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao registrar recebimento.'));
        },
    });
}
