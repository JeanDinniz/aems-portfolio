/**
 * PUSH-02 — pushNavigation (mapeamento data.type → destino + navegação).
 *
 * `resolvePushDestination` é puro (reusa getNotificationTarget). `navigateFromPush`
 * é testado contra um navigationRef mockado (isReady/navigate).
 */
import { resolvePushDestination, navigateFromPush } from '@/services/push/pushNavigation';

const mockNavigate = jest.fn();
const mockIsReady = jest.fn((..._args: unknown[]) => true);

jest.mock('@/navigation/navigationRef', () => ({
    navigationRef: {
        isReady: (...args: unknown[]) => mockIsReady(...args),
        navigate: (...args: unknown[]) => mockNavigate(...args),
    },
}));

beforeEach(() => {
    jest.clearAllMocks();
    mockIsReady.mockReturnValue(true);
});

describe('resolvePushDestination', () => {
    it('order_created/order_completed → aba ServiceOrders', () => {
        expect(resolvePushDestination({ type: 'order_created' })).toEqual({
            screen: 'Tabs',
            tab: 'ServiceOrders',
        });
        expect(resolvePushDestination({ type: 'order_completed' })).toEqual({
            screen: 'Tabs',
            tab: 'ServiceOrders',
        });
    });

    it('scheduling_created → aba Scheduling', () => {
        expect(resolvePushDestination({ type: 'scheduling_created' })).toEqual({
            screen: 'Tabs',
            tab: 'Scheduling',
        });
    });

    it('inventory_alert → aba Inventory', () => {
        expect(resolvePushDestination({ type: 'inventory_alert' })).toEqual({
            screen: 'Tabs',
            tab: 'Inventory',
        });
    });

    it('related_url ?roll=<id> → detalhe da bobina (prioridade sobre o tipo)', () => {
        expect(
            resolvePushDestination({ type: 'inventory_alert', related_url: '/estoque?roll=123' })
        ).toEqual({ screen: 'RollDetail', id: 123 });
    });

    it('related_url inválido cai no destino do tipo', () => {
        expect(
            resolvePushDestination({ type: 'inventory_alert', related_url: '/estoque?roll=abc' })
        ).toEqual({ screen: 'Tabs', tab: 'Inventory' });
    });

    it('time_clock_reminder → tela TimeClock', () => {
        expect(resolvePushDestination({ type: 'time_clock_reminder' })).toEqual({
            screen: 'TimeClock',
        });
    });

    it('tipo sem destino → tela Notifications', () => {
        expect(resolvePushDestination({ type: 'approval_needed' })).toEqual({
            screen: 'Notifications',
        });
    });

    it('tipo desconhecido / data ausente → tela Notifications', () => {
        expect(resolvePushDestination({ type: 'zzz' })).toEqual({ screen: 'Notifications' });
        expect(resolvePushDestination(undefined)).toEqual({ screen: 'Notifications' });
        expect(resolvePushDestination(null)).toEqual({ screen: 'Notifications' });
    });
});

describe('navigateFromPush', () => {
    it('navega para a aba do módulo com params { screen: tab }', () => {
        navigateFromPush({ type: 'order_created' });
        expect(mockNavigate).toHaveBeenCalledWith('Tabs', { screen: 'ServiceOrders' });
    });

    it('navega aninhado para o detalhe da bobina quando há related_url', () => {
        navigateFromPush({ type: 'inventory_alert', related_url: '/estoque?roll=42' });
        expect(mockNavigate).toHaveBeenCalledWith('Tabs', {
            screen: 'Inventory',
            params: { screen: 'RollDetail', params: { id: 42 } },
        });
    });

    it('navega para TimeClock no lembrete de ponto', () => {
        navigateFromPush({ type: 'time_clock_reminder' });
        expect(mockNavigate).toHaveBeenCalledWith('TimeClock');
    });

    it('navega para Notifications quando não há destino', () => {
        navigateFromPush({ type: 'approval_needed' });
        expect(mockNavigate).toHaveBeenCalledWith('Notifications');
    });

    it('é no-op se o NavigationContainer não estiver pronto', () => {
        mockIsReady.mockReturnValue(false);
        navigateFromPush({ type: 'order_created' });
        expect(mockNavigate).not.toHaveBeenCalled();
    });
});
