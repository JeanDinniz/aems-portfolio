import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SchedulingListScreen } from '@/screens/scheduling/SchedulingListScreen';
import { ThemeProvider } from '@/theme';
import type { Appointment } from '@/types/scheduling.types';

/**
 * AGD-02 — SchedulingListScreen (componente).
 * Mocka os hooks de dados (useAppointments / useSchedulingStoreSummary),
 * permissão (useCanEdit) e loja. FlashList é mockado globalmente (jest.setup),
 * agora também renderizando o ListHeaderComponent (banner/resumo/toggle).
 * Cobre: estados, banner de atrasados, esconder/mostrar finalizados, busca e
 * navegação ao tocar num card.
 */

const mockListState: {
    items: Appointment[];
    total: number;
    isLoading: boolean;
    isError: boolean;
} = { items: [], total: 0, isLoading: false, isError: false };

const mockRefetch = jest.fn();
const mockFetchNextPage = jest.fn();
let lastFilters: unknown = null;

jest.mock('@/hooks/useScheduling', () => ({
    useAppointments: (filters: unknown) => {
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
    useSchedulingStoreSummary: () => ({ data: [], isLoading: false }),
}));

let mockCanEdit = false;
jest.mock('@/hooks/useMyPermissions', () => ({
    useCanEdit: () => mockCanEdit,
}));

let mockSelectedStoreId: number | null = 1;
jest.mock('@/stores/store.store', () => ({
    useStoreStore: (selector: (s: { selectedStoreId: number | null }) => unknown) =>
        selector({ selectedStoreId: mockSelectedStoreId }),
}));

// ─── exportShare + Toast (Carros para fazer PDF) ──────────────────────────────
const mockDownloadPdf = jest.fn().mockResolvedValue(undefined);
jest.mock('@/utils/exportShare', () => ({
    downloadAndSharePdf: (...args: unknown[]) => mockDownloadPdf(...args),
}));

const mockToastError = jest.fn();
jest.mock('@/components/ui/Toast', () => {
    const actual = jest.requireActual('@/components/ui/Toast');
    return {
        ...actual,
        useToast: () => ({
            success: jest.fn(),
            error: mockToastError,
            info: jest.fn(),
            show: jest.fn(),
        }),
    };
});

jest.mock('@/lib/api-error', () => ({
    getApiErrorMessage: (_e: unknown, fallback: string) => fallback,
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

function todayYMD(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
    ).padStart(2, '0')}`;
}

function makeAppointment(over: Partial<Appointment> = {}): Appointment {
    return {
        id: 1,
        store_id: 1,
        store_name: 'Loja Centro',
        department: 'film',
        delivery_date: todayYMD(),
        delivery_time: '10:00',
        external_os_number: null,
        vehicle_plate: 'ABC1D23',
        vehicle_model: 'Onix',
        vehicle_color: 'Branco',
        consultant_id: null,
        consultant_name: 'Carlos',
        service_ids: [1],
        service_names: ['Película'],
        film_entries: null,
        notes: null,
        is_galpon: false,
        is_courtesy: false,
        is_return: false,
        film_type_id: null,
        film_tonality: null,
        status: 'scheduled',
        display_status: 'agendado',
        service_order_id: null,
        service_order_number: null,
        created_at: '2026-06-20T10:00:00Z',
        updated_at: '2026-06-20T10:00:00Z',
        ...over,
    };
}

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <SchedulingListScreen
                navigation={navigation as never}
                route={{ key: 'SchedulingList', name: 'SchedulingList' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockListState.items = [];
    mockListState.total = 0;
    mockListState.isLoading = false;
    mockListState.isError = false;
    mockCanEdit = false;
    mockSelectedStoreId = 1;
    lastFilters = null;
});

describe('SchedulingListScreen — estados', () => {
    it('Loading: subtítulo "Carregando..."', async () => {
        mockListState.isLoading = true;
        const { getByText } = await renderScreen();
        expect(getByText('Carregando...')).toBeTruthy();
    });

    it('Error: mostra ErrorState e retry funciona', async () => {
        mockListState.isError = true;
        const { getByText } = await renderScreen();
        expect(getByText('Algo deu errado')).toBeTruthy();
        await fireEvent.press(getByText('Tentar novamente'));
        expect(mockRefetch).toHaveBeenCalled();
    });

    it('Empty: sem itens mostra EmptyState', async () => {
        const { getByText } = await renderScreen();
        expect(getByText('Nenhum agendamento')).toBeTruthy();
    });

    it('com itens: renderiza o card e o cabeçalho de dia "Hoje"', async () => {
        mockListState.items = [makeAppointment({ id: 1, vehicle_plate: 'ABC1D23' })];
        mockListState.total = 1;
        const { getByText } = await renderScreen();
        expect(getByText('Hoje')).toBeTruthy();
        expect(getByText('ABC1D23')).toBeTruthy();
        expect(getByText('1 agendamento')).toBeTruthy();
    });
});

describe('SchedulingListScreen — atrasados e ocultos', () => {
    it('mostra o banner "N atrasados"', async () => {
        mockListState.items = [
            makeAppointment({ id: 1, display_status: 'atrasado' }),
            makeAppointment({ id: 2, display_status: 'atrasado' }),
        ];
        mockListState.total = 2;
        const { getByText } = await renderScreen();
        expect(getByText('2 atrasados')).toBeTruthy();
    });

    it('esconde finalizados por padrão e revela ao tocar no toggle', async () => {
        mockListState.items = [
            makeAppointment({ id: 1, vehicle_plate: 'AAA0A00', display_status: 'agendado' }),
            makeAppointment({ id: 2, vehicle_plate: 'FIN9F99', display_status: 'finalizado' }),
        ];
        mockListState.total = 2;
        const { getByText, queryByText, getByLabelText } = await renderScreen();

        // O finalizado não aparece inicialmente.
        expect(queryByText('FIN9F99')).toBeNull();
        expect(getByText('Mostrar 1 finalizados/cancelados')).toBeTruthy();

        await act(async () => {
            fireEvent.press(getByLabelText(/Mostrar 1 finalizados/));
        });

        expect(getByText('FIN9F99')).toBeTruthy();
    });
});

describe('SchedulingListScreen — busca e navegação', () => {
    it('busca atualiza filters.search após debounce', async () => {
        jest.useFakeTimers();
        const { getByPlaceholderText } = await renderScreen();

        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Buscar por placa ou O.S.'), 'XYZ');
        });
        await act(async () => {
            jest.advanceTimersByTime(500);
        });

        await waitFor(() => {
            expect(lastFilters).toMatchObject({ search: 'XYZ' });
        });
        jest.useRealTimers();
    });

    it('tocar num card navega para AppointmentDetail com o id', async () => {
        mockListState.items = [makeAppointment({ id: 77, vehicle_plate: 'ABC1D23' })];
        mockListState.total = 1;
        const { getByLabelText, navigation } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText(/Agendamento ABC1D23/));
        });
        expect(navigation.navigate).toHaveBeenCalledWith('AppointmentDetail', { id: 77 });
    });

    it('sem can_edit: não há FAB "Novo"', async () => {
        mockCanEdit = false;
        const { queryByText } = await renderScreen();
        expect(queryByText('Novo')).toBeNull();
    });

    it('com can_edit: mostra o FAB "Novo"', async () => {
        mockCanEdit = true;
        const { getByText } = await renderScreen();
        expect(getByText('Novo')).toBeTruthy();
    });
});

describe('SchedulingListScreen — Carros para fazer (PDF)', () => {
    it('exporta reusando a loja global; sem filtros só envia store_id', async () => {
        mockSelectedStoreId = 1;
        const { getByLabelText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Carros para fazer (PDF)'));
        });

        await waitFor(() => expect(mockDownloadPdf).toHaveBeenCalledTimes(1));
        const arg = mockDownloadPdf.mock.calls[0][0];
        expect(arg.path).toBe('/scheduling/export/carros-para-fazer');
        expect(arg.params.store_id).toBe(1);
        // Sem filtros aplicados na tela: campos ficam undefined (não enviados).
        expect(arg.params.department).toBeUndefined();
        expect(arg.params.category).toBeUndefined();
        expect(arg.params.date_from).toBeUndefined();
        expect(arg.params.date_to).toBeUndefined();
        expect(arg.params.search).toBeUndefined();
        expect(arg.filename).toMatch(/^carros-para-fazer-\d{4}-\d{2}-\d{2}\.pdf$/);
    });

    it('reusa a busca da tela no param search', async () => {
        jest.useFakeTimers();
        const { getByLabelText, getByPlaceholderText } = await renderScreen();

        // Digita na busca e avança o debounce → vira `search`.
        await act(async () => {
            fireEvent.changeText(getByPlaceholderText('Buscar por placa ou O.S.'), 'ABC1D23');
        });
        await act(async () => {
            jest.advanceTimersByTime(500);
        });
        jest.useRealTimers();

        await act(async () => {
            fireEvent.press(getByLabelText('Carros para fazer (PDF)'));
        });

        await waitFor(() => expect(mockDownloadPdf).toHaveBeenCalledTimes(1));
        expect(mockDownloadPdf.mock.calls[0][0].params.search).toBe('ABC1D23');
    });

    it('com "Todas as lojas" (store null) não envia store_id', async () => {
        mockSelectedStoreId = null;
        const { getByLabelText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Carros para fazer (PDF)'));
        });

        await waitFor(() => expect(mockDownloadPdf).toHaveBeenCalledTimes(1));
        expect(mockDownloadPdf.mock.calls[0][0].params.store_id).toBeUndefined();
    });

    it('em erro do export mostra toast de erro', async () => {
        mockDownloadPdf.mockRejectedValueOnce(new Error('boom'));
        const { getByLabelText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Carros para fazer (PDF)'));
        });

        await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    });
});
