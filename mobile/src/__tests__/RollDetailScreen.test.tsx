import { type ReactNode } from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RollDetailScreen } from '@/screens/inventory/RollDetailScreen';
import { ThemeProvider } from '@/theme';
import { ConfirmProvider } from '@/components/ui';
import type { FilmRoll } from '@/services/api/inventory.service';

/**
 * Regressão do crash "abrir bobina fecha o app": o backend serializa
 * `cost` (Decimal) como STRING; o detalhe chamava `roll.cost.toFixed(2)` numa
 * string → TypeError no render → crash. Agora usa `formatDecimalBRL`.
 */

let mockRoll: FilmRoll;
jest.mock('@/hooks/useInventory', () => ({
    useRoll: () => ({ data: mockRoll, isLoading: false, isError: false, refetch: jest.fn() }),
    useRollConsumptions: () => ({ data: [] }),
    useExhaustRoll: () => ({ mutate: jest.fn(), isPending: false }),
    useRestoreRoll: () => ({ mutate: jest.fn(), isPending: false }),
    useOpenRoll: () => ({ mutate: jest.fn(), isPending: false }),
    useDeleteRoll: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('@/hooks/useMyPermissions', () => ({
    useCanEdit: () => false,
}));

const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Providers({ children }: { children: ReactNode }) {
    return (
        <SafeAreaProvider initialMetrics={metrics}>
            <ThemeProvider>
                <ConfirmProvider>{children}</ConfirmProvider>
            </ThemeProvider>
        </SafeAreaProvider>
    );
}

function baseRoll(overrides: Partial<FilmRoll> = {}): FilmRoll {
    return {
        id: 42,
        store_id: 1,
        store_name: 'BYD Unidade 08',
        film_type_id: 3,
        film_type_name: 'Poliester',
        tonality: 'G20',
        supplier: null,
        supplier_id: null,
        supplier_name: null,
        nfe_number: null,
        total_meters: 15,
        remaining_meters: 8,
        receipt_date: '2026-09-02',
        status: 'em_uso',
        visual_id: 'Poliester_G20_02092026',
        color: 'blue',
        created_at: '2026-09-02T10:00:00Z',
        cost: null,
        lot_number: null,
        ...overrides,
    };
}

async function renderScreen() {
    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const route = { params: { id: 42 } };
    return render(
        <Providers>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <RollDetailScreen navigation={navigation as any} route={route as any} />
        </Providers>
    );
}

describe('RollDetailScreen — custo (Decimal como string)', () => {
    it('NÃO crasha e formata o custo quando cost vem como string do backend', async () => {
        // Runtime real: Pydantic v2 manda "150.00" (string), não número.
        mockRoll = baseRoll({ cost: '150.00' });
        const { getByText } = await renderScreen();
        expect(getByText(/150,00/)).toBeTruthy();
        expect(getByText(/R\$/)).toBeTruthy();
    });

    it('mostra "—" no custo quando cost é null (sem R$ na tela)', async () => {
        mockRoll = baseRoll({ cost: null });
        const { queryByText } = await renderScreen();
        expect(queryByText(/R\$/)).toBeNull();
    });
});
