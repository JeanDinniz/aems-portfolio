import { apiClient } from './client'

export interface VehicleModelItem {
    id: number
    brand_id: number
    name: string
    brand?: { id: number; name: string; code: string } | null
    is_active: boolean
    created_at: string
    updated_at: string | null
}

interface VehicleModelListResponse {
    items: VehicleModelItem[]
    pagination: object
}

export const vehicleModelsService = {
    list: async (params: { brand_id?: number; active_only?: boolean; limit?: number } = {}): Promise<VehicleModelItem[]> => {
        const response = await apiClient.get<VehicleModelListResponse>('/vehicle-models', { params: { limit: 200, ...params } })
        return response.data.items
    },
    create: async (brand_id: number, data: { name: string }): Promise<VehicleModelItem> => {
        const response = await apiClient.post<VehicleModelItem>('/vehicle-models', { ...data, brand_id })
        return response.data
    },
    update: async (id: number, brand_id: number, data: { name?: string; is_active?: boolean }): Promise<VehicleModelItem> => {
        const response = await apiClient.patch<VehicleModelItem>(`/vehicle-models/${id}`, data, { params: { brand_id } })
        return response.data
    },
    deactivate: async (id: number, brand_id: number): Promise<VehicleModelItem> => {
        const response = await apiClient.delete<VehicleModelItem>(`/vehicle-models/${id}`, { params: { brand_id } })
        return response.data
    },
    hardDelete: async (id: number, brand_id: number): Promise<{ id: number; name: string }> => {
        const response = await apiClient.delete<{ id: number; name: string }>(`/vehicle-models/${id}/permanent`, { params: { brand_id } })
        return response.data
    },
}
