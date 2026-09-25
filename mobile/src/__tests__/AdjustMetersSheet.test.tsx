import { useEffect, useRef, type ReactNode } from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
    AdjustMetersSheet,
    type AdjustMetersSheetRef,
} from '@/components/features/AdjustMetersSheet';
import { ThemeProvider } from '@/theme';
import type { FilmRoll } from '@/services/api/inventory.service';

/**
 * AdjustMetersSheet — ajuste de metros restantes (conferência de estoque).
 *
 * O global de @gorhom/bottom-sheet (jest.setup) renderiza o conteúdo do sheet
 * inline. Cobre:
 *  - submit monta o payload correto (metros com vírgula → número) + motivo;
 *  - validação: metros > total bloqueiam o botão e mostram o aviso;
 *  - motivo obrigatório: vazio bloqueia o submit.
 */

const mockAdjustMutateAsync = jest.fn();
let mockPending = false;

jest.mock('@/hooks/useInventory', () => ({
    useAdjustRollMeters: () => ({
        mutateAsync: mockAdjustMutateAsync,
        isPending: mockPending,
    }),
}));

const ROLL: FilmRoll = {
    id: 42,
    store_id: 1,
    store_name: 'Loja Centro',
    film_type_id: 7,
    film_type_name: 'Fumê 3M',
    tonality: 'G20',
    supplier: null,
    supplier_id: null,
    supplier_name: null,
    nfe_number: null,
    total_meters: 30,
    remaining_meters: 10,
    receipt_date: '2026-06-21',
    status: 'em_uso',
    visual_id: 'CEN-FUM-2606-01',
    color: 'green',
    created_at: '2026-06-21T12:00:00Z',
    cost: null,
    lot_number: null,
};

const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Host() {
    const ref = useRef<AdjustMetersSheetRef>(null);
    useEffect(() => {
        ref.current?.present();
    }, []);
    return <AdjustMetersSheet ref={ref} roll={ROLL} />;
}

function newClient() {
    return new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
}

function Providers({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={newClient()}>
            <SafeAreaProvider initialMetrics={metrics}>
                <ThemeProvider>{children}</ThemeProvider>
            </SafeAreaProvider>
        </QueryClientProvider>
    );
}

async function renderSheet() {
    return render(
        <Providers>
            <Host />
        </Providers>
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    mockPending = false;
    mockAdjustMutateAsync.mockResolvedValue({ id: 42 });
});

describe('AdjustMetersSheet', () => {
    it('monta o payload (metros com vírgula → número + motivo) e chama adjustRollMeters', async () => {
        const utils = await renderSheet();

        await act(async () => {
            fireEvent.changeText(utils.getByPlaceholderText('Ex: 30'), '12,5');
        });
        await act(async () => {
            fireEvent.changeText(
                utils.getByPlaceholderText('Ex: conferência física — sobra menor que o sistema'),
                'Conferência física'
            );
        });

        await act(async () => {
            fireEvent.press(utils.getByText('Confirmar ajuste'));
        });

        await waitFor(() => expect(mockAdjustMutateAsync).toHaveBeenCalledTimes(1));
        expect(mockAdjustMutateAsync).toHaveBeenCalledWith({
            id: 42,
            remaining_meters: 12.5,
            note: 'Conferência física',
        });
    });

    it('bloqueia submit quando metros excede o total da bobina', async () => {
        const utils = await renderSheet();

        await act(async () => {
            fireEvent.changeText(utils.getByPlaceholderText('Ex: 30'), '35');
        });
        await act(async () => {
            fireEvent.changeText(
                utils.getByPlaceholderText('Ex: conferência física — sobra menor que o sistema'),
                'Motivo qualquer'
            );
        });

        // Aviso de teto visível.
        expect(utils.getByText(/Não pode exceder o total/)).toBeTruthy();

        await act(async () => {
            fireEvent.press(utils.getByText('Confirmar ajuste'));
        });
        expect(mockAdjustMutateAsync).not.toHaveBeenCalled();
    });

    it('bloqueia submit quando o motivo está vazio', async () => {
        const utils = await renderSheet();

        // Metros válido, motivo em branco (prefill do motivo é vazio).
        await act(async () => {
            fireEvent.changeText(utils.getByPlaceholderText('Ex: 30'), '8');
        });

        await act(async () => {
            fireEvent.press(utils.getByText('Confirmar ajuste'));
        });
        expect(mockAdjustMutateAsync).not.toHaveBeenCalled();
    });
});
