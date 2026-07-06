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
