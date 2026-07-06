import { useMemo } from 'react';
import {
    useQuery,
    useInfiniteQuery,
    useMutation,
    useQueryClient,
} from '@tanstack/react-query';

import { notificationsService } from '@/services/api/notifications.service';
import { useAuthStore } from '@/stores/auth.store';
import type { AppNotification } from '@/types/notification.types';

/**
 * NOT-01/02 — Hooks de Notificações (in-app).
 *
 * - Notificações são POR USUÁRIO: NÃO injetam `store_id` (sem `withSelectedStore`).
 * - QueryKeys começam com `['notifications', ...]` e o contador é
 *   `['notifications','unread-count']` — EXATAMENTE as chaves que o
 *   `WebSocketProvider`/`useWebSocket` invalida ao receber o evento `notification`.
 *   Assim a lista e o badge atualizam em tempo real sem código extra aqui.
 * - As mutations de marcar lida falham em silêncio (não-crítico, igual ao web).
 */

const NOTIFICATIONS_PAGE_SIZE = 20;

export interface NotificationsPage {
    items: AppNotification[];
    total: number;
}

/**
 * Lista paginada (scroll infinito) de notificações. Achata as páginas em uma
 * lista única + flags de paginação/refresh, no mesmo shape de `useAppointments`.
 */
export function useNotifications(limit = NOTIFICATIONS_PAGE_SIZE) {
    const query = useInfiniteQuery<NotificationsPage>({
        queryKey: ['notifications', 'list', limit],
        queryFn: async ({ pageParam }) => {
            const page = (pageParam as number) ?? 1;
            const data = await notificationsService.list(page, limit);
            return { items: data.items, total: data.pagination.total };
        },
        initialPageParam: 1,
        getNextPageParam: (lastPage, allPages) => {
            const loaded = allPages.reduce((acc, p) => acc + p.items.length, 0);
            if (loaded >= lastPage.total) return undefined;
            return allPages.length + 1; // próxima página (1-indexed)
        },
        staleTime: 1000 * 15,
        gcTime: 1000 * 60 * 2,
    });

    const { items, total } = useMemo(() => {
        if (!query.data) return { items: [] as AppNotification[], total: 0 };
        const flatItems = query.data.pages.flatMap((p) => p.items);
        const lastTotal = query.data.pages[query.data.pages.length - 1]?.total ?? 0;
        return { items: flatItems, total: lastTotal };
    }, [query.data]);

    return {
        items,
        total,
        isLoading: query.isLoading,
        isError: query.isError,
        refetch: query.refetch,
        fetchNextPage: query.fetchNextPage,
        hasNextPage: query.hasNextPage,
        isFetchingNextPage: query.isFetchingNextPage,
        isRefetching: query.isRefetching,
    };
}

/**
 * Contador de não lidas (badge do sino / aba Mais). Só dispara logado; o WS
 * invalida ao vivo, e o `refetchInterval` é fallback caso a conexão caia.
 */
export function useUnreadCount() {
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

    return useQuery({
        queryKey: ['notifications', 'unread-count'],
        queryFn: () => notificationsService.getUnreadCount(),
        enabled: isAuthenticated,
        staleTime: 1000 * 30,
        gcTime: 1000 * 60 * 2,
        refetchInterval: 1000 * 60, // fallback de 60s
    });
}

// ─── Mutations (erro silencioso) ─────────────────────────────────────────────

function invalidateNotifications(queryClient: ReturnType<typeof useQueryClient>) {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
}

export function useMarkRead() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => notificationsService.markAsRead(id),
        onSuccess: () => invalidateNotifications(queryClient),
        // Marcar lida não é crítico — não exibir Toast em caso de erro (igual ao web).
        onError: () => undefined,
    });
}

export function useMarkAllRead() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => notificationsService.markAllAsRead(),
        onSuccess: () => invalidateNotifications(queryClient),
        onError: () => undefined,
    });
}
