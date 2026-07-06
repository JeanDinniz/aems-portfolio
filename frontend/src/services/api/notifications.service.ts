import apiClient from './client';

export interface Notification {
    id: number;
    user_id: number;
    title: string;
    message: string;      // mapeado de `body` do backend
    type: string;
    read: boolean;        // mapeado de `is_read` do backend
    created_at: string;
    related_url?: string | null;
}

export interface UnreadCountResponse {
    count: number;
}

interface BackendNotification {
    id: number;
    user_id: number;
    title: string;
    body: string;
    type: string;
    is_read: boolean;
    created_at: string;
}

function mapNotification(n: BackendNotification): Notification {
    return {
        id: n.id,
        user_id: n.user_id,
        title: n.title,
        message: n.body,
        type: n.type,
        read: n.is_read,
        created_at: n.created_at,
        related_url: null,
    };
}

export const notificationsService = {
    async list(limit = 20): Promise<Notification[]> {
        const response = await apiClient.get<{
            items: BackendNotification[];
            pagination: { total: number };
        }>('/notifications', { params: { limit } });
        return (response.data.items ?? []).map(mapNotification);
    },

    async getUnreadCount(): Promise<number> {
        const response = await apiClient.get<UnreadCountResponse>('/notifications/unread-count');
        return response.data.count;
    },

    async markAsRead(id: number): Promise<void> {
        await apiClient.patch(`/notifications/${id}/read`);
    },

    async markAllAsRead(): Promise<void> {
        await apiClient.post('/notifications/mark-all-read');
    },
};
