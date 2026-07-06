import { apiClient } from './client';

/** Portado de frontend/src/services/api/vehicle-models.service.ts (leitura para pickers). */

export interface VehicleModelItem {
    id: number;
    brand_id: number;
    name: string;
    brand?: { id: number; name: string; code: string } | null;
    is_active: boolean;
    created_at: string;
    updated_at: string | null;
}

interface VehicleModelListResponse {
    items: VehicleModelItem[];
    pagination: object;
}

export const vehicleModelsService = {
    list: async (
        params: { brand_id?: number; active_only?: boolean; limit?: number } = {}
    ): Promise<VehicleModelItem[]> => {
        const response = await apiClient.get<VehicleModelListResponse>('/vehicle-models', {
            params: { limit: 200, ...params },
        });
        return response.data.items;
    },

    /**
     * Soft delete (DELETE /vehicle-models/{id}?brand_id=). O backend EXIGE
     * `brand_id` como query param para localizar o modelo na marca dona.
     */
    deactivate: async (modelId: number, brandId: number): Promise<VehicleModelItem> =>
        apiClient
            .delete(`/vehicle-models/${modelId}`, { params: { brand_id: brandId } })
            .then((r) => r.data),

    /** Reativa via PATCH /vehicle-models/{id}?brand_id= { is_active: true }. */
    activate: async (modelId: number, brandId: number): Promise<VehicleModelItem> =>
        apiClient
            .patch(
                `/vehicle-models/${modelId}`,
                { is_active: true },
                { params: { brand_id: brandId } }
            )
            .then((r) => r.data),
};
