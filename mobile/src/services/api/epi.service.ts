import { apiClient } from './client';
import type {
    CargoEPI,
    CargoEPIListResponse,
    CreateCargoMapPayload,
    CreateEPIPayload,
    EPI,
    EPIListResponse,
    PendenciaEstado,
    PendenciasResponse,
    UpdateEPIPayload,
} from '@/types/epi.types';

/**
 * Controle de EPIs — portado de `frontend/src/services/api/epi.service.ts`.
 *
 * O backend `/epi` (feature flag EPI_ENABLED) NÃO é alterado. Todas as rotas
 * exigem a permissão de perfil `epi` (view/edit/delete); a autorização é do
 * backend, o app só esconde/desabilita ações via `useCan*('epi')`.
 */
export const epiService = {
    // ── Catálogo ──────────────────────────────────────────────────
    listCatalog: async (params?: {
        page?: number;
        limit?: number;
        only_active?: boolean;
    }): Promise<EPIListResponse> =>
        apiClient.get('/epi/catalog', { params }).then((r) => r.data),

    createEpi: async (payload: CreateEPIPayload): Promise<EPI> =>
        apiClient.post('/epi/catalog', payload).then((r) => r.data),

    updateEpi: async (id: number, payload: UpdateEPIPayload): Promise<EPI> =>
        apiClient.patch(`/epi/catalog/${id}`, payload).then((r) => r.data),

    deactivateEpi: async (id: number): Promise<void> =>
        apiClient.delete(`/epi/catalog/${id}`).then(() => undefined),

    // ── Mapeamento cargo -> EPI ───────────────────────────────────
    listCargoMap: async (params?: {
        cargo?: string;
        page?: number;
        limit?: number;
    }): Promise<CargoEPIListResponse> =>
        apiClient.get('/epi/cargo-map', { params }).then((r) => r.data),

    createCargoMap: async (payload: CreateCargoMapPayload): Promise<CargoEPI> =>
        apiClient.post('/epi/cargo-map', payload).then((r) => r.data),

    deleteCargoMap: async (id: number): Promise<void> =>
        apiClient.delete(`/epi/cargo-map/${id}`).then(() => undefined),

    // ── Pendências ────────────────────────────────────────────────
    listPendencias: async (params?: {
        estado?: PendenciaEstado;
        store_ids?: number[];
    }): Promise<PendenciasResponse> =>
        apiClient.get('/epi/pendencias', { params }).then((r) => r.data),
};

export default epiService;
