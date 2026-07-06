/**
 * WS-02 — WebSocketProvider (ciclo de vida da conexão).
 *
 * Mocka o `wsService` (connect/disconnect/reconnect/on/off) para verificar:
 *  - conecta no room certo após login (Owner → 'all'; loja → storeId);
 *  - reconecta ao trocar de loja (reabre no room novo);
 *  - reconecta + invalida queries ao voltar AppState para 'active';
 *  - reconecta + invalida ao recuperar a rede (NetInfo);
 *  - reconecta com token novo após refresh;
 *  - desconecta no logout;
 *  - cleanup desconecta no unmount.
 *
 * AppState é mockado capturando o handler do `addEventListener`. NetInfo usa o
 * mock global de jest.setup (`global.mockNetInfo.listeners`).
 *
 * Gotcha: factory de jest.mock só referencia vars `mock*`.
 */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppState, Text, type AppStateStatus } from 'react-native';

// ── Mock do wsService ────────────────────────────────────────────────────────
// A factory de jest.mock é hoisted: só pode referenciar vars `mock*`. Definimos
// o objeto DENTRO da factory e o recuperamos depois via o módulo importado.
jest.mock('@/services/websocket/websocket.service', () => ({
    wsService: {
        connect: jest.fn(),
        disconnect: jest.fn(),
        reconnect: jest.fn(),
        on: jest.fn(),
        off: jest.fn(),
        onStatusChange: jest.fn(() => () => undefined),
        status: 'disconnected',
    },
}));

declare const global: {
    mockNetInfo: { listeners: Set<(state: { isConnected: boolean | null }) => void> };
};

import { wsService } from '@/services/websocket/websocket.service';
import { WebSocketProvider } from '@/providers/WebSocketProvider';
import { useAuthStore } from '@/stores/auth.store';
import { useStoreStore } from '@/stores/store.store';

const mockWs = wsService as unknown as {
    connect: jest.Mock;
    disconnect: jest.Mock;
    reconnect: jest.Mock;
    on: jest.Mock;
    off: jest.Mock;
    onStatusChange: jest.Mock;
};

// ── AppState: espiona o addEventListener real (jest-expo) p/ capturar o handler ─
const mockAppState = {
    handler: null as null | ((s: AppStateStatus) => void),
};

const ownerUser = {
    id: 1,
    full_name: 'Owner',
    email: 'o@aems.com',
    role: 'owner',
    is_active: true,
    created_at: '2024-01-01',
} as never;

const storeUser = {
    id: 2,
    full_name: 'Op',
    email: 'op@aems.com',
    role: 'user',
    store_id: 3,
    is_active: true,
    created_at: '2024-01-01',
} as never;

function setAuth(user: never | null, accessToken: string | null) {
    useAuthStore.setState({
        user,
        tokens: accessToken
            ? { accessToken, refreshToken: 'r', expiresIn: 1800 }
            : null,
        isAuthenticated: !!user && !!accessToken,
        isLoading: false,
        effectivePermissions: null,
    });
}

async function renderProvider() {
    const qc = new QueryClient();
    const invalidateSpy = jest
        .spyOn(qc, 'invalidateQueries')
        .mockImplementation(() => Promise.resolve());
    // RNTL v14: `render` é assíncrono (envolve em act) — precisa de await.
    const { unmount } = await render(
        <QueryClientProvider client={qc}>
            <WebSocketProvider>
                <Text>child</Text>
            </WebSocketProvider>
        </QueryClientProvider>
    );
    return { qc, invalidateSpy, unmount };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockAppState.handler = null;
    global.mockNetInfo.listeners.clear();
    useStoreStore.setState({ availableStores: [], selectedStoreId: null, isMultiStore: false });

    // App começa em foreground: o provider inicializa o ref de AppState com
    // `currentState`, então fixamos 'active' para que um novo 'active' seja
    // corretamente tratado como "permaneceu ativo" (sem transição).
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });

    // Captura o handler de 'change' registrado pelo provider. O `remove`
    // devolvido limpa o handler (para o teste de cleanup verificar o unsubscribe).
    jest.spyOn(AppState, 'addEventListener').mockImplementation(
        (_event: string, cb: (s: AppStateStatus) => void) => {
            mockAppState.handler = cb;
            return { remove: jest.fn(() => (mockAppState.handler = null)) } as never;
        }
    );
});

afterEach(() => {
    jest.restoreAllMocks();
    setAuth(null, null);
});

describe('conexão após login', () => {
    it('Owner conecta no room "all"', async () => {
        setAuth(ownerUser, 'tok-owner');
        await renderProvider();
        await waitFor(() => expect(mockWs.connect).toHaveBeenCalledWith('tok-owner', 'all'));
    });

    it('usuário de loja conecta na loja selecionada', async () => {
        setAuth(storeUser, 'tok-op');
        useStoreStore.setState({ selectedStoreId: 7 });
        await renderProvider();
        await waitFor(() => expect(mockWs.connect).toHaveBeenCalledWith('tok-op', 7));
    });

    it('usuário de loja sem seleção usa a própria store_id', async () => {
        setAuth(storeUser, 'tok-op');
        await renderProvider(); // selectedStoreId = null
        await waitFor(() => expect(mockWs.connect).toHaveBeenCalledWith('tok-op', 3));
    });

    it('não conecta quando não autenticado (e desconecta)', async () => {
        setAuth(null, null);
        await renderProvider();
        await waitFor(() => expect(mockWs.disconnect).toHaveBeenCalled());
        expect(mockWs.connect).not.toHaveBeenCalled();
    });
});

