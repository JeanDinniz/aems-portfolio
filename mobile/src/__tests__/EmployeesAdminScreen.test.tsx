import { render, fireEvent, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { EmployeesAdminScreen } from '@/screens/admin/EmployeesAdminScreen';
import { ThemeProvider } from '@/theme';
import type { EmployeeFilters } from '@/types/employee.types';

/**
 * Admin — Fatia 5 (UX): filtros de Funcionários.
 *
 * Verifica que os chips de status mapeiam para `hr_status` nos filtros passados ao
 * hook (active/away/dismissed; "Todos" → sem hr_status) e que o StoreSelector
 * aparece na faixa de filtros.
 */

const capturedFilters: EmployeeFilters[] = [];

jest.mock('@/hooks/useEmployees', () => ({
    useEmployees: (filters: EmployeeFilters) => {
        capturedFilters.push(filters);
        return {
            employees: [],
            total: 0,
            isLoading: false,
            isError: false,
            refetch: jest.fn(),
            isRefetching: false,
        };
    },
}));

jest.mock('@/hooks/useEmployeesAdmin', () => ({
    useEmployeeStats: () => ({ data: undefined }),
}));

// StoreSelector: com múltiplas lojas para renderizar o botão selecionável.
jest.mock('@/hooks/useStores', () => ({
    useStores: () => ({
        stores: [
            { id: 1, name: 'Loja A' },
            { id: 2, name: 'Loja B' },
        ],
        selectedStoreId: null,
        isMultiStore: true,
        selectStore: jest.fn(),
    }),
}));

let mockSelectedStoreId: number | null = null;
jest.mock('@/stores/store.store', () => ({
    useStoreStore: (selector: (s: { selectedStoreId: number | null }) => unknown) =>
        selector({ selectedStoreId: mockSelectedStoreId }),
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

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <EmployeesAdminScreen
                navigation={navigation as never}
                route={{ key: 'EmployeesAdmin', name: 'EmployeesAdmin' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

function lastFilters(): EmployeeFilters {
    return capturedFilters[capturedFilters.length - 1];
}

beforeEach(() => {
    jest.clearAllMocks();
    capturedFilters.length = 0;
    mockSelectedStoreId = null;
});

describe('EmployeesAdminScreen — filtros', () => {
    it('mostra o StoreSelector na faixa de filtros', async () => {
        const { getByLabelText } = await renderScreen();
        expect(getByLabelText('Loja selecionada: Todas as Lojas')).toBeTruthy();
    });

    it('estado inicial: sem hr_status (Todos) e is_active undefined', async () => {
        await renderScreen();
        expect(lastFilters().hr_status).toBeUndefined();
        expect(lastFilters().is_active).toBeUndefined();
    });

    it('chip Afastados mapeia para hr_status=away', async () => {
        const { getByText } = await renderScreen();
        await act(async () => {
            fireEvent.press(getByText('Afastados'));
        });
        expect(lastFilters().hr_status).toBe('away');
    });

    it('chip Demitidos mapeia para hr_status=dismissed', async () => {
        const { getByText } = await renderScreen();
        await act(async () => {
            fireEvent.press(getByText('Demitidos'));
        });
        expect(lastFilters().hr_status).toBe('dismissed');
    });

    it('injeta store_id da loja global nos filtros', async () => {
        mockSelectedStoreId = 2;
        await renderScreen();
        expect(lastFilters().store_id).toBe(2);
    });
});
