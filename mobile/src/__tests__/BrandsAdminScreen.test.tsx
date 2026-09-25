import { render, fireEvent, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BrandsAdminScreen } from '@/screens/admin/BrandsAdminScreen';
import { ThemeProvider } from '@/theme';
import { ConfirmProvider } from '@/components/ui';
import type { BrandItem } from '@/services/api/brands.service';

/**
 * Admin — Fatia 5 (UX): troca Button → Switch nas telas de catálogo.
 *
 * Cobre o comportamento padronizado do `ToggleActiveSwitch` na tela de Marcas:
 * - ATIVAR (off → on): sem diálogo, muta direto com isActive:true.
 * - DESATIVAR (on → off): abre o ConfirmDialog; só muta ao confirmar; ao cancelar, não muta.
 * - Sem `can_edit`: mostra Badge estático (sem Switch).
 */

let mockBrands: BrandItem[] = [];
const mockToggleMutate = jest.fn();
let mockTogglePending = false;

jest.mock('@/hooks/useBrandsAdmin', () => ({
    useBrandsAdmin: () => ({
        data: mockBrands,
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
        isRefetching: false,
    }),
    useToggleBrandActive: () => ({
        mutate: mockToggleMutate,
        isPending: mockTogglePending,
        variables: undefined,
    }),
}));

let mockCanEdit = true;
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
                <ConfirmProvider>{children}</ConfirmProvider>
            </ThemeProvider>
        </SafeAreaProvider>
    );
}

function makeBrand(over: Partial<BrandItem> = {}): BrandItem {
    return {
        id: 1,
        name: 'Toyota',
        code: 'TOY',
        is_active: true,
        created_at: '2026-01-01',
        updated_at: null,
        ...over,
    };
}

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <BrandsAdminScreen
                navigation={navigation as never}
                route={{ key: 'BrandsAdmin', name: 'BrandsAdmin' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockBrands = [];
    mockTogglePending = false;
    mockCanEdit = true;
});

describe('BrandsAdminScreen — Switch Ativar/Desativar', () => {
    it('ATIVAR (off → on) muta direto sem diálogo', async () => {
        mockBrands = [makeBrand({ id: 4, name: 'BYD', is_active: false })];
        const { getByLabelText, queryByText } = await renderScreen();

        await act(async () => {
            fireEvent(getByLabelText('Inativa: BYD'), 'valueChange', true);
        });

        // Ativar é direto: nenhum diálogo de confirmação aparece.
        expect(queryByText('Desativar marca')).toBeNull();
        expect(mockToggleMutate).toHaveBeenCalledWith({ id: 4, isActive: true });
    });

    it('DESATIVAR (on → off) abre diálogo e só muta ao confirmar', async () => {
        mockBrands = [makeBrand({ id: 7, name: 'Toyota', is_active: true })];
        const { getByLabelText, findByText, getByText } = await renderScreen();

        await act(async () => {
            fireEvent(getByLabelText('Ativa: Toyota'), 'valueChange', false);
        });

        // O ConfirmDialog aparece com título e mensagem.
        expect(await findByText('Desativar marca')).toBeTruthy();
        expect(getByText('Desativar Toyota?')).toBeTruthy();

        // Confirma no botão do diálogo.
        await act(async () => {
            fireEvent.press(getByText('Desativar'));
        });

        expect(mockToggleMutate).toHaveBeenCalledWith({ id: 7, isActive: false });
    });

    it('DESATIVAR: cancelar não muta', async () => {
        mockBrands = [makeBrand({ id: 7, name: 'Toyota', is_active: true })];
        const { getByLabelText, findByText, getByText } = await renderScreen();

        await act(async () => {
            fireEvent(getByLabelText('Ativa: Toyota'), 'valueChange', false);
        });

        await findByText('Desativar marca');
        await act(async () => {
            fireEvent.press(getByText('Cancelar'));
        });

        expect(mockToggleMutate).not.toHaveBeenCalled();
    });

    it('sem can_edit mostra Badge estático (sem Switch)', async () => {
        mockCanEdit = false;
        mockBrands = [makeBrand({ id: 1, name: 'Toyota', is_active: true })];
        const { queryByLabelText, getByText } = await renderScreen();

        expect(queryByLabelText('Ativa: Toyota')).toBeNull();
        expect(getByText('Ativa')).toBeTruthy();
    });
});
