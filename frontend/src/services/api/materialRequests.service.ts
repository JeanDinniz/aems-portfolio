import apiClient from './client';
import type {
    MaterialRequest,
    MaterialRequestListResponse,
    MaterialRequestCreate,
    MaterialRequestUpdate,
    MaterialRequestListParams,
    RollYieldResponse,
    RollYieldParams,
    RollServiceOrdersResponse,
    ToolCardListResponse,
    ToolCardParams,
    ToolReceiptConfirmPayload,
} from '@/types/materialRequest.types';

export const materialRequestsService = {
    list: async (params?: MaterialRequestListParams): Promise<MaterialRequestListResponse> =>
        apiClient.get('/material-requests', { params }).then((r) => r.data),

    getById: async (id: number): Promise<MaterialRequest> =>
        apiClient.get(`/material-requests/${id}`).then((r) => r.data),

    create: async (payload: MaterialRequestCreate): Promise<MaterialRequest> =>
        apiClient.post('/material-requests', payload).then((r) => r.data),

    update: async (id: number, payload: MaterialRequestUpdate): Promise<MaterialRequest> =>
        apiClient.patch(`/material-requests/${id}`, payload).then((r) => r.data),

    cancel: async (id: number, reason: string): Promise<MaterialRequest> =>
        apiClient
            .delete(`/material-requests/${id}`, { data: { cancellation_reason: reason } })
            .then((r) => r.data),

    rollServiceOrders: async (rollId: number): Promise<RollServiceOrdersResponse> =>
        apiClient.get(`/material-requests/roll/${rollId}/service-orders`).then((r) => r.data),

    exportExcel: async (params?: Pick<MaterialRequestListParams, 'store_id' | 'date_from' | 'date_to'>): Promise<Blob> =>
        apiClient
            .get('/material-requests/export/excel', { params, responseType: 'blob' })
            .then((r) => r.data),

    rollYield: async (params?: RollYieldParams): Promise<RollYieldResponse> =>
        apiClient.get('/material-requests/roll-yield', { params }).then((r) => r.data),

    toolCards: async (params?: ToolCardParams): Promise<ToolCardListResponse> =>
        apiClient.get('/material-requests/tool-cards', { params }).then((r) => r.data),

    confirmToolReceipt: async (payload: ToolReceiptConfirmPayload): Promise<{ id: number }> =>
        apiClient.post('/material-requests/tool-cards/confirm', payload).then((r) => r.data),
};

export default materialRequestsService;
