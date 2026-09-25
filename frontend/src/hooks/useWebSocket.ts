/**
 * Hook que gerencia a conexão WebSocket e invalida caches do TanStack Query
 * ao receber eventos do servidor.
 *
 * Deve ser chamado UMA VEZ no MainLayout (dentro do QueryClientProvider).
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { wsService } from '@/services/websocket/websocket.service';

export function useWebSocket(): void {
  const { tokens, user, isAuthenticated } = useAuthStore();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAuthenticated || !tokens?.accessToken || !user) {
      wsService.disconnect();
      return;
    }

    // Owners conectam ao canal global; demais usuários ao canal da própria loja
    const storeId: number | 'all' | null =
      user.role === 'owner' ? 'all' : user.store_id ?? null;

    if (storeId === null) return;

    wsService.connect(tokens.accessToken, storeId);

    const invalidateOrders = () =>
      queryClient.invalidateQueries({ queryKey: ['service-orders'] });

    const invalidateConference = () =>
      queryClient.invalidateQueries({ queryKey: ['service-orders', 'conference', 'summary'] });

    const onOsVerified = () => {
      invalidateOrders();
      invalidateConference();
    };

    const invalidateScheduling = () =>
      queryClient.invalidateQueries({ queryKey: ['scheduling'] });

    const onOsUpdated = () => { invalidateOrders(); invalidateScheduling(); };

    wsService.on('os_created', invalidateOrders);
    wsService.on('os_updated', onOsUpdated);
    wsService.on('os_finalized', invalidateOrders);
    wsService.on('os_cancelled', invalidateOrders);
    wsService.on('os_verified', onOsVerified);
    wsService.on('appointment_created', invalidateScheduling);
    wsService.on('appointment_updated', invalidateScheduling);
    wsService.on('appointment_cancelled', invalidateScheduling);

    return () => {
      wsService.off('os_created', invalidateOrders);
      wsService.off('os_updated', onOsUpdated);
      wsService.off('os_finalized', invalidateOrders);
      wsService.off('os_cancelled', invalidateOrders);
      wsService.off('os_verified', onOsVerified);
      wsService.off('appointment_created', invalidateScheduling);
      wsService.off('appointment_updated', invalidateScheduling);
      wsService.off('appointment_cancelled', invalidateScheduling);
      wsService.disconnect();
    };
  }, [isAuthenticated, tokens?.accessToken, user?.id, user?.role, user?.store_id, queryClient]);
}
