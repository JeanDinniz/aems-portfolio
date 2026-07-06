import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ServiceOrdersListScreen } from '@/screens/service-orders/ServiceOrdersListScreen';
import { ThemeProvider } from '@/theme';
import { ToastProvider } from '@/components/ui/Toast';
import type { ServiceOrder } from '@/types/service-order.types';

/**
 * OS-02 — ServiceOrdersListScreen (componente).
 * Mocka os hooks de dados (useServiceOrdersList) e de permissão (useCanEdit);
 * FlashList é mockado globalmente (jest.setup) para renderizar os itens.
 * Cobre estados Loading / Error / Empty / com itens, e a busca atualizando filtros.
 */

// Estado do hook de lista, controlável por teste.
const mockListState: {
    items: ServiceOrder[];
    total: number;
    isLoading: boolean;
    isError: boolean;
} = { items: [], total: 0, isLoading: false, isError: false };

const mockRefetch = jest.fn();
const mockFetchNextPage = jest.fn();
let lastFilters: unknown = null;

jest.mock('@/hooks/useServiceOrders', () => ({
    useServiceOrdersList: (filters: unknown) => {
        lastFilters = filters;
        return {
            ...mockListState,
            refetch: mockRefetch,
            fetchNextPage: mockFetchNextPage,
            hasNextPage: false,
            isFetchingNextPage: false,
            isRefetching: false,
        };
    },
}));

let mockCanEdit = false;
jest.mock('@/hooks/useMyPermissions', () => ({
    useCanEdit: () => mockCanEdit,
}));

const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Providers({ children }: { children: ReactNode }) {
    return (
        <SafeAreaProvider initialMetrics={metrics}>
            <ThemeProvider>
                <ToastProvider>{children}</ToastProvider>
            </ThemeProvider>
        </SafeAreaProvider>
    );
}

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <ServiceOrdersListScreen
                navigation={navigation as never}
                route={{ key: 'ServiceOrdersList', name: 'ServiceOrdersList' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

function makeOrder(over: Partial<ServiceOrder> = {}): ServiceOrder {
    return {
        id: 1,
        order_number: '#1001',
        status: 'waiting',
        plate: 'ABC1D23',
        department: 'film',
        service_type: '',
        entry_time: '2026-06-01T10:00:00Z',
        started_at: null,
        completed_at: null,
        technician_id: null,
        technician_name: null,
        consultant_id: null,
        consultant_name: null,
        photos: [],
        damage_photos: [],
        damage_map: null,
        invoice_number: null,
        location_id: 1,
        location_name: 'Loja Centro',
        is_galpon: false,
        is_return: false,
        is_courtesy: false,
        notes: null,
        service_date: null,
        is_verified: false,
        verified_at: null,
        elapsed_minutes: 0,
        created_at: '2026-06-01T10:00:00Z',
        updated_at: '2026-06-01T10:00:00Z',
        ...over,
    } as ServiceOrder;
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockListState.items = [];
    mockListState.total = 0;
    mockListState.isLoading = false;
    mockListState.isError = false;
    mockCanEdit = false;
    lastFilters = null;
});

describe('ServiceOrdersListScreen — estados', () => {
    it('Loading: mostra subtítulo "Carregando..." (skeleton)', async () => {
        mockListState.isLoading = true;
        const { getByText } = await renderScreen();
        expect(getByText('Carregando...')).toBeTruthy();
    });

    it('Error: mostra o ErrorState e o botão de retry funciona', async () => {
        mockListState.isError = true;
        const { getByText } = await renderScreen();
        expect(getByText('Algo deu errado')).toBeTruthy();
        await fireEvent.press(getByText('Tentar novamente'));
        expect(mockRefetch).toHaveBeenCalled();
    });

    it('Empty: sem itens mostra o EmptyState', async () => {
        const { getByText } = await renderScreen();
        expect(getByText('Nenhuma O.S encontrada')).toBeTruthy();
    });

    it('com itens: renderiza os OSCards (placa e número da O.S.)', async () => {
        mockListState.items = [
            makeOrder({ id: 1, external_os_number: 'CONC-1001', plate: 'ABC1D23' }),
            makeOrder({ id: 2, external_os_number: 'CONC-1002', plate: 'XYZ9Z99' }),
        ];
        mockListState.total = 2;
        const { getByText } = await renderScreen();
        expect(getByText('OS CONC-1001')).toBeTruthy();
        expect(getByText('OS CONC-1002')).toBeTruthy();
        expect(getByText('ABC1D23')).toBeTruthy();
        expect(getByText('2 ordens cadastradas')).toBeTruthy();
    });

    it('card usa o nº de O.S. da concessionária (external_os_number)', async () => {
        mockListState.items = [
            makeOrder({ id: 1, order_number: '#1001', external_os_number: 'CONC-5050' }),
        ];
        mockListState.total = 1;
        const { getByText, queryByText } = await renderScreen();
        expect(getByText('OS CONC-5050')).toBeTruthy();
        expect(queryByText('OS #1001')).toBeNull();
    });

    it('sem nº da concessionária: card mostra "OS —", nunca o nº do sistema', async () => {
        mockListState.items = [
            makeOrder({ id: 1, order_number: '#1001', external_os_number: null }),
        ];
        mockListState.total = 1;
        const { getByText, queryByText } = await renderScreen();
        expect(getByText('OS —')).toBeTruthy();
        expect(queryByText('OS #1001')).toBeNull();
    });

    it('subtítulo no singular quando total = 1', async () => {
        mockListState.items = [makeOrder()];
        mockListState.total = 1;
        const { getByText } = await renderScreen();
        expect(getByText('1 ordem cadastrada')).toBeTruthy();
    });
});

describe('ServiceOrdersListScreen — busca', () => {
    it('digitar na busca atualiza filters.search após o debounce', async () => {
        jest.useFakeTimers();
        const { getByPlaceholderText } = await renderScreen();

        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Buscar por placa ou O.S.'), 'ABC1D23');
        });
        // Avança o debounce (~400ms).
        await act(async () => {
            jest.advanceTimersByTime(500);
        });

        await waitFor(() => {
            expect(lastFilters).toMatchObject({ search: 'ABC1D23' });
        });
        jest.useRealTimers();
    });
});

describe('ServiceOrdersListScreen — permissões', () => {
    it('sem can_edit: não há FAB "Nova O.S"', async () => {
        mockCanEdit = false;
        const { queryByText } = await renderScreen();
        expect(queryByText('Nova O.S')).toBeNull();
    });

    it('com can_edit: mostra o FAB "Nova O.S"', async () => {
        mockCanEdit = true;
        mockListState.items = [makeOrder()];
        mockListState.total = 1;
        const { getByText } = await renderScreen();
        expect(getByText('Nova O.S')).toBeTruthy();
    });
});
