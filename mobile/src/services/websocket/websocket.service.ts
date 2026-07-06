/**
 * WebSocket service — conexão persistente com auto-reconexão e backoff exponencial.
 * Singleton: use `wsService` exportado.
 *
 * Portado de frontend/src/services/websocket/websocket.service.ts. Diferenças RN:
 * - A URL base vem de `env.API_URL` (IP do Metro em dev; extra em prod), NÃO de
 *   `import.meta.env`. Trocamos `https`→`wss` / `http`→`ws` preservando host/porta.
 * - O path do backend é `/ws/all` (Owner) ou `/ws/{storeId}`. O `env.API_URL`
 *   inclui o sufixo `/api/v1`, que removemos para montar a URL do socket.
 * - React Native expõe `WebSocket` global nativo — não há lib extra.
 */
import { env } from '@/lib/env';

type EventHandler = (data: unknown) => void;
type StatusHandler = (status: WsStatus) => void;

export type WsStatus = 'connecting' | 'connected' | 'disconnected';

const MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;

class WebSocketService {
    private ws: WebSocket | null = null;
    private handlers: Map<string, Set<EventHandler>> = new Map();
    private statusListeners: Set<StatusHandler> = new Set();
    private reconnectDelay = BASE_RECONNECT_DELAY;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private shouldReconnect = false;
    private connectParams: { token: string; storeId: number | 'all' } | null = null;

    status: WsStatus = 'disconnected';

    private _setStatus(s: WsStatus): void {
        // Evita notificações duplicadas (ex.: disconnect() fecha o socket, o que
        // já dispara onclose→'disconnected', e em seguida marca 'disconnected'
        // de novo). Só emite em mudança real de status.
        if (this.status === s) return;
        this.status = s;
        this.statusListeners.forEach((fn) => fn(s));
    }

    onStatusChange(fn: StatusHandler): () => void {
        this.statusListeners.add(fn);
        return () => {
            this.statusListeners.delete(fn);
        };
    }

    connect(token: string, storeId: number | 'all'): void {
        if (this.ws && this.connectParams) {
            this.shouldReconnect = false;
            this.ws.close();
        }
        this.connectParams = { token, storeId };
        this.shouldReconnect = true;
        this.reconnectDelay = BASE_RECONNECT_DELAY;
        this._open();
    }

    /**
     * Deriva a base `ws(s)://host:porta` a partir de `env.API_URL`, removendo o
     * sufixo `/api/v1` (rota REST) — o WebSocket é servido na raiz (`/ws/...`).
     */
    private _wsBase(): string {
        const apiBase = env.API_URL || 'http://localhost:8000';
        return apiBase
            .replace(/^https/, 'wss')
            .replace(/^http/, 'ws')
            .replace(/\/api\/v1\/?$/, '');
    }

    private _open(): void {
        if (!this.connectParams) return;
        const { token, storeId } = this.connectParams;

        const wsBase = this._wsBase();
        const path = storeId === 'all' ? '/ws/all' : `/ws/${storeId}`;
        const url = `${wsBase}${path}?token=${encodeURIComponent(token)}`;

        this._setStatus('connecting');

        try {
            this.ws = new WebSocket(url);
        } catch {
            this._setStatus('disconnected');
            this._scheduleReconnect();
            return;
        }

        this.ws.onopen = () => {
            this.reconnectDelay = BASE_RECONNECT_DELAY;
            this._setStatus('connected');
        };

        this.ws.onmessage = (event: WebSocketMessageEvent) => {
            try {
                const msg = JSON.parse(event.data as string) as {
                    event?: string;
                    data?: unknown;
                };
                if (msg.event) {
                    this.handlers.get(msg.event)?.forEach((h) => h(msg.data));
                }
            } catch {
                // mensagem não-JSON ignorada
            }
        };

        this.ws.onclose = () => {
            this._setStatus('disconnected');
            if (this.shouldReconnect) {
                this._scheduleReconnect();
            }
        };

        this.ws.onerror = () => {
            this.ws?.close();
        };
    }

    private _scheduleReconnect(): void {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this._setStatus('connecting');
        this.reconnectTimer = setTimeout(() => {
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);
            this._open();
        }, this.reconnectDelay);
    }

    disconnect(): void {
        this.shouldReconnect = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.ws?.close();
        this.ws = null;
        this.connectParams = null;
        this.reconnectDelay = BASE_RECONNECT_DELAY;
        this._setStatus('disconnected');
    }

    /**
     * Força a reconexão usando os MESMOS parâmetros (token/room) já configurados.
     * Usado pelo provider ao voltar do background / reconectar a rede, quando o
     * token e o room não mudaram. No-op se nunca houve `connect`.
     */
    reconnect(): void {
        if (!this.connectParams) return;
        const { token, storeId } = this.connectParams;
        this.connect(token, storeId);
    }

    on(event: string, handler: EventHandler): void {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        this.handlers.get(event)!.add(handler);
    }

    off(event: string, handler: EventHandler): void {
        this.handlers.get(event)?.delete(handler);
    }
}

export const wsService = new WebSocketService();
