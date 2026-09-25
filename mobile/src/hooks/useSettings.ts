import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { settingsService, type RevenueGoalConfig } from '@/services/api/settings.service';
import { useToast } from '@/components/ui';

/**
 * Configurações (Owner) — portado de frontend/src/hooks/useSettings.ts.
 *
 * Mantém os mesmos queryKeys do web (`['settings', 'revenue-goals']`) e a
 * invalidação em cascata do overview do Dashboard, que consome as metas.
 * O toast segue o padrão do mobile (`useToast().success/error`).
 */
export function useRevenueGoals(enabled = true) {
    return useQuery({
        queryKey: ['settings', 'revenue-goals'],
        queryFn: settingsService.getRevenueGoals,
        staleTime: 1000 * 60 * 5,
        enabled,
    });
}

export function useUpdateRevenueGoals() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: (data: RevenueGoalConfig) => settingsService.updateRevenueGoals(data),
        onSuccess: (data) => {
            queryClient.setQueryData(['settings', 'revenue-goals'], data);
            // Metas alimentam o card do Dashboard — recarrega o overview.
            queryClient.invalidateQueries({ queryKey: ['dashboard', 'overview'] });
            toast.success('Metas de faturamento salvas');
        },
        onError: () => {
            toast.error('Erro ao salvar metas. Tente novamente.');
        },
    });
}
