import { useEffect, useRef, type ReactNode } from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
    CreateWithdrawalSheet,
    type CreateWithdrawalSheetRef,
} from '@/components/features/CreateWithdrawalSheet';
import { ThemeProvider } from '@/theme';

/**
 * Bloco 1 — CreateWithdrawalSheet (cascata de saída avulsa).
 *
 * O global de @gorhom/bottom-sheet (jest.setup) renderiza o conteúdo do sheet e
 * as opções dos Selects inline, então percorremos a cascata tocando nos rótulos:
 * Loja → Tipo → Tonalidade → Bobina → Metros → Instalador. Cobre:
 *  - submit monta o payload correto (metros com vírgula → número) + fecha;
 *  - validação de metros: > remaining_meters bloqueia o botão e mostra o aviso.
 *
 * Gotcha: factory de jest.mock só referencia vars `mock*`. RNTL v14 → render async.
 */

// ─── Hooks de dados (bobinas + tipos) e mutation ──────────────────────────────
const mockCreateMutateAsync = jest.fn();
let mockPending = false;

const ROLLS = [
    {
        id: 5,
        store_id: 1,
        store_name: 'Loja Centro',
        film_type_id: 7,
        film_type_name: 'Fumê 3M',
        tonality: 'G20',
        total_meters: 30,
        remaining_meters: 10,
        receipt_date: '2026-06-21',
        status: 'em_uso',
        visual_id: 'CEN-FUM-2606-01',
        color: 'green',
    },
];
const FILM_TYPES = [
    { id: 7, name: 'Fumê 3M', department: 'film', is_active: true, services: [] },
];

jest.mock('@/hooks/useInventory', () => ({
    useFilmRolls: () => ({ data: ROLLS }),
    useFilmTypes: () => ({ data: FILM_TYPES }),
    useCreateWithdrawal: () => ({
        mutateAsync: mockCreateMutateAsync,
        isPending: mockPending,
    }),
}));

// employeesService.list → um instalador na loja da bobina.
const mockEmployeesList = jest.fn();
jest.mock('@/services/api/employees.service', () => ({
    employeesService: {
        list: (...args: unknown[]) => mockEmployeesList(...args),
    },
}));

const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Host() {
    const ref = useRef<CreateWithdrawalSheetRef>(null);
    useEffect(() => {
        ref.current?.present();
    }, []);
    return <CreateWithdrawalSheet ref={ref} defaultStoreId={null} />;
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
    const utils = await render(
        <Providers>
            <Host />
        </Providers>
    );
    return utils;
}

/** Percorre a cascata: Loja → Tipo → Tonalidade → Bobina → Instalador. */
async function walkCascade(utils: Awaited<ReturnType<typeof renderSheet>>) {
    const { getByText } = utils;
    await act(async () => {
        fireEvent.press(getByText('Loja Centro'));
    });
    await act(async () => {
        fireEvent.press(getByText('Fumê 3M'));
    });
    await act(async () => {
        fireEvent.press(getByText('G20'));
    });
    // Rótulo da bobina (data · restam Xm de Ym).
    await act(async () => {
        fireEvent.press(getByText('21/06/2026 · restam 10.0m de 30.0m'));
    });
    // Instalador.
    await act(async () => {
        fireEvent.press(getByText('João Instalador'));
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockPending = false;
    mockCreateMutateAsync.mockResolvedValue({ id: 1 });
    mockEmployeesList.mockResolvedValue({
        employees: [{ id: 9, name: 'João Instalador', store_id: 1, is_active: true }],
        total: 1,
        page: 1,
        pageSize: 500,
    });
});

describe('CreateWithdrawalSheet — submit', () => {
    it('monta o payload (metros com vírgula → número) e chama createWithdrawal', async () => {
        const utils = await renderSheet();
        // Espera os instaladores carregarem (query com enabled: open).
        await waitFor(() => expect(utils.getByText('João Instalador')).toBeTruthy());
        await walkCascade(utils);

        await act(async () => {
            fireEvent.changeText(utils.getByPlaceholderText('Ex: 1,60'), '1,6');
        });

        await act(async () => {
            fireEvent.press(utils.getByText('Registrar saída'));
        });

        await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1));
        expect(mockCreateMutateAsync).toHaveBeenCalledWith({
            film_roll_id: 5,
            employee_id: 9,
            meters: 1.6,
            reason: undefined,
        });
    });

    it('bloqueia submit quando metros excede o restante da bobina', async () => {
        const utils = await renderSheet();
        await waitFor(() => expect(utils.getByText('João Instalador')).toBeTruthy());
        await walkCascade(utils);

        // Bobina tem 10m restantes → 15 excede.
        await act(async () => {
            fireEvent.changeText(utils.getByPlaceholderText('Ex: 1,60'), '15');
        });

        // Aviso visível.
        expect(utils.getByText(/apenas 10.0m/)).toBeTruthy();

        // Tocar em Registrar não dispara a mutation (canSubmit=false).
        await act(async () => {
            fireEvent.press(utils.getByText('Registrar saída'));
        });
        expect(mockCreateMutateAsync).not.toHaveBeenCalled();
    });
});
