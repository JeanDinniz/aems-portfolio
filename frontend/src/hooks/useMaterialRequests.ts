import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { materialRequestsService } from '@/services/api/materialRequests.service';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api-error';
import type {
    MaterialRequestCreate,
    MaterialRequestUpdate,
    MaterialRequestListParams,
    RollYieldParams,
    ToolCardParams,
    ToolReceiptConfirmPayload,
} from '@/types/materialRequest.types';

export function useRollServiceOrders(rollId: number | null) {
    return useQuery({
        queryKey: ['roll-service-orders', rollId],
        queryFn: () => materialRequestsService.rollServiceOrders(rollId!),
        enabled: !!rollId,
        staleTime: 1000 * 60 * 5,
    });
}

export function useMaterialRequests(params?: MaterialRequestListParams) {
    return useQuery({
        queryKey: ['material-requests', params],
        queryFn: () => materialRequestsService.list(params),
        staleTime: 1000 * 60 * 2,
        gcTime: 1000 * 60 * 5,
    });
}

/** Rendimento das bobinas (carros por bobina) por loja/material. */
export function useRollYield(params?: RollYieldParams, enabled = true) {
    return useQuery({
        queryKey: ['roll-yield', params],
        queryFn: () => materialRequestsService.rollYield(params),
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 5,
        enabled,
    });
}

/** Cards de recebimento de ferramentas (Controle de EPIs). */
export function useToolCards(params?: ToolCardParams) {
    return useQuery({
        queryKey: ['tool-cards', params],
        queryFn: () => materialRequestsService.toolCards(params),
        staleTime: 1000 * 60 * 2,
    });
}

export function useConfirmToolReceipt() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: (payload: ToolReceiptConfirmPayload) =>
            materialRequestsService.confirmToolReceipt(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['tool-cards'] });
            toast({
                title: 'Recebimento registrado',
                description: 'O recebimento das ferramentas foi confirmado.',
            });
        },
        onError: (error: Error) => {
            toast({
                title: 'Erro ao registrar recebimento',
                description: getApiErrorMessage(error),
                variant: 'destructive',
            });
        },
    });
}

export function useCreateMaterialRequest() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: (payload: MaterialRequestCreate) => materialRequestsService.create(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['material-requests'] });
            queryClient.invalidateQueries({ queryKey: ['inventory'] });
            queryClient.invalidateQueries({ queryKey: ['film-types'] });
            queryClient.invalidateQueries({ queryKey: ['tool-cards'] });
            // Pedido de material altera entradas/saldo agregados nos Indicadores
            queryClient.invalidateQueries({ queryKey: ['indicators'] });
            toast({
                title: 'Pedido criado',
                description: 'O pedido de material foi registrado com sucesso.',
            });
        },
        onError: (error: Error) => {
            toast({
                title: 'Erro ao criar pedido',
                description: getApiErrorMessage(error),
                variant: 'destructive',
            });
        },
    });
}

export function useUpdateMaterialRequest() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: MaterialRequestUpdate }) =>
            materialRequestsService.update(id, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['material-requests'] });
            queryClient.invalidateQueries({ queryKey: ['inventory'] });
            queryClient.invalidateQueries({ queryKey: ['film-types'] });
            queryClient.invalidateQueries({ queryKey: ['tool-cards'] });
            // Pedido de material altera entradas/saldo agregados nos Indicadores
            queryClient.invalidateQueries({ queryKey: ['indicators'] });
            toast({
                title: 'Pedido atualizado',
                description: 'As alterações foram salvas.',
            });
        },
        onError: (error: Error) => {
            toast({
                title: 'Erro ao atualizar pedido',
                description: getApiErrorMessage(error),
                variant: 'destructive',
            });
        },
    });
}

export function useCancelMaterialRequest() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: ({ id, reason }: { id: number; reason: string }) =>
            materialRequestsService.cancel(id, reason),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['material-requests'] });
            queryClient.invalidateQueries({ queryKey: ['inventory'] });
            queryClient.invalidateQueries({ queryKey: ['film-types'] });
            // Cancelar pedido pode estornar bobina/quantidade — reflete nos Indicadores
            queryClient.invalidateQueries({ queryKey: ['indicators'] });
            toast({ title: 'Pedido cancelado' });
        },
        onError: (error: Error) => {
            toast({
                title: 'Erro ao cancelar pedido',
                description: getApiErrorMessage(error),
                variant: 'destructive',
            });
        },
    });
}
