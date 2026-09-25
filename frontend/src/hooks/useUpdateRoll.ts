import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api-error';
import { inventoryService } from '@/services/api/inventory.service';
import type { FilmRollUpdate } from '@/services/api/inventory.service';

/**
 * Edita os metadados de uma bobina via PATCH /inventory/rolls/{id}.
 *
 * Permite alterar tipo, tonalidade, fornecedor, NFE, custo, lote, metros totais
 * e data de recebimento. NÃO altera metros restantes (isso é responsabilidade
 * do useAdjustRollMeters). Requer permissão can_edit em inventory.
 *
 * Invalida as queries de estoque para que os dados atualizados apareçam
 * imediatamente na listagem e no modal de detalhe.
 */
export function useUpdateRoll() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: FilmRollUpdate }) =>
            inventoryService.updateRoll(id, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory-rolls'] });
            queryClient.invalidateQueries({ queryKey: ['inventory-critical'] });
            queryClient.invalidateQueries({ queryKey: ['roll-consumptions'] });
            // Bobina editada (custo/metadados) alimenta os cards de Indicadores
            queryClient.invalidateQueries({ queryKey: ['indicators'] });
            toast({ title: 'Bobina atualizada' });
        },
        onError: (err: unknown) => {
            toast({
                variant: 'destructive',
                title: 'Erro ao atualizar bobina',
                description: getApiErrorMessage(err),
            });
        },
    });
}
