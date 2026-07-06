import { render, fireEvent, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BrandsAdminScreen } from '@/screens/admin/BrandsAdminScreen';
import { ThemeProvider } from '@/theme';
import type { BrandItem } from '@/services/api/brands.service';

/**
 * Admin — Fatia 5 (UX): troca Button → Switch nas telas de catálogo.
 *
 * Cobre o comportamento padronizado do `ToggleActiveSwitch` na tela de Marcas:
 * - ATIVAR (off → on): sem Alert, muta direto com isActive:true.
 * - DESATIVAR (on → off): abre Alert; só muta ao confirmar; ao cancelar, não muta.
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
            <ThemeProvider>{children}</ThemeProvider>
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
    it('ATIVAR (off → on) muta direto sem Alert', async () => {
        mockBrands = [makeBrand({ id: 4, name: 'BYD', is_active: false })];
        const alertSpy = jest.spyOn(Alert, 'alert');
        const { getByLabelText } = await renderScreen();

        await act(async () => {
            fireEvent(getByLabelText('Inativa: BYD'), 'valueChange', true);
        });

        expect(alertSpy).not.toHaveBeenCalled();
        expect(mockToggleMutate).toHaveBeenCalledWith({ id: 4, isActive: true });
    });

    it('DESATIVAR (on → off) abre Alert e só muta ao confirmar', async () => {
        mockBrands = [makeBrand({ id: 7, name: 'Toyota', is_active: true })];
        const alertSpy = jest
            .spyOn(Alert, 'alert')
            .mockImplementation((_t, _m, buttons) => {
                // Confirma pressionando o botão destrutivo (não-cancel).
                buttons?.find((b) => b.style === 'destructive')?.onPress?.();
            });
        const { getByLabelText } = await renderScreen();

        await act(async () => {
            fireEvent(getByLabelText('Ativa: Toyota'), 'valueChange', false);
        });

        expect(alertSpy).toHaveBeenCalledWith(
            'Desativar marca',
            'Desativar Toyota?',
            expect.anything()
        );
        expect(mockToggleMutate).toHaveBeenCalledWith({ id: 7, isActive: false });
    });

    it('DESATIVAR: cancelar não muta', async () => {
        mockBrands = [makeBrand({ id: 7, name: 'Toyota', is_active: true })];
        jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
            // Cancela: aciona o botão de cancelar (sem onPress de muta).
            buttons?.find((b) => b.style === 'cancel')?.onPress?.();
        });
        const { getByLabelText } = await renderScreen();

        await act(async () => {
            fireEvent(getByLabelText('Ativa: Toyota'), 'valueChange', false);
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
