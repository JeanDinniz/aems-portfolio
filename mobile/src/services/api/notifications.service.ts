import { apiClient } from './client';
import type { AppNotification, NotificationListResponse } from '@/types/notification.types';

/**
 * NOT-01 — Service de Notificações (in-app).
 *
 * Cliente HTTP dos endpoints reais do backend (`app/modules/notifications`).
 * Notificações são POR USUÁRIO — NÃO recebem `store_id` (o backend filtra pelo
 * usuário autenticado). Padrão idêntico aos demais services mobile
 * (named import `{ apiClient }`, retorno cru do backend).
 */
export const notificationsService = {
    /** Lista paginada (não lidas primeiro — ordenação do backend). */
    async list(page = 1, limit = 20): Promise<NotificationListResponse> {
        const { data } = await apiClient.get<NotificationListResponse>('/notifications', {
            params: { page, limit },
        });
        return data;
    },

    /** Contador de não lidas (`{ count }`). */
    async getUnreadCount(): Promise<number> {
        const { data } = await apiClient.get<{ count: number }>('/notifications/unread-count');
        return data.count;
    },

    /** Marca uma notificação como lida. */
    async markAsRead(id: number): Promise<AppNotification> {
        const { data } = await apiClient.patch<AppNotification>(`/notifications/${id}/read`);
        return data;
    },

    /** Marca todas as não lidas como lidas. */
    async markAllAsRead(): Promise<{ updated: number; message: string }> {
        const { data } = await apiClient.post<{ updated: number; message: string }>(
            '/notifications/mark-all-read'
        );
        return data;
    },
};
