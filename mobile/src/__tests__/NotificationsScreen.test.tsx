import { render, fireEvent, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NotificationsScreen } from '@/screens/notifications/NotificationsScreen';
import { ThemeProvider } from '@/theme';
import type { AppNotification } from '@/types/notification.types';

/**
 * NOT-02/03 — NotificationsScreen (componente).
 * Mocka useNotifications / useMarkRead / useMarkAllRead. FlashList é mockado
 * globalmente (jest.setup). Cobre: estados, render de itens, marcar uma (tap),
 * navegação por tipo e marcar todas pelo header.
 */

const mockListState: {
    items: AppNotification[];
    total: number;
    isLoading: boolean;
    isError: boolean;
} = { items: [], total: 0, isLoading: false, isError: false };

const mockRefetch = jest.fn();
const mockFetchNextPage = jest.fn();
const mockMarkRead = jest.fn();
const mockMarkAllRead = jest.fn();

jest.mock('@/hooks/useNotifications', () => ({
    useNotifications: () => ({
        ...mockListState,
        refetch: mockRefetch,
        fetchNextPage: mockFetchNextPage,
        hasNextPage: false,
        isFetchingNextPage: false,
        isRefetching: false,
    }),
    useMarkRead: () => ({ mutate: mockMarkRead, isPending: false }),
    useMarkAllRead: () => ({ mutate: mockMarkAllRead, isPending: false }),
}));

const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Providers({ children }: { children: ReactNode }) {
    return (
        <SafeAreaProvider initialMetrics={metrics}>
            <ThemeProvider>{children}</ThemeProvider>
        </SafeAreaProvider>
    );
}

function makeNotification(over: Partial<AppNotification> = {}): AppNotification {
    return {
        id: 1,
        user_id: 1,
        type: 'order_created',
        title: 'Nova O.S. criada',
        body: 'A O.S. OS-0001 foi criada.',
        is_read: false,
        is_galpon: false,
        created_at: '2026-06-22T11:00:00Z',
        ...over,
    };
}

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <NotificationsScreen
                navigation={navigation as never}
                route={{ key: 'Notifications', name: 'Notifications' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockListState.items = [];
    mockListState.total = 0;
    mockListState.isLoading = false;
    mockListState.isError = false;
});

describe('NotificationsScreen — estados', () => {
    it('Empty: sem itens mostra "Sem notificações"', async () => {
        const { getByText } = await renderScreen();
        expect(getByText('Sem notificações')).toBeTruthy();
    });

    it('Error: mostra ErrorState e retry funciona', async () => {
        mockListState.isError = true;
        const { getByText } = await renderScreen();
        await act(async () => {
            fireEvent.press(getByText('Tentar novamente'));
        });
        expect(mockRefetch).toHaveBeenCalled();
    });

    it('com itens: renderiza título, corpo e subtítulo de não-lidas', async () => {
        mockListState.items = [makeNotification({ id: 1 })];
        mockListState.total = 1;
        const { getByText } = await renderScreen();
        expect(getByText('Nova O.S. criada')).toBeTruthy();
        expect(getByText('A O.S. OS-0001 foi criada.')).toBeTruthy();
        expect(getByText('1 não lida')).toBeTruthy();
    });
});

describe('NotificationsScreen — interações', () => {
    it('tap em não-lida: marca como lida e navega pela aba do tipo', async () => {
        mockListState.items = [makeNotification({ id: 9, type: 'scheduling_created', title: 'Agendou' })];
        mockListState.total = 1;
        const { getByLabelText, navigation } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Agendou'));
        });
        expect(mockMarkRead).toHaveBeenCalledWith(9);
        expect(navigation.navigate).toHaveBeenCalledWith('Tabs', { screen: 'Scheduling' });
    });

    it('tap em lida com tipo sem destino: não marca nem navega', async () => {
        mockListState.items = [
            makeNotification({ id: 5, type: 'approval_needed', title: 'Aprove', is_read: true }),
        ];
        mockListState.total = 1;
        const { getByLabelText, navigation } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Aprove'));
        });
        expect(mockMarkRead).not.toHaveBeenCalled();
        expect(navigation.navigate).not.toHaveBeenCalled();
    });

    it('header "Marcar todas como lidas" dispara markAllRead quando há não-lidas', async () => {
        mockListState.items = [makeNotification({ id: 1, is_read: false })];
        mockListState.total = 1;
        const { getByLabelText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Marcar todas como lidas'));
        });
        expect(mockMarkAllRead).toHaveBeenCalled();
    });

    it('sem não-lidas: botão marcar todas está desabilitado', async () => {
        mockListState.items = [makeNotification({ id: 1, is_read: true })];
        mockListState.total = 1;
        const { getByLabelText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Marcar todas como lidas'));
        });
        expect(mockMarkAllRead).not.toHaveBeenCalled();
    });
});
