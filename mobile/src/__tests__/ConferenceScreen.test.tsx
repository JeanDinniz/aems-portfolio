import { render, fireEvent, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConferenceScreen } from '@/screens/service-orders/ConferenceScreen';
import { ThemeProvider } from '@/theme';
import type { ServiceOrder } from '@/types/service-order.types';

/**
 * OS-10 — ConferenceScreen (componente).
 *
 * Mocka os hooks de dados (useConferenceList/useConferenceSummary/verify/unverify),
 * permissão (useCanEdit), loja, Toast e helpers. Foca em: renderizar a lista,
 * marcar "conferida" (chama verify com o id) e alternar o filtro "Somente cortesia".
 * RNTL v14: render()/fireEvent são assíncronos → SEMPRE await.
 */

// ─── Lista + resumo + mutations de conferência ───────────────────────────────
const mockVerifyMutate = jest.fn();
const mockUnverifyMutate = jest.fn();
let mockItems: ServiceOrder[] = [];
jest.mock('@/hooks/useServiceOrders', () => ({
    useConferenceList: () => ({
        items: mockItems,
        total: mockItems.length,
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
        fetchNextPage: jest.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
        isRefetching: false,
    }),
    useConferenceSummary: () => ({ data: [], isLoading: false }),
    useConferenceSummaryByStore: () => ({ data: [], isLoading: false }),
    useVerifyServiceOrder: () => ({ mutate: mockVerifyMutate }),
    useUnverifyServiceOrder: () => ({ mutate: mockUnverifyMutate }),
    useUpdateServiceOrderStatus: () => ({ mutate: jest.fn(), isPending: false }),
}));

// ─── Permissão / loja / toast / tema / helpers ───────────────────────────────
let mockCanEdit = true;
jest.mock('@/hooks/useMyPermissions', () => ({
    useCanEdit: () => mockCanEdit,
}));
jest.mock('@/stores/store.store', () => ({
    useStoreStore: (selector: (s: { selectedStoreId: number | null }) => unknown) =>
        selector({ selectedStoreId: 1 }),
}));
// StoreSelector (no painel de filtros) consome useStores; stub para o teste.
jest.mock('@/hooks/useStores', () => ({
    useStores: () => ({
        stores: [],
        selectedStoreId: 1,
        isMultiStore: false,
        selectStore: jest.fn(),
    }),
}));
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
jest.mock('@/components/ui/Toast', () => {
    const actual = jest.requireActual('@/components/ui/Toast');
    return {
        ...actual,
        useToast: () => ({
            success: mockToastSuccess,
            error: mockToastError,
            show: jest.fn(),
            info: jest.fn(),
        }),
    };
});
jest.mock('@/lib/api-error', () => ({
    getApiErrorMessage: (_e: unknown, fallback: string) => fallback,
}));
jest.mock('@/utils/formatDate', () => ({
    formatDateBR: (v: string) => v,
}));

// ─── Providers / render ──────────────────────────────────────────────────────
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

function makeOrder(over: Partial<ServiceOrder> = {}): ServiceOrder {
    return {
        id: 10,
        order_number: 'LJ-2406-1',
        external_os_number: '12345',
        plate: 'ABC1D23',
        department: 'film',
        // status FRONTEND (o service mapeia completed→ready); OSStatusBadge usa este.
        status: 'ready',
        location_id: 1,
        location_name: 'Loja Centro',
        is_galpon: false,
        is_return: false,
        is_courtesy: false,
        is_verified: false,
        photos: [],
        damage_photos: [],
        entry_time: '2026-06-20',
        service_date: '2026-06-20',
        completed_at: '2026-06-20',
        ...over,
    } as ServiceOrder;
}

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <ConferenceScreen
                navigation={navigation as never}
                route={{ key: 'Conference', name: 'Conference' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockCanEdit = true;
    mockItems = [];
});

describe('ConferenceScreen', () => {
    it('renderiza as O.S. da lista (card com nº e ação de conferir)', async () => {
        mockItems = [makeOrder({ id: 10, external_os_number: '12345' })];
        const { getByText, getByLabelText } = await renderScreen();

        expect(getByText('OS 12345')).toBeTruthy();
        expect(getByLabelText('Marcar conferida')).toBeTruthy();
    });

    it('marcar conferida chama verify com o id da O.S.', async () => {
        mockItems = [makeOrder({ id: 42, is_verified: false })];
        const { getByLabelText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Marcar conferida'));
        });

        expect(mockVerifyMutate).toHaveBeenCalledTimes(1);
        expect(mockVerifyMutate.mock.calls[0][0]).toBe(42);
        expect(mockUnverifyMutate).not.toHaveBeenCalled();
    });

    it('O.S. já conferida oferece desfazer (chama unverify)', async () => {
        mockItems = [makeOrder({ id: 7, is_verified: true })];
        const { getByLabelText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Conferida'));
        });

        expect(mockUnverifyMutate).toHaveBeenCalledTimes(1);
        expect(mockUnverifyMutate.mock.calls[0][0]).toBe(7);
        expect(mockVerifyMutate).not.toHaveBeenCalled();
    });

    it('sem permissão de conferência, não mostra a ação de marcar', async () => {
        mockCanEdit = false;
        mockItems = [makeOrder({ id: 10 })];
        const { queryByLabelText } = await renderScreen();

        expect(queryByLabelText('Marcar conferida')).toBeNull();
    });

    it('alterna o filtro "Somente cortesia"', async () => {
        mockItems = [makeOrder()];
        const { getByLabelText } = await renderScreen();

        // Abre o painel de filtros e marca "Somente cortesia".
        await act(async () => {
            fireEvent.press(getByLabelText('Mostrar filtros'));
        });
        const courtesy = getByLabelText('Somente cortesia');
        expect(courtesy.props.accessibilityState.checked).toBe(false);

        await act(async () => {
            fireEvent.press(courtesy);
        });
        expect(getByLabelText('Somente cortesia').props.accessibilityState.checked).toBe(true);
    });
});
