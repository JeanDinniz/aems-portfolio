import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api-error';
import { inventoryService } from '@/services/api/inventory.service';

/**
 * Ajusta os metros restantes de uma bobina via PATCH /inventory/rolls/{id}/adjust-meters.
 *
 * Usado na conferência física de estoque: o gestor percorre as lojas e corrige
 * o valor no sistema para bater com o físico. Requer permissão can_edit em inventory.
 *
 * Invalida as queries de estoque para que o valor atualizado apareça imediatamente
 * na listagem e no modal de detalhe.
 */
export function useAdjustRollMeters() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: ({
            id,
            remaining_meters,
            note,
        }: {
            id: number;
            remaining_meters: number;
            note: string;
        }) => inventoryService.adjustRollMeters(id, remaining_meters, note),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory-rolls'] });
            queryClient.invalidateQueries({ queryKey: ['inventory-critical'] });
            queryClient.invalidateQueries({ queryKey: ['roll-consumptions'] });
            // Ajuste de metros muda o saldo/nome da bobina que aparece nas O.S.
            queryClient.invalidateQueries({ queryKey: ['service-orders'] });
            // Reflete no saldo/saúde de estoque dos Indicadores
            queryClient.invalidateQueries({ queryKey: ['indicators'] });
            toast({ title: 'Metros ajustados' });
        },
        onError: (err: unknown) => {
            toast({
                variant: 'destructive',
                title: 'Erro ao ajustar metros',
                description: getApiErrorMessage(err),
            });
        },
    });
}
