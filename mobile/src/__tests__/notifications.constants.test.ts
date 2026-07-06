import {
    getNotificationTarget,
    getNotificationTypeConfig,
    NOTIFICATION_FALLBACK_CONFIG,
} from '@/constants/notifications';
import { formatRelativeTime } from '@/utils/formatDate';

/**
 * NOT-03 — mapeamento tipo → aba de destino e config de tipo (fallback).
 * + formatRelativeTime (com `now` injetado p/ determinismo).
 */

describe('getNotificationTarget', () => {
    it('order_created / order_completed → ServiceOrders', () => {
        expect(getNotificationTarget('order_created')).toEqual({ tab: 'ServiceOrders' });
        expect(getNotificationTarget('order_completed')).toEqual({ tab: 'ServiceOrders' });
    });

    it('scheduling_created → Scheduling', () => {
        expect(getNotificationTarget('scheduling_created')).toEqual({ tab: 'Scheduling' });
    });

    it('inventory_alert → Inventory', () => {
        expect(getNotificationTarget('inventory_alert')).toEqual({ tab: 'Inventory' });
    });

    it('tipos sem destino navegável → null', () => {
        expect(getNotificationTarget('approval_needed')).toBeNull();
        expect(getNotificationTarget('incident_reported')).toBeNull();
        expect(getNotificationTarget('quality_failed')).toBeNull();
        expect(getNotificationTarget('tipo_desconhecido')).toBeNull();
    });
});

describe('getNotificationTypeConfig', () => {
    it('retorna config conhecida por tipo', () => {
        const cfg = getNotificationTypeConfig('inventory_alert');
        expect(cfg.label).toBe('Alerta de estoque');
        expect(cfg.icon).toBeTruthy();
    });

    it('cai no fallback para tipo desconhecido', () => {
        expect(getNotificationTypeConfig('algo_novo')).toBe(NOTIFICATION_FALLBACK_CONFIG);
    });
});

describe('formatRelativeTime', () => {
    const now = new Date('2026-06-22T12:00:00Z');

    it('< 1 min → "agora"', () => {
        expect(formatRelativeTime('2026-06-22T11:59:30Z', now)).toBe('agora');
    });

    it('minutos / horas / dias', () => {
        expect(formatRelativeTime('2026-06-22T11:55:00Z', now)).toBe('há 5 min');
        expect(formatRelativeTime('2026-06-22T10:00:00Z', now)).toBe('há 2 h');
        expect(formatRelativeTime('2026-06-19T12:00:00Z', now)).toBe('há 3 d');
    });

    it('acima de 7 dias → data absoluta', () => {
        expect(formatRelativeTime('2026-06-01T12:00:00Z', now)).toBe('01/06/2026');
    });

    it('inválido → "—"', () => {
        expect(formatRelativeTime(null, now)).toBe('—');
    });
});
