/**
 * WS-01 — wsService (singleton) + handlers de invalidação (useWebSocket).
 *
 * Mocka o `WebSocket` global (a factory expõe a última instância para os testes
 * dispararem onopen/onmessage/onclose). Cobre: montagem da URL (ws/wss, room,
 * token), status, reconexão com backoff exponencial, e a invalidação correta de
 * queryKeys por evento (incluindo o `notification`, melhoria do mobile).
 *
 * Gotcha conhecido: a factory de `jest.mock` só pode referenciar vars com
 * prefixo `mock`. Por isso a classe e o registro da instância usam `mock*`.
 */
import { QueryClient } from '@tanstack/react-query';

// ── Mock do WebSocket global ────────────────────────────────────────────────
// Registro das instâncias criadas, para os testes manipularem o ciclo de vida.
const mockSockets: MockWebSocket[] = [];

class MockWebSocket {
    static instances = mockSockets;
    url: string;
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;

    constructor(url: string) {
        this.url = url;
        mockSockets.push(this);
    }

    close() {
        this.closed = true;
        this.onclose?.();
    }
}

(global as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;

// Mock do env (host derivado do Metro inclui /api/v1, que o service remove).
jest.mock('@/lib/env', () => ({
    env: { API_URL: 'http://192.168.1.7:8000/api/v1', WS_URL: 'ws://192.168.1.7:8000', ENV: 'development' },
}));

import { wsService } from '@/services/websocket/websocket.service';
import { registerWsHandlers } from '@/hooks/useWebSocket';

function lastSocket(): MockWebSocket {
    return mockSockets[mockSockets.length - 1];
}

function emit(event: string, data: unknown = {}) {
    lastSocket().onmessage?.({ data: JSON.stringify({ event, data }) });
}

beforeEach(() => {
    jest.useFakeTimers();
    mockSockets.length = 0;
    wsService.disconnect();
    mockSockets.length = 0; // disconnect não cria socket, mas garante limpo
});

afterEach(() => {
    wsService.disconnect();
    jest.clearAllTimers();
    jest.useRealTimers();
});

describe('montagem da URL', () => {
    it('Owner conecta no room /ws/all com http→ws e sem /api/v1', () => {
        wsService.connect('tok en+1', 'all');
        expect(lastSocket().url).toBe(
            'ws://192.168.1.7:8000/ws/all?token=tok%20en%2B1'
        );
    });

    it('usuário de loja conecta em /ws/{storeId}', () => {
        wsService.connect('t', 5);
        expect(lastSocket().url).toBe('ws://192.168.1.7:8000/ws/5?token=t');
    });
});

describe('status', () => {
    it('connecting → connected no onopen; disconnected no close', () => {
        const seen: string[] = [];
        const unsub = wsService.onStatusChange((s) => seen.push(s));

        wsService.connect('t', 'all');
        expect(wsService.status).toBe('connecting');

        lastSocket().onopen?.();
        expect(wsService.status).toBe('connected');

        wsService.disconnect();
        expect(wsService.status).toBe('disconnected');

        expect(seen).toEqual(['connecting', 'connected', 'disconnected']);
        unsub();
    });
});

describe('reconexão com backoff exponencial', () => {
    it('reabre após 1s, depois 2s, ao fechar inesperadamente', () => {
        wsService.connect('t', 'all');
        lastSocket().onopen?.();
        expect(mockSockets.length).toBe(1);

        // queda inesperada → agenda reconexão (1s)
        lastSocket().onclose?.();
        jest.advanceTimersByTime(999);
        expect(mockSockets.length).toBe(1);
        jest.advanceTimersByTime(1);
        expect(mockSockets.length).toBe(2);

        // nova queda → próximo backoff é 2s
        lastSocket().onclose?.();
        jest.advanceTimersByTime(1999);
        expect(mockSockets.length).toBe(2);
        jest.advanceTimersByTime(1);
        expect(mockSockets.length).toBe(3);
    });

    it('disconnect cancela o timer de reconexão', () => {
        wsService.connect('t', 'all');
        lastSocket().onclose?.();
        wsService.disconnect();
        jest.advanceTimersByTime(60_000);
        // nenhum socket novo além do inicial
        expect(mockSockets.length).toBe(1);
    });
});

describe('reconnect() reusa token/room', () => {
    it('reabre com os mesmos parâmetros', () => {
        wsService.connect('tk', 9);
        wsService.reconnect();
        expect(lastSocket().url).toBe('ws://192.168.1.7:8000/ws/9?token=tk');
    });

    it('é no-op se nunca conectou', () => {
        wsService.reconnect();
        expect(mockSockets.length).toBe(0);
    });
});

describe('handlers de invalidação (registerWsHandlers)', () => {
    let qc: QueryClient;
    let spy: jest.SpyInstance;
    let cleanup: () => void;

    beforeEach(() => {
        qc = new QueryClient();
        spy = jest.spyOn(qc, 'invalidateQueries').mockImplementation(() => Promise.resolve());
        cleanup = registerWsHandlers(qc);
        wsService.connect('t', 'all');
    });

    afterEach(() => {
        cleanup();
        qc.clear();
    });

    function keysFor(event: string): unknown[][] {
        spy.mockClear();
        emit(event);
        return spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    }

    it('os_created → service-orders', () => {
        expect(keysFor('os_created')).toEqual([['service-orders']]);
    });

    it('os_status_changed/os_finalized/os_cancelled → service-orders', () => {
        expect(keysFor('os_status_changed')).toEqual([['service-orders']]);
        expect(keysFor('os_finalized')).toEqual([['service-orders']]);
        expect(keysFor('os_cancelled')).toEqual([['service-orders']]);
    });

    it('os_updated → service-orders + scheduling', () => {
        expect(keysFor('os_updated')).toEqual([['service-orders'], ['scheduling']]);
    });

    it('os_verified → service-orders + conference summary', () => {
        expect(keysFor('os_verified')).toEqual([
            ['service-orders'],
            ['service-orders', 'conference', 'summary'],
        ]);
    });

    it('appointment_* → scheduling', () => {
        expect(keysFor('appointment_created')).toEqual([['scheduling']]);
        expect(keysFor('appointment_updated')).toEqual([['scheduling']]);
        expect(keysFor('appointment_cancelled')).toEqual([['scheduling']]);
    });

    it('semaphore_updated não invalida mais nada (fila do dashboard removida)', () => {
        expect(keysFor('semaphore_updated')).toEqual([]);
    });

    it('notification → notifications + unread-count (melhoria do mobile)', () => {
        expect(keysFor('notification')).toEqual([
            ['notifications'],
            ['notifications', 'unread-count'],
        ]);
    });

    it('cleanup remove os listeners (evento não invalida mais)', () => {
        cleanup();
        spy.mockClear();
        emit('os_created');
        expect(spy).not.toHaveBeenCalled();
        // re-registra para o afterEach não falhar no cleanup duplo
        cleanup = registerWsHandlers(qc);
    });

    it('mensagem não-JSON é ignorada sem lançar', () => {
        spy.mockClear();
        expect(() => lastSocket().onmessage?.({ data: 'not json' })).not.toThrow();
        expect(spy).not.toHaveBeenCalled();
    });
});
