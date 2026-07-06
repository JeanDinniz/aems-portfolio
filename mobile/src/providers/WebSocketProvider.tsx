/**
 * WebSocketProvider (WS-02) — dono do CICLO DE VIDA da conexão WebSocket no app.
 *
 * O `useWebSocket` cuida só dos bindings evento→invalidação. Aqui ficam as regras
 * mobile que o web não tem:
 *  - Conecta após login no room certo (Owner → `all`; demais → loja selecionada).
 *  - Reconecta ao trocar de loja (observa `selectedStoreId`).
 *  - Reconecta ao voltar do background (AppState 'active') E invalida as queries
 *    ao vivo — não confiar só no socket para ressincronizar.
 *  - Reconecta ao recuperar a rede (NetInfo `isConnected` voltando a true).
 *  - Reconecta com o token novo após refresh (observa `tokens.accessToken`).
 *  - Desconecta no logout.
 *
 * Plugado no App.tsx DENTRO do QueryClientProvider (precisa do queryClient e dos
 * stores). Não renderiza UI: apenas instala efeitos e repassa `children`.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';

import { wsService } from '@/services/websocket/websocket.service';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useAuthStore } from '@/stores/auth.store';
import { useStoreStore } from '@/stores/store.store';

/** Queries que ressincronizamos ao voltar do background / reconectar a rede. */
function invalidateLiveQueries(queryClient: ReturnType<typeof useQueryClient>): void {
    queryClient.invalidateQueries({ queryKey: ['service-orders'] });
    queryClient.invalidateQueries({ queryKey: ['scheduling'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
}

export function WebSocketProvider({ children }: { children: ReactNode }): ReactNode {
    const queryClient = useQueryClient();

    // Bindings evento→invalidação (registrados uma vez, limpos no unmount).
    useWebSocket();

    // Estado de auth/loja que determina SE e ONDE conectar. Lemos via seletores
    // para re-rodar o efeito quando token/role/loja mudarem.
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const accessToken = useAuthStore((s) => s.tokens?.accessToken);
    const role = useAuthStore((s) => s.user?.role);
    const userStoreId = useAuthStore((s) => s.user?.store_id);
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);

    // ── Conexão: (re)conecta quando muda token/role/loja; desconecta no logout ──
    useEffect(() => {
        if (!isAuthenticated || !accessToken) {
            wsService.disconnect();
            return;
        }

        // Owner ouve o canal global; demais usuários a loja selecionada (ou a
        // própria loja, se não houver seleção global ativa).
        const isOwner = role === 'owner';
        const storeId: number | 'all' | null = isOwner
            ? 'all'
            : selectedStoreId ?? userStoreId ?? null;

        if (storeId === null) {
            // Sem room definível (ex.: usuário sem loja e sem seleção): não conecta.
            wsService.disconnect();
            return;
        }

        wsService.connect(accessToken, storeId);
        // Não desconectamos no cleanup deste efeito: trocar de loja/token apenas
        // re-chama `connect`, que reabre no room novo sem piscar 'disconnected'
        // entre renders. O disconnect real acontece no logout (branch acima) e no
        // unmount do provider (efeito dedicado abaixo).
    }, [isAuthenticated, accessToken, role, selectedStoreId, userStoreId]);

    // ── AppState: foreground → reconecta + ressincroniza queries ────────────────
    const appState = useRef<AppStateStatus>(AppState.currentState);
    useEffect(() => {
        const sub: NativeEventSubscription = AppState.addEventListener('change', (next) => {
            const prev = appState.current;
            appState.current = next;
            // Só age na TRANSIÇÃO para 'active' (background/inactive → active).
            if (next === 'active' && prev !== 'active') {
                if (useAuthStore.getState().isAuthenticated) {
                    wsService.reconnect();
                    invalidateLiveQueries(queryClient);
                }
            }
        });
        return () => sub.remove();
    }, [queryClient]);

    // ── NetInfo: rede recuperada → reconecta ────────────────────────────────────
    const wasConnected = useRef<boolean>(true);
    useEffect(() => {
        const unsub = NetInfo.addEventListener((state: NetInfoState) => {
            // `isConnected` pode ser null em algumas plataformas; tratamos null como
            // online (otimista). Reconecta apenas na BORDA offline→online.
            const online = state.isConnected !== false;
            const recovered = online && !wasConnected.current;
            wasConnected.current = online;
            if (recovered && useAuthStore.getState().isAuthenticated) {
                wsService.reconnect();
                invalidateLiveQueries(queryClient);
            }
        });
        return () => unsub();
    }, [queryClient]);

    // ── Cleanup final: fecha a conexão ao desmontar o provider ──────────────────
    useEffect(() => {
        return () => {
            wsService.disconnect();
        };
    }, []);

    return <>{children}</>;
}
