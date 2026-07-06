import { type ReactNode } from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TransferRollScreen } from '@/screens/inventory/TransferRollScreen';
import { ThemeProvider } from '@/theme';

/**
 * INV-05 — TransferRollScreen (tela cheia).
 *
 * Mocka useTransferRoll e useStores (3 lojas; a atual é excluída das opções).
 * Cobre: exclusão da loja atual, transfer chamado com a loja escolhida e goBack.
 */

const mockTransferMutateAsync = jest.fn();
let mockTransferPending = false;
jest.mock('@/hooks/useInventory', () => ({
    useTransferRoll: () => ({
        mutateAsync: mockTransferMutateAsync,
        isPending: mockTransferPending,
    }),
}));

jest.mock('@/hooks/useStores', () => ({
    useStores: () => ({
        stores: [],
        selectedStoreId: 1,
        isMultiStore: true,
        selectStore: jest.fn(),
        // Transferência usa a lista COMPLETA (allStores), não a filtrada por perfil.
        allStores: [
            { id: 1, name: 'Loja Centro' },
            { id: 2, name: 'Loja Norte' },
            { id: 3, name: 'Loja Sul' },
        ],
    }),
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

async function renderScreen(currentStoreId = 1) {
    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const route = { params: { id: 42, currentStoreId } };
    const utils = await render(
        <Providers>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <TransferRollScreen navigation={navigation as any} route={route as any} />
        </Providers>
    );
    return { ...utils, navigation };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockTransferPending = false;
    mockTransferMutateAsync.mockResolvedValue({ id: 42, store_id: 2 });
});

describe('TransferRollScreen', () => {
    it('exclui a loja atual das opções de destino', async () => {
        const { queryByText, getByText } = await renderScreen(1);
        expect(queryByText('Loja Centro')).toBeNull();
        expect(getByText('Loja Norte')).toBeTruthy();
        expect(getByText('Loja Sul')).toBeTruthy();
    });

    it('transfere para a loja escolhida e volta', async () => {
        const { getByText, navigation } = await renderScreen(1);

        await act(async () => {
            fireEvent.press(getByText('Loja Norte'));
        });
        await act(async () => {
            fireEvent.press(getByText('Confirmar transferência'));
        });

        await waitFor(() => expect(mockTransferMutateAsync).toHaveBeenCalledTimes(1));
        expect(mockTransferMutateAsync).toHaveBeenCalledWith({ rollId: 42, targetStoreId: 2 });
        await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    });
});
