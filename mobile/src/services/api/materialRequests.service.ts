import { apiClient } from './client';
import type {
    MaterialRequest,
    MaterialRequestCreate,
    MaterialRequestListParams,
    MaterialRequestListResponse,
    MaterialRequestUpdate,
    ToolCardListResponse,
    ToolCardParams,
    ToolReceiptConfirmPayload,
} from '@/types/materialRequest.types';

/**
 * Camada de dados de "Pedidos de Material" (rota web /pedidos).
 *
 * Portado de frontend/src/services/api/materialRequests.service.ts. Endpoints
 * confirmados em app/modules/material_requests/router.py:
 *  - GET    /material-requests            (list, paginado ?page=&limit=)
 *  - GET    /material-requests/{id}       (detalhe)
 *  - POST   /material-requests            (criar)
 *  - PATCH  /material-requests/{id}       (editar — só data/obs/galpão/ferramentas)
 *  - DELETE /material-requests/{id}       (excluir)
 *  - GET    /material-requests/export/excel (binário .xlsx)
 *
 * O export NÃO fica aqui: no mobile não existe download de browser. A tela usa
 * `downloadAndShareExcel` (utils/exportShare) apontando direto para
 * `/material-requests/export/excel`, que baixa o binário + abre o share nativo.
 */

/** Monta os params de listagem, omitindo os vazios/nulos (evita `store_id=null`). */
function buildListParams(params?: MaterialRequestListParams): Record<string, string | number> {
    const query: Record<string, string | number> = {
        page: params?.page ?? 1,
        limit: params?.limit ?? 20,
    };
    if (params?.store_id != null) query.store_id = params.store_id;
    if (params?.date_from) query.date_from = params.date_from;
    if (params?.date_to) query.date_to = params.date_to;
    return query;
}

export const materialRequestsService = {
    list: async (params?: MaterialRequestListParams): Promise<MaterialRequestListResponse> => {
        const response = await apiClient.get('/material-requests', {
            params: buildListParams(params),
        });
        return response.data;
    },

    getById: async (id: number): Promise<MaterialRequest> => {
        const response = await apiClient.get(`/material-requests/${id}`);
        return response.data;
    },

    create: async (payload: MaterialRequestCreate): Promise<MaterialRequest> => {
        const response = await apiClient.post('/material-requests', payload);
        return response.data;
    },

    update: async (id: number, payload: MaterialRequestUpdate): Promise<MaterialRequest> => {
        const response = await apiClient.patch(`/material-requests/${id}`, payload);
        return response.data;
    },

    remove: async (id: number): Promise<{ detail: string }> => {
        const response = await apiClient.delete(`/material-requests/${id}`);
        return response.data;
    },

    // ── Cards de recebimento de ferramentas (Controle de EPIs) ──────────────
    // GET  /material-requests/tool-cards          (lista; ?status=&store_id=&employee_id=)
    // POST /material-requests/tool-cards/confirm  (registra recebimento assinado)
    toolCards: async (params?: ToolCardParams): Promise<ToolCardListResponse> => {
        const query: Record<string, string | number> = {};
        if (params?.status) query.status = params.status;
        if (params?.store_id != null) query.store_id = params.store_id;
        if (params?.employee_id != null) query.employee_id = params.employee_id;
        const response = await apiClient.get('/material-requests/tool-cards', { params: query });
        return response.data;
    },

    confirmToolReceipt: async (payload: ToolReceiptConfirmPayload): Promise<{ id: number }> => {
        const response = await apiClient.post('/material-requests/tool-cards/confirm', payload);
        return response.data;
    },
};

export default materialRequestsService;
