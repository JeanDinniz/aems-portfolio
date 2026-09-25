/**
 * WebSocket service — conexão persistente com auto-reconexão e backoff exponencial.
 * Singleton: use `wsService` exportado.
 */

import { getApiBaseUrl } from '@/lib/apiBase';

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
    this.status = s;
    this.statusListeners.forEach((fn) => fn(s));
  }

  onStatusChange(fn: StatusHandler): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
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

  private _open(): void {
    if (!this.connectParams) return;
    const { token, storeId } = this.connectParams;

    const apiBase = getApiBaseUrl();
    const wsBase = apiBase.replace(/^https/, 'wss').replace(/^http/, 'ws');
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

    this.ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as { event?: string; data?: unknown };
        if (msg.event) {
          this.handlers.get(msg.event)?.forEach((h) => h(msg.data));
        }
      } catch {
        // mensagem não-JSON ignorada
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      this._setStatus('disconnected');
      // 4001/4003 = rejeição do servidor (token inválido / sem acesso ao canal):
      // reconectar em loop nunca vai funcionar — para e fica vermelho.
      if (event.code === 4001 || event.code === 4003) {
        this.shouldReconnect = false;
        return;
      }
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
