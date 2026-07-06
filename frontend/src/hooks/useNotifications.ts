import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsService } from '@/services/api/notifications.service';
import { useAuth } from '@/hooks/useAuth';

const NOTIFICATIONS_QUERY_KEY = ['notifications'] as const;
const UNREAD_COUNT_QUERY_KEY = ['notifications', 'unread-count'] as const;

export function useNotifications(limit = 5) {
    const { user } = useAuth();

    return useQuery({
        queryKey: [...NOTIFICATIONS_QUERY_KEY, limit],
        queryFn: () => notificationsService.list(limit),
        enabled: !!user,
        staleTime: 30_000,
        refetchInterval: 120_000,
        refetchIntervalInBackground: false,
    });
}

export function useUnreadNotificationCount() {
    const { user } = useAuth();

    return useQuery({
        queryKey: UNREAD_COUNT_QUERY_KEY,
        queryFn: () => notificationsService.getUnreadCount(),
        enabled: !!user,
        staleTime: 30_000,
        refetchInterval: 120_000,
        refetchIntervalInBackground: false,
    });
}

export function useMarkNotificationRead() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: number) => notificationsService.markAsRead(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
            queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
        },
        onError: () => {
            // Falha silenciosa — marcar notificação como lida não é crítico para o usuário
        },
    });
}

export function useMarkAllNotificationsRead() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: () => notificationsService.markAllAsRead(),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
            queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
        },
        onError: () => {
            // Falha silenciosa — marcar todas notificações como lidas não é crítico para o usuário
        },
    });
}
