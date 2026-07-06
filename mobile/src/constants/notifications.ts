/**
 * NOT-01/03 — Constantes de Notificação.
 *
 * - `NOTIFICATION_TYPE_CONFIG`: ícone + cor + rótulo por tipo, no padrão dos
 *   configs existentes (ROLL_COLOR_CONFIG / APPOINTMENT_STATUS_CONFIG). Tokens
 *   em hex (sem dependência do tema p/ os ícones, que recebem `color` direto).
 * - `getNotificationTarget`: deep link por tipo (NOT-03). A notification do
 *   backend NÃO carrega id do recurso, então navegamos para a ABA/lista do
 *   módulo — nunca para um detalhe.
 */

import { Ionicons } from '@expo/vector-icons';

import type { NotificationType } from '@/types/notification.types';

export interface NotificationTypeConfig {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    /** Cor do ícone / acento (hex). */
    color: string;
    /** Fundo suave do "chip" do ícone (tema claro). */
    iconBg: string;
}

/** Fallback para tipos desconhecidos (futuros tipos no backend). */
export const NOTIFICATION_FALLBACK_CONFIG: NotificationTypeConfig = {
    label: 'Notificação',
    icon: 'notifications-outline',
    color: '#667085', // neutral-500
    iconBg: '#F2F4F7', // neutral-100
};

export const NOTIFICATION_TYPE_CONFIG: Record<NotificationType, NotificationTypeConfig> = {
    order_created: {
        label: 'Nova O.S.',
        icon: 'clipboard-outline',
        color: '#1D4ED8', // blue-700
        iconBg: '#DBEAFE', // blue-100
    },
    order_completed: {
        label: 'O.S. finalizada',
        icon: 'checkmark-done-outline',
        color: '#15803D', // green-700
        iconBg: '#DCFCE7', // green-100
    },
    approval_needed: {
        label: 'Aprovação necessária',
        icon: 'alert-circle-outline',
        color: '#A16207', // yellow-700
        iconBg: '#FEF9C3', // yellow-100
    },
    inventory_alert: {
        label: 'Alerta de estoque',
        icon: 'cube-outline',
        color: '#B91C1C', // red-700
        iconBg: '#FEE2E2', // red-100
    },
    incident_reported: {
        label: 'Ocorrência',
        icon: 'warning-outline',
        color: '#B91C1C', // red-700
        iconBg: '#FEE2E2', // red-100
    },
    quality_failed: {
        label: 'Reprovado na qualidade',
        icon: 'close-circle-outline',
        color: '#B91C1C', // red-700
        iconBg: '#FEE2E2', // red-100
    },
    scheduling_created: {
        label: 'Novo agendamento',
        icon: 'calendar-outline',
        color: '#7C3AED', // violet-600
        iconBg: '#EDE9FE', // violet-100
    },
};

/** Config do tipo com fallback seguro para tipos não mapeados. */
export function getNotificationTypeConfig(type: NotificationType | string): NotificationTypeConfig {
    return (
        NOTIFICATION_TYPE_CONFIG[type as NotificationType] ?? NOTIFICATION_FALLBACK_CONFIG
    );
}

/** Aba destino do deep link por tipo (NOT-03). */
export type NotificationTargetTab = 'ServiceOrders' | 'Scheduling' | 'Inventory';

export interface NotificationTarget {
    tab: NotificationTargetTab;
}

/**
 * Mapeia o tipo para a aba a ser aberta ao tocar na notificação. Tipos sem
 * destino navegável retornam `null` (o usuário permanece na lista).
 */
export function getNotificationTarget(type: NotificationType | string): NotificationTarget | null {
    switch (type) {
        case 'order_created':
        case 'order_completed':
            return { tab: 'ServiceOrders' };
        case 'scheduling_created':
            return { tab: 'Scheduling' };
        case 'inventory_alert':
            return { tab: 'Inventory' };
        default:
            return null;
    }
}
