import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CreateRollScreen } from '@/screens/inventory/CreateRollScreen';
import { ThemeProvider } from '@/theme';
import { ConfirmProvider } from '@/components/ui';
import { CriticalRollsError } from '@/services/api/inventory.service';

/**
 * INV-04 — CreateRollScreen (componente).
 *
 * Mocka useCreateRoll (mutateAsync), os pickers de dados (useStores single-store,
 * useFilmTypes, useSuppliers) e o Toast. O Select do DS renderiza as opções
 * inline (jest.setup), então tocamos no rótulo do tipo/tonalidade. Cobre:
 *  - caminho feliz: monta payload e chama mutateAsync({ force:false }) + goBack;
 *  - 409 crítico: mutateAsync lança CriticalRollsError → Alert; ao confirmar,
 *    segunda chamada com force:true.
 *
 * Gotcha: factory de jest.mock só referencia vars `mock*`. RNTL v14 → render async.
 */

const mockMutateAsync = jest.fn();
let mockPending = false;
jest.mock('@/hooks/useInventory', () => {
    const actual = jest.requireActual('@/hooks/useInventory');
    return {
        ...actual,
        useCreateRoll: () => ({ mutateAsync: mockMutateAsync, isPending: mockPending }),
        useFilmTypes: () => ({
            data: [
                { id: 7, name: 'Fumê 3M', department: 'film', is_active: true, services: [] },
            ],
            isLoading: false,
        }),
    };
});

jest.mock('@/hooks/useStores', () => ({
    useStores: () => ({
        stores: [{ id: 1, name: 'Loja Centro' }],
        selectedStoreId: 1,
        isMultiStore: false,
        selectStore: jest.fn(),
        allStores: [{ id: 1, name: 'Loja Centro' }],
    }),
}));

jest.mock('@/hooks/useSuppliers', () => ({
    useSuppliers: () => ({ data: [{ id: 5, company_name: 'Fornecedor X' }] }),
}));

jest.mock('@/stores/store.store', () => ({
    useStoreStore: (selector: (s: { selectedStoreId: number | null }) => unknown) =>
        selector({ selectedStoreId: 1 }),
}));

const mockToastError = jest.fn();
jest.mock('@/components/ui/Toast', () => ({
    useToast: () => ({ success: jest.fn(), error: mockToastError, info: jest.fn(), show: jest.fn() }),
}));

jest.mock('@/lib/api-error', () => ({
    getApiErrorMessage: (_err: unknown, fallback: string) => fallback,
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

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <CreateRollScreen
                navigation={navigation as never}
                route={{ key: 'CreateRoll', name: 'CreateRoll' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

/** Preenche o form mínimo válido: tipo, tonalidade e metragem. */
async function fillValidForm(utils: Awaited<ReturnType<typeof renderScreen>>) {
    const { getByText, getByPlaceholderText } = utils;
    // Tipo de película (Select renderiza opção inline).
    await act(async () => {
        fireEvent.press(getByText('Fumê 3M'));
    });
    // Tonalidade (departamento default = film).
    await act(async () => {
        fireEvent.press(getByText('G20'));
    });
    // Metragem.
    await act(async () => {
        fireEvent.changeText(getByPlaceholderText('Ex: 15'), '30');
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockPending = false;
    mockMutateAsync.mockResolvedValue({ id: 1 });
});

describe('CreateRollScreen — caminho feliz', () => {
    it('monta o payload e chama createRoll com force:false + goBack', async () => {
        const utils = await renderScreen();
        await fillValidForm(utils);

        await act(async () => {
            fireEvent.press(utils.getByText('Registrar bobina'));
        });

        await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
        expect(mockMutateAsync).toHaveBeenCalledWith({
            payload: expect.objectContaining({
                store_id: 1,
                film_type_id: 7,
                tonality: 'G20',
                total_meters: 30,
            }),
            force: false,
        });
        await waitFor(() => expect(utils.navigation.goBack).toHaveBeenCalled());
    });
});

describe('CreateRollScreen — fluxo 409 → force', () => {
    it('ao pegar CriticalRollsError abre o diálogo e confirma com force:true', async () => {
        // 1ª chamada lança crítico; 2ª (force) resolve.
        mockMutateAsync
            .mockRejectedValueOnce(new CriticalRollsError())
            .mockResolvedValueOnce({ id: 2 });

        const utils = await renderScreen();
        await fillValidForm(utils);

        await act(async () => {
            fireEvent.press(utils.getByText('Registrar bobina'));
        });

        // Primeira tentativa (force:false) já ocorreu e abriu o ConfirmDialog.
        await utils.findByText('Bobinas críticas pendentes');
        expect(mockMutateAsync).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ force: false })
        );
        expect(mockToastError).not.toHaveBeenCalled();

        // Confirma no botão "Registrar" do diálogo (≠ "Registrar bobina").
        await act(async () => {
            fireEvent.press(utils.getByText('Registrar'));
        });

        await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(2));
        expect(mockMutateAsync).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ force: true })
        );
        await waitFor(() => expect(utils.navigation.goBack).toHaveBeenCalled());
    });
});
