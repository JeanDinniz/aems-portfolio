import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TimeClockMirrorScreen } from '@/screens/admin/TimeClockMirrorScreen';
import { ThemeProvider } from '@/theme';
import type { TimeClockMirrorRecord, TimeClockMirrorResponse } from '@/types/time-clock.types';

/**
 * Espelho de Ponto (Admin) — render + filtro por nome + export + foto.
 *
 * Mocka o hook de listagem, StoreSelector/lojas, Toast e downloadAndSharePdf.
 * Cobre: render de cards com geofence; busca client-side por nome; export PDF;
 * toque na foto navega para o PhotoViewer.
 */

let mockMirrorData: TimeClockMirrorResponse | undefined;
jest.mock('@/hooks/useTimeClock', () => ({
    useTimeClockMirror: () => ({
        data: mockMirrorData,
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
        isRefetching: false,
    }),
}));

let mockSelectedStoreId: number | null = null;
jest.mock('@/stores/store.store', () => ({
    useStoreStore: (selector: (s: { selectedStoreId: number | null }) => unknown) =>
        selector({ selectedStoreId: mockSelectedStoreId }),
}));
jest.mock('@/hooks/useStores', () => ({
    useStores: () => ({
        stores: [
            { id: 1, name: 'Loja Centro' },
            { id: 2, name: 'Loja Norte' },
        ],
        selectedStoreId: mockSelectedStoreId,
        isMultiStore: true,
        selectStore: jest.fn(),
    }),
}));

const mockToastError = jest.fn();
const mockToastSuccess = jest.fn();
jest.mock('@/components/ui/Toast', () => {
    const actual = jest.requireActual('@/components/ui/Toast');
    return {
        ...actual,
        useToast: () => ({
            success: mockToastSuccess,
            error: mockToastError,
            info: jest.fn(),
            show: jest.fn(),
        }),
    };
});

const mockDownloadPdf = jest.fn().mockResolvedValue(undefined);
jest.mock('@/utils/exportShare', () => ({
    downloadAndSharePdf: (...args: unknown[]) => mockDownloadPdf(...args),
}));

