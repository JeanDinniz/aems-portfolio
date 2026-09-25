import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { MyTimeClockMirrorScreen } from '@/screens/time-clock/MyTimeClockMirrorScreen';
import { ToastProvider } from '@/components/ui/Toast';
import { ThemeProvider } from '@/theme';
import type {
    TimeClockMyMirrorResponse,
    TimeClockRecord,
} from '@/types/time-clock.types';

/**
 * Meu Espelho (autoatendimento) — histórico de comprovantes (REP-A).
 *
 * Mocka o hook `useMyMirror`, o Toast e `downloadAndSharePdf`. Cobre: a ação
 * "Ver comprovante" só aparece em registros com NSR; ao expandir mostra o
 * comprovante (NSR real) e permite baixar o PDF oficial do backend.
 */

let mockMirrorData: TimeClockMyMirrorResponse | undefined;
jest.mock('@/hooks/useTimeClock', () => ({
    useMyMirror: () => ({
        data: mockMirrorData,
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
        isRefetching: false,
    }),
}));

const mockDownloadPdf = jest.fn().mockResolvedValue(undefined);
jest.mock('@/utils/exportShare', () => ({
    downloadAndSharePdf: (...args: unknown[]) => mockDownloadPdf(...args),
}));
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
            <ThemeProvider>
                <ToastProvider>{children}</ToastProvider>
            </ThemeProvider>
        </SafeAreaProvider>
    );
}

function makeRecord(over: Partial<TimeClockRecord> = {}): TimeClockRecord {
    return {
        id: 501,
        type: 'in',
        recorded_at: '2026-09-01T07:00:00-03:00',
        photo_url: null,
        distance_m: 10,
        is_within_radius: true,
        ...over,
    };
}

function makeData(items: TimeClockRecord[]): TimeClockMyMirrorResponse {
    return {
        period: '24h',
        employee_id: 10,
        employee_name: 'Ana Silva',
        store_name: 'Loja Centro',
        start: '2026-08-31T07:00:00-03:00',
        end: '2026-09-01T07:00:00-03:00',
        items,
    };
}

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <MyTimeClockMirrorScreen
                navigation={navigation as never}
                route={{ key: 'MyTimeClockMirror', name: 'MyTimeClockMirror' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockMirrorData = undefined;
});

describe('MyTimeClockMirrorScreen — comprovantes', () => {
    it('mostra "Ver comprovante" apenas em registros com NSR', async () => {
        mockMirrorData = makeData([
            makeRecord({
                id: 501,
                nsr: 7,
                receipt: {
                    nsr: 7,
                    employer_name: 'EMPRESA EXEMPLO LTDA',
                    employer_cnpj: '12345678000199',
                    employee_name: 'Ana Silva',
                    employee_cpf: '12345678901',
                    type: 'in',
                    recorded_at: '2026-09-01T07:00:00-03:00',
                    is_offline_record: false,
                    system_id: 'AEMS-REP-A',
                    hash_short: 'abc12345',
                },
            }),
            makeRecord({ id: 502, type: 'out', nsr: null }),
        ]);

        const { getAllByLabelText } = await renderScreen();
        // Só o registro com NSR expõe a ação.
        expect(getAllByLabelText('Ver comprovante')).toHaveLength(1);
    });

    it('expande o comprovante e baixa o PDF oficial', async () => {
        mockMirrorData = makeData([
            makeRecord({
                id: 777,
                nsr: 12,
                receipt: {
                    nsr: 12,
                    employer_name: 'EMPRESA EXEMPLO LTDA',
                    employer_cnpj: '12345678000199',
                    employee_name: 'Ana Silva',
                    employee_cpf: '12345678901',
                    type: 'in',
                    recorded_at: '2026-09-01T07:00:00-03:00',
                    is_offline_record: false,
                    system_id: 'AEMS-REP-A',
                    hash_short: 'def67890',
                },
            }),
        ]);

        const { getByLabelText, getByText } = await renderScreen();

        await act(async () => {
            fireEvent.press(getByLabelText('Ver comprovante'));
        });

        // O comprovante (NSR real) aparece expandido.
        expect(getByText(/NSR: 12/)).toBeTruthy();

        await act(async () => {
            fireEvent.press(getByText('Salvar / Compartilhar'));
        });

        await waitFor(() => expect(mockDownloadPdf).toHaveBeenCalledTimes(1));
        expect(mockDownloadPdf.mock.calls[0][0].path).toBe('/time-clock/records/777/receipt');
    });
});
