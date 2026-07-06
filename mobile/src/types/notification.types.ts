/**
 * NOT-01 — Tipos de Notificação (in-app).
 *
 * Fiéis ao SHAPE NATIVO do backend (`app/modules/notifications/models.py`):
 * `id, user_id, type, title, body, is_read, is_galpon, created_at`.
 *
 * Diferente do web, que remapeia `body`→`message` e `is_read`→`read`, o mobile
 * mantém os nomes do backend (`body`/`is_read`) para evitar ambiguidade.
 *
 * Usamos o nome `AppNotification` (não `Notification`) para não colidir com o
 * tipo global `Notification` da plataforma (DOM/RN typings).
 */

/** Enum de tipo (string) — espelha `NotificationType` do backend. */
export type NotificationType =
    | 'order_created'
    | 'approval_needed'
    | 'inventory_alert'
    | 'incident_reported'
    | 'order_completed'
    | 'quality_failed'
    | 'scheduling_created';

export interface AppNotification {
    id: number;
    user_id: number;
    type: NotificationType;
    title: string;
    body: string;
    is_read: boolean;
    is_galpon: boolean;
    created_at: string;
}

/** Resposta paginada de `GET /notifications`. */
export interface NotificationListResponse {
    items: AppNotification[];
    pagination: {
        total: number;
        page: number;
        limit: number;
    };
}
