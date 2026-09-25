import apiClient from './client';
import type {
    Holiday,
    HolidayListResponse,
    CreateHolidayPayload,
    UpdateHolidayPayload,
} from '@/types/holiday.types';

export const holidaysService = {
    list: async (params?: {
        page?: number;
        limit?: number;
        year?: number;
        store_id?: number | null;
    }): Promise<HolidayListResponse> =>
        apiClient.get('/holidays', { params }).then((r) => r.data),

    getById: async (id: number): Promise<Holiday> =>
        apiClient.get(`/holidays/${id}`).then((r) => r.data),

    create: async (payload: CreateHolidayPayload): Promise<Holiday> =>
        apiClient.post('/holidays', payload).then((r) => r.data),

    update: async (id: number, payload: UpdateHolidayPayload): Promise<Holiday> =>
        apiClient.patch(`/holidays/${id}`, payload).then((r) => r.data),

    remove: async (id: number): Promise<void> =>
        apiClient.delete(`/holidays/${id}`).then(() => undefined),
};

export default holidaysService;