jest.mock('@/lib/resolveMediaUrl', () => ({
    resolveMediaUrl: (u: string) => (u ? `resolved:${u}` : ''),
}));
jest.mock('@/lib/api-error', () => ({
    getApiErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

// Select-double para o filtro de loja.
jest.mock('@/components/ui/Select', () => {
    const React = require('react');
    const { View } = require('react-native');
    const Select = React.forwardRef((_props: unknown, ref: React.Ref<unknown>) => {
        React.useImperativeHandle(ref, () => ({ present: jest.fn(), dismiss: jest.fn() }));
        return React.createElement(View, null);
    });
    Select.displayName = 'Select';
    return { __esModule: true, Select };
});

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
function makeRecord(over: Partial<TimeClockMirrorRecord> = {}): TimeClockMirrorRecord {
    return {
        id: 1,
        employee_id: 10,
        employee_name: 'Ana Silva',
        store_id: 1,
        store_name: 'Loja Centro',
        type: 'in',
        recorded_at: '2026-07-20T08:00:00',
        recorded_date: '2026-07-20',
        latitude: -23.5,
        longitude: -46.6,
        accuracy_m: 12,
        distance_m: 15,
        is_within_radius: true,
        photo_url: 'https://srv/selfie.jpg',
        ...over,
    };
}
function makeData(items: TimeClockMirrorRecord[]): TimeClockMirrorResponse {
    return {
        items,
        pagination: {
            page: 1,
            limit: 20,
            total: items.length,
            total_pages: 1,
            has_next: false,
            has_prev: false,
        },
    };
}
async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <TimeClockMirrorScreen
                navigation={navigation as never}
                route={{ key: 'TimeClockMirrorAdmin', name: 'TimeClockMirrorAdmin' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockMirrorData = makeData([makeRecord()]);
    mockSelectedStoreId = null;
});

describe('TimeClockMirrorScreen — render', () => {
    it('lista batidas com tipo e badge de geofence', async () => {
        mockMirrorData = makeData([
            makeRecord({ id: 1, employee_name: 'Ana Silva', is_within_radius: true }),
            makeRecord({
                id: 2,
                employee_name: 'Bruno Costa',
                is_within_radius: false,
                distance_m: null,
            }),
        ]);
        const { getByText } = await renderScreen();
        expect(getByText('Ana Silva')).toBeTruthy();
        expect(getByText('Bruno Costa')).toBeTruthy();
        expect(getByText('Na loja')).toBeTruthy();
        expect(getByText('Fora da loja')).toBeTruthy();
    });

    it('mostra "Sem geofence" quando is_within_radius é null', async () => {
        mockMirrorData = makeData([makeRecord({ is_within_radius: null, distance_m: null })]);
        const { getByText } = await renderScreen();
        expect(getByText('Sem geofence')).toBeTruthy();
    });

    it('estado vazio quando não há registros', async () => {
        mockMirrorData = makeData([]);
        const { getByText } = await renderScreen();
        expect(getByText('Nenhum registro')).toBeTruthy();
    });
});

describe('TimeClockMirrorScreen — sinais de offline (REP-A)', () => {
    it('mostra badge "Offline" para batida offline', async () => {
        mockMirrorData = makeData([
            makeRecord({ employee_name: 'Ana Silva', is_offline_record: true }),
        ]);
        const { getByText, queryByText } = await renderScreen();
        expect(getByText('Offline')).toBeTruthy();
        expect(queryByText('Sync tardio')).toBeNull();
    });

    it('mostra "Offline" e "Sync tardio" para batida offline sincronizada tardiamente', async () => {
        mockMirrorData = makeData([
            makeRecord({
                employee_name: 'Ana Silva',
                is_offline_record: true,
                offline_sync_late: true,
            }),
        ]);
        const { getByText } = await renderScreen();
        expect(getByText('Offline')).toBeTruthy();
        expect(getByText('Sync tardio')).toBeTruthy();
    });

    it('não mostra nenhum dos sinais para batida normal (online)', async () => {
        mockMirrorData = makeData([
            makeRecord({ employee_name: 'Ana Silva', is_offline_record: false }),
        ]);
        const { queryByText } = await renderScreen();
        expect(queryByText('Offline')).toBeNull();
        expect(queryByText('Sync tardio')).toBeNull();
    });
});

describe('TimeClockMirrorScreen — busca por nome', () => {
    it('filtra client-side pelo nome do funcionário', async () => {
        mockMirrorData = makeData([
            makeRecord({ id: 1, employee_name: 'Ana Silva' }),
            makeRecord({ id: 2, employee_name: 'Bruno Costa' }),
        ]);
        const { getByLabelText, getByText, queryByText } = await renderScreen();

        await act(async () => {
            fireEvent.changeText(getByLabelText('Buscar funcionário'), 'bruno');
        });

        expect(getByText('Bruno Costa')).toBeTruthy();
        expect(queryByText('Ana Silva')).toBeNull();
    });
});

describe('TimeClockMirrorScreen — export PDF', () => {
    it('exporta com a primeira loja quando "Todas as lojas" está selecionado', async () => {
        mockSelectedStoreId = null;
        const { getByLabelText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Exportar PDF'));
        });

        await waitFor(() => expect(mockDownloadPdf).toHaveBeenCalledTimes(1));
        const arg = mockDownloadPdf.mock.calls[0][0];
        expect(arg.path).toBe('/time-clock/export/pdf');
        expect(arg.params.store_id).toBe(1); // fallback p/ primeira loja
        expect(arg.params.date).toMatch(/^\d{4}-\d{2}-\d{2}$/); // data válida (hoje por default)
        expect(arg.filename).toMatch(/^espelho-ponto-\d{4}-\d{2}-\d{2}\.pdf$/);
    });
});

describe('TimeClockMirrorScreen — foto', () => {
    it('toque na selfie navega para o PhotoViewer com a URL resolvida', async () => {
        mockMirrorData = makeData([makeRecord({ employee_name: 'Ana Silva' })]);
        const { getByLabelText, navigation } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Ver foto de Ana Silva'));
        });

        expect(navigation.navigate).toHaveBeenCalledWith('PhotoViewer', {
            photos: ['resolved:https://srv/selfie.jpg'],
            title: 'Ana Silva',
        });
    });
});
