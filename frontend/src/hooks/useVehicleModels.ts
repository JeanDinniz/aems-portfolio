import { useQuery } from '@tanstack/react-query'
import { vehicleModelsService } from '@/services/api/vehicle-models.service'
import { CATALOG_STALE_TIME, CATALOG_GC_TIME, vehicleModelsKey } from '@/lib/catalog-queries'

export function useVehicleModels(params: { brand_id?: number; active_only?: boolean } = {}) {
    return useQuery({
        queryKey: vehicleModelsKey(params.brand_id, params.active_only),
        queryFn: () => vehicleModelsService.list(params),
        enabled: !!params.brand_id,
        staleTime: CATALOG_STALE_TIME,
        gcTime: CATALOG_GC_TIME,
    })
}
