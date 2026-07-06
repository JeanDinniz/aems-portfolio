import { render, fireEvent, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConsultantsAdminScreen } from '@/screens/admin/ConsultantsAdminScreen';
import { ThemeProvider } from '@/theme';
import type { ConsultantFilters } from '@/types/consultant.types';

/**
 * Admin — Fatia 5 (UX): filtros de Consultores.
 *
 * Verifica que os chips de status mapeiam para `is_active` (Ativos→true,
 * Inativos→false, Todos→undefined), que a loja global entra em `store_id` e que o
 * StoreSelector aparece.
 */

const capturedFilters: ConsultantFilters[] = [];

jest.mock('@/hooks/useConsultants', () => ({
    useConsultants: (filters: ConsultantFilters) => {
        capturedFilters.push(filters);
        return {
            consultants: [],
            total: 0,
            isLoading: false,
            isError: false,
            refetch: jest.fn(),
            isRefetching: false,
        };
    },
}));

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

jest.mock('@/components/ui/Toast', () => ({
    useToast: () => ({ success: jest.fn(), error: jest.fn(), info: jest.fn(), show: jest.fn() }),
}));

jest.mock('@/utils/exportShare', () => ({
    downloadAndShareExcel: jest.fn(),
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
            <ConsultantsAdminScreen
                navigation={navigation as never}
                route={{ key: 'ConsultantsAdmin', name: 'ConsultantsAdmin' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

function lastFilters(): ConsultantFilters {
    return capturedFilters[capturedFilters.length - 1];
}

beforeEach(() => {
    jest.clearAllMocks();
    capturedFilters.length = 0;
    mockSelectedStoreId = null;
});

describe('ConsultantsAdminScreen — filtros', () => {
    it('mostra o StoreSelector na faixa de filtros', async () => {
        const { getByLabelText } = await renderScreen();
        expect(getByLabelText('Loja selecionada: Todas as Lojas')).toBeTruthy();
    });

    it('estado inicial: is_active undefined (Todos)', async () => {
        await renderScreen();
        expect(lastFilters().is_active).toBeUndefined();
    });

    it('chip Ativos mapeia para is_active=true', async () => {
        const { getByText } = await renderScreen();
        await act(async () => {
            fireEvent.press(getByText('Ativos'));
        });
        expect(lastFilters().is_active).toBe(true);
    });

    it('chip Inativos mapeia para is_active=false', async () => {
        const { getByText } = await renderScreen();
        await act(async () => {
            fireEvent.press(getByText('Inativos'));
        });
        expect(lastFilters().is_active).toBe(false);
    });

    it('injeta store_id da loja global nos filtros', async () => {
        mockSelectedStoreId = 1;
        await renderScreen();
        expect(lastFilters().store_id).toBe(1);
    });
});
