import apiClient from './client';
import type {
    CargoEPI,
    CargoEPIListResponse,
    CreateCargoMapPayload,
    CreateDeliveryPayload,
    CreateEPIPayload,
    EntregaEPI,
    EntregaEPIListResponse,
    EPI,
    EPIListResponse,
    PendenciaEstado,
    PendenciasResponse,
    UpdateEPIPayload,
} from '@/types/epi.types';

export const epiService = {
    // Catálogo
    listCatalog: async (params?: { page?: number; limit?: number; only_active?: boolean }): Promise<EPIListResponse> =>
        apiClient.get('/epi/catalog', { params }).then((r) => r.data),
    createEpi: async (payload: CreateEPIPayload): Promise<EPI> =>
        apiClient.post('/epi/catalog', payload).then((r) => r.data),
    updateEpi: async (id: number, payload: UpdateEPIPayload): Promise<EPI> =>
        apiClient.patch(`/epi/catalog/${id}`, payload).then((r) => r.data),
    deactivateEpi: async (id: number): Promise<void> =>
        apiClient.delete(`/epi/catalog/${id}`).then(() => undefined),

    // Mapeamento cargo -> EPI
    listCargoMap: async (params?: { cargo?: string; page?: number; limit?: number }): Promise<CargoEPIListResponse> =>
        apiClient.get('/epi/cargo-map', { params }).then((r) => r.data),
    createCargoMap: async (payload: CreateCargoMapPayload): Promise<CargoEPI> =>
        apiClient.post('/epi/cargo-map', payload).then((r) => r.data),
    deleteCargoMap: async (id: number): Promise<void> =>
        apiClient.delete(`/epi/cargo-map/${id}`).then(() => undefined),

    // Entregas
    listDeliveries: async (params?: { employee_id?: number; page?: number; limit?: number }): Promise<EntregaEPIListResponse> =>
        apiClient.get('/epi/deliveries', { params }).then((r) => r.data),
    createDelivery: async (payload: CreateDeliveryPayload): Promise<EntregaEPI> =>
        apiClient.post('/epi/deliveries', payload).then((r) => r.data),

    // Pendências
    listPendencias: async (params?: { estado?: PendenciaEstado; store_ids?: number[] }): Promise<PendenciasResponse> =>
        apiClient.get('/epi/pendencias', { params }).then((r) => r.data),
};
