/**
 * useWebSocket — registra os handlers de eventos do servidor e invalida os
 * caches do TanStack Query correspondentes. Portado de
 * frontend/src/hooks/useWebSocket.ts, com uma MELHORIA do mobile: trata também o
 * evento `notification` (o web não trata), invalidando a lista e o contador de
 * não-lidas — assim o sino atualiza em tempo real.
 *
 * Diferente do web, este hook NÃO gerencia o ciclo de vida da conexão
 * (connect/disconnect, AppState, NetInfo, troca de loja, refresh de token):
 * isso é responsabilidade do `WebSocketProvider`. Aqui ficam apenas os bindings
 * evento→invalidação, registrados no mount e removidos no unmount (sem vazar
 * listeners no singleton).
 *
 * Deve ser usado UMA VEZ, dentro do `QueryClientProvider`.
 */
import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

import { wsService } from '@/services/websocket/websocket.service';

/**
 * Registra os handlers evento→invalidação no `wsService` e devolve a função de
 * cleanup (que faz `off` de todos). Exportado para o provider/testes poderem
 * registrar sem montar um componente.
 */
export function registerWsHandlers(queryClient: QueryClient): () => void {
    const invalidateOrders = () =>
        queryClient.invalidateQueries({ queryKey: ['service-orders'] });

    const invalidateScheduling = () =>
        queryClient.invalidateQueries({ queryKey: ['scheduling'] });

    const invalidateConference = () =>
        queryClient.invalidateQueries({ queryKey: ['service-orders', 'conference', 'summary'] });

    const invalidateQueue = () =>
        queryClient.invalidateQueries({ queryKey: ['dashboard', 'queue'] });

    const invalidateNotifications = () => {
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
        queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
    };

    const onOsUpdated = () => {
        invalidateOrders();
        invalidateScheduling();
    };

    const onOsVerified = () => {
        invalidateOrders();
        invalidateConference();
    };

    wsService.on('os_created', invalidateOrders);
    wsService.on('os_updated', onOsUpdated);
    wsService.on('os_status_changed', invalidateOrders);
    wsService.on('os_finalized', invalidateOrders);
    wsService.on('os_cancelled', invalidateOrders);
    wsService.on('os_verified', onOsVerified);
    wsService.on('semaphore_updated', invalidateQueue);
    wsService.on('appointment_created', invalidateScheduling);
    wsService.on('appointment_updated', invalidateScheduling);
    wsService.on('appointment_cancelled', invalidateScheduling);
    wsService.on('notification', invalidateNotifications);

    return () => {
        wsService.off('os_created', invalidateOrders);
        wsService.off('os_updated', onOsUpdated);
        wsService.off('os_status_changed', invalidateOrders);
        wsService.off('os_finalized', invalidateOrders);
        wsService.off('os_cancelled', invalidateOrders);
        wsService.off('os_verified', onOsVerified);
        wsService.off('semaphore_updated', invalidateQueue);
        wsService.off('appointment_created', invalidateScheduling);
        wsService.off('appointment_updated', invalidateScheduling);
        wsService.off('appointment_cancelled', invalidateScheduling);
        wsService.off('notification', invalidateNotifications);
    };
}

export function useWebSocket(): void {
    const queryClient = useQueryClient();

    useEffect(() => {
        return registerWsHandlers(queryClient);
    }, [queryClient]);
}