describe('troca de loja', () => {
    it('reabre no room novo ao mudar selectedStoreId', async () => {
        setAuth(storeUser, 'tok-op');
        useStoreStore.setState({ selectedStoreId: 1 });
        await renderProvider();
        await waitFor(() => expect(mockWs.connect).toHaveBeenLastCalledWith('tok-op', 1));

        await act(async () => {
            useStoreStore.setState({ selectedStoreId: 2 });
        });
        await waitFor(() => expect(mockWs.connect).toHaveBeenLastCalledWith('tok-op', 2));
    });
});

describe('refresh de token', () => {
    it('reconecta com o token novo quando accessToken muda', async () => {
        setAuth(ownerUser, 'old');
        await renderProvider();
        await waitFor(() => expect(mockWs.connect).toHaveBeenLastCalledWith('old', 'all'));

        await act(async () => {
            setAuth(ownerUser, 'new');
        });
        await waitFor(() => expect(mockWs.connect).toHaveBeenLastCalledWith('new', 'all'));
    });
});

describe('logout', () => {
    it('desconecta quando isAuthenticated vira false', async () => {
        setAuth(ownerUser, 'tok');
        await renderProvider();
        await waitFor(() => expect(mockWs.connect).toHaveBeenCalled());
        mockWs.disconnect.mockClear();

        await act(async () => {
            setAuth(null, null);
        });
        await waitFor(() => expect(mockWs.disconnect).toHaveBeenCalled());
    });
});

describe('AppState foreground', () => {
    it('voltar para active reconecta e invalida as queries ao vivo', async () => {
        setAuth(ownerUser, 'tok');
        const { invalidateSpy } = await renderProvider();
        await waitFor(() => expect(mockAppState.handler).not.toBeNull());
        mockWs.reconnect.mockClear();
        invalidateSpy.mockClear();

        // simula background → active
        await act(async () => {
            mockAppState.handler?.('background');
            mockAppState.handler?.('active');
        });

        expect(mockWs.reconnect).toHaveBeenCalledTimes(1);
        const keys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
        expect(keys).toEqual([['service-orders'], ['scheduling'], ['notifications']]);
    });

    it('não reconecta se permanecer active (sem transição)', async () => {
        setAuth(ownerUser, 'tok');
        await renderProvider();
        await waitFor(() => expect(mockAppState.handler).not.toBeNull());
        mockWs.reconnect.mockClear();
        await act(async () => {
            mockAppState.handler?.('active');
        });
        expect(mockWs.reconnect).not.toHaveBeenCalled();
    });
});

describe('NetInfo reconexão de rede', () => {
    it('recuperar a rede (offline→online) reconecta e invalida', async () => {
        setAuth(ownerUser, 'tok');
        const { invalidateSpy } = await renderProvider();
        await waitFor(() => expect(global.mockNetInfo.listeners.size).toBeGreaterThan(0));
        mockWs.reconnect.mockClear();
        invalidateSpy.mockClear();

        await act(async () => {
            // cai a rede e volta
            for (const l of global.mockNetInfo.listeners) l({ isConnected: false });
            for (const l of global.mockNetInfo.listeners) l({ isConnected: true });
        });

        expect(mockWs.reconnect).toHaveBeenCalledTimes(1);
        const keys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
        expect(keys).toEqual([['service-orders'], ['scheduling'], ['notifications']]);
    });

    it('não reconecta se a rede nunca caiu', async () => {
        setAuth(ownerUser, 'tok');
        await renderProvider();
        await waitFor(() => expect(global.mockNetInfo.listeners.size).toBeGreaterThan(0));
        mockWs.reconnect.mockClear();
        await act(async () => {
            for (const l of global.mockNetInfo.listeners) l({ isConnected: true });
        });
        expect(mockWs.reconnect).not.toHaveBeenCalled();
    });
});

describe('cleanup', () => {
    it('desconecta no unmount', async () => {
        setAuth(ownerUser, 'tok');
        const { unmount } = await renderProvider();
        await waitFor(() => expect(mockWs.connect).toHaveBeenCalled());
        mockWs.disconnect.mockClear();
        await act(async () => unmount());
        expect(mockWs.disconnect).toHaveBeenCalled();
    });

    it('remove o listener de AppState no unmount (sem vazar)', async () => {
        setAuth(ownerUser, 'tok');
        const { unmount } = await renderProvider();
        await waitFor(() => expect(mockAppState.handler).not.toBeNull());
        await act(async () => unmount());
        expect(mockAppState.handler).toBeNull();
    });
});
