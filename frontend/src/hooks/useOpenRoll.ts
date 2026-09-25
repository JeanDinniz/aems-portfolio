import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api-error';
import { inventoryService } from '@/services/api/inventory.service';

/**
 * Abre uma bobina para uso (em_estoque → em_uso) via PATCH /inventory/rolls/{id}/open.
 *
 * Abrir é a condição para que a bobina possa receber consumo (a guarda vive no
 * backend). Só quem tem permissão de estoque (inventory can_edit) consegue chamar —
 * o endpoint retorna 403 caso contrário.
 *
 * Invalida todas as queries de bobina (listagem de estoque e os três seletores de
 * O.S./saída) para que a bobina recém-aberta apareça imediatamente como selecionável.
 */
export function useOpenRoll() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: (id: number) => inventoryService.openRoll(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory-rolls'] });
            queryClient.invalidateQueries({ queryKey: ['inventory-critical'] });
            queryClient.invalidateQueries({ queryKey: ['film-rolls-for-os'] });
            queryClient.invalidateQueries({ queryKey: ['ppf-rolls-for-os'] });
            // Abrir bobina muda status/saldo em estoque exibido nos Indicadores
            queryClient.invalidateQueries({ queryKey: ['indicators'] });
            toast({ title: 'Bobina aberta para uso' });
        },
        onError: (err: unknown) => {
            toast({
                variant: 'destructive',
                title: 'Erro ao abrir bobina',
                description: getApiErrorMessage(err),
            });
        },
    });
}
