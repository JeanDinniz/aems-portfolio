import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { vehicleModelsService } from '@/services/api/vehicle-models.service';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/api-error';

/**
 * Modelos de veículo (Admin — Fatia 5b). Lista por marca (inclui inativos:
 * active_only=false) e expõe o toggle de `is_active`. As rotas do backend EXIGEM
 * `brand_id` — por isso as mutations recebem também o brandId do modelo.
 *
 * QueryKey ['vehicle-models-admin', brand_id]. Ao alternar, invalidamos também
 * ['vehicle-models'] (pickers de O.S.).
 */
export function useVehicleModelsAdmin(brandId?: number) {
    return useQuery({
        queryKey: ['vehicle-models-admin', brandId],
        queryFn: () => vehicleModelsService.list({ brand_id: brandId, active_only: false }),
        enabled: !!brandId,
        staleTime: 60 * 1000,
    });
}

export function useToggleVehicleModelActive() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({
            id,
            brandId,
            isActive,
        }: {
            id: number;
            brandId: number;
            isActive: boolean;
        }) =>
            isActive
                ? vehicleModelsService.activate(id, brandId)
                : vehicleModelsService.deactivate(id, brandId),
        onSuccess: (_data, { isActive }) => {
            queryClient.invalidateQueries({ queryKey: ['vehicle-models-admin'] });
            queryClient.invalidateQueries({ queryKey: ['vehicle-models'] });
            toast.success(isActive ? 'Modelo ativado.' : 'Modelo desativado.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao atualizar o modelo.'));
        },
    });
}
