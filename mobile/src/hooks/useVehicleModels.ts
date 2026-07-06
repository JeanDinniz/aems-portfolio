import { useQuery } from '@tanstack/react-query';

import { vehicleModelsService } from '@/services/api/vehicle-models.service';

/**
 * Modelos de veículo de uma marca (picker de O.S.). Só busca quando há
 * `brand_id`. Adaptado de frontend/src/hooks/useVehicleModels.ts.
 */
export function useVehicleModels(params: { brand_id?: number; active_only?: boolean } = {}) {
    return useQuery({
        queryKey: ['vehicle-models', params.brand_id, params.active_only],
        queryFn: () => vehicleModelsService.list(params),
        enabled: !!params.brand_id,
        staleTime: 1000 * 60 * 5,
    });
}
