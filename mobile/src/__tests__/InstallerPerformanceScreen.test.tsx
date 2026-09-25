import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { InstallerPerformanceScreen } from '@/screens/installer-performance/InstallerPerformanceScreen';
import { ThemeProvider } from '@/theme';
import type {
    DailyReportResponse,
    IndividualReportResponse,
} from '@/services/api/installer-performance.service';

/**
 * Desempenho de Instaladores (tela) — render + export.
 *
 * Mocka os hooks daily/individual, o service de funcionários (instaladores),
 * StoreSelector, Toast, exportShare e Select (test-doubles inline). Cobre:
 *  - Diário: renderiza grupos/veículos e total do dia;
 *  - Diário: "Exportar PDF" chama downloadAndSharePdf com date/store_id corretos;
 *  - Individual: sem instalador mostra o estado vazio; ao escolher um instalador
 *    via Select-double, "Gerar PDF do Instalador" chama downloadAndSharePdf com
 *    start/end/employee_id.
 */

// ─── hooks daily/individual ──────────────────────────────────────────────────
let mockDailyData: DailyReportResponse | undefined;
let mockIndividualData: IndividualReportResponse | undefined;

jest.mock('@/hooks/useInstallerPerformance', () => ({
    useInstallerDaily: () => ({
        data: mockDailyData,
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
        isRefetching: false,
    }),
    useInstallerIndividual: (filters: unknown) => ({
        data: filters ? mockIndividualData : undefined,
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
        isRefetching: false,
    }),
}));

// ─── employeesService (instaladores) ─────────────────────────────────────────
jest.mock('@/services/api/employees.service', () => ({
    employeesService: {
        list: jest.fn().mockResolvedValue({
            employees: [
                { id: 1, name: 'Ana Silva', store_name: 'Loja Centro' },
                { id: 2, name: 'Bruno Costa', store_name: 'Loja Sul' },
            ],
            total: 2,
        }),
    },
}));

// ─── loja ────────────────────────────────────────────────────────────────────
let mockSelectedStoreId: number | null = 3;
jest.mock('@/stores/store.store', () => ({
    useStoreStore: (selector: (s: { selectedStoreId: number | null }) => unknown) =>
        selector({ selectedStoreId: mockSelectedStoreId }),
}));

jest.mock('@/components/common/StoreSelector', () => {
    const React = require('react');
    const { View } = require('react-native');
    return { StoreSelector: () => React.createElement(View, { accessibilityLabel: 'store-selector' }) };
});

// ─── Toast ────────────────────────────────────────────────────────────────────
const mockToastError = jest.fn();
jest.mock('@/components/ui/Toast', () => ({
    useToast: () => ({
        success: jest.fn(),
        error: mockToastError,
        info: jest.fn(),
        show: jest.fn(),
    }),
}));

// ─── exportShare ──────────────────────────────────────────────────────────────
const mockDownloadPdf = jest.fn().mockResolvedValue(undefined);
jest.mock('@/utils/exportShare', () => ({
    downloadAndSharePdf: (...args: unknown[]) => mockDownloadPdf(...args),
}));

// api-error: repassa fallback
jest.mock('@/lib/api-error', () => ({
    getApiErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

// ─── Select (test-double: renderiza opções como Pressables) ───────────────────
// Para single: onPress passa o value. Para multiple: onPress passa [value].
jest.mock('@/components/ui/Select', () => {
    const React = require('react');
    const { Pressable, Text, View } = require('react-native');
    const Select = React.forwardRef(
        (
            props: {
                options: { value: number | string; label: string }[];
                multiple?: boolean;
                onChange: (v: unknown) => void;
            },
            ref: React.Ref<unknown>
        ) => {
            React.useImperativeHandle(ref, () => ({ present: jest.fn(), dismiss: jest.fn() }));
            return React.createElement(
                View,
                null,
                props.options.map((opt) =>
                    React.createElement(
                        Pressable,
                        {
                            key: String(opt.value),
                            accessibilityLabel: `opt-${opt.label}`,
                            onPress: () =>
                                props.onChange(props.multiple ? [opt.value] : opt.value),
                        },
                        React.createElement(Text, null, opt.label)
                    )
                )
            );
        }
    );
    Select.displayName = 'Select';
    return { __esModule: true, Select };
});

// ─── helpers ──────────────────────────────────────────────────────────────────
const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
function newClient() {
    return new QueryClient({
        defaultOptions: { queries: { retry: false } },
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

// ─── data "hoje" congelada ─────────────────────────────────────────────────────
// A tela usa `new Date()` para o padrão de data/período (dia atual / início do
// mês). Congelamos SÓ o construtor sem argumentos em 20/07/2026, deixando os
// timers reais (waitFor continua funcionando) — assim as asserções de data/end
// são determinísticas independentemente do dia em que o CI roda.
const RealDate = Date;
const FROZEN_NOW = '2026-07-20T12:00:00';
beforeAll(() => {
    global.Date = class extends RealDate {
        constructor(...args: ConstructorParameters<typeof RealDate> | []) {
            if (args.length === 0) {
                super(FROZEN_NOW);
            } else {
                super(...args);
            }
        }
        static now() {
            return new RealDate(FROZEN_NOW).getTime();
        }
    } as DateConstructor;
});
afterAll(() => {
    global.Date = RealDate;
});

function makeDaily(): DailyReportResponse {
    return {
        report_date: '2026-07-20',
        store_name: 'Loja Centro',
        grand_total_cars: 2,
        grand_total_revenue: 500,
        groups: [
            {
                employee_id: 1,
                employee_name: 'Ana Silva',
                total_cars: 2,
                total_revenue: 500,
                vehicles: [
                    {
                        os_id: 100,
                        order_number: 'OS-100',
                        external_os_number: null,
                        plate: 'ABC1D23',
                        vehicle: 'Corolla',
                        store_name: 'Loja Centro',
                        services: ['Insulfilm'],
                        is_courtesy: false,
                        has_shared: false,
                        value: 300,
                    },
                ],
            },
        ],
    };
}

function makeIndividual(): IndividualReportResponse {
    return {
        employee_id: 1,
        employee_name: 'Ana Silva',
        period_start: '2026-07-01',
        period_end: '2026-07-20',
        store_name: null,
        total_cars: 3,
        total_services: 4,
        total_revenue: 900,
        total_points: 12,
        rows: [
            {
                completion_date: '2026-07-10',
                os_id: 200,
                order_number: 'OS-200',
                external_os_number: null,
                plate: 'XYZ9K88',
                vehicle: 'Yaris',
                store_name: 'Loja Sul',
                services: ['PPF'],
                is_courtesy: false,
                is_return: false,
                has_shared: false,
                value: 450,
                points: 4,
            },
        ],
    };
}

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <InstallerPerformanceScreen
                navigation={navigation as never}
                route={{ key: 'InstallerPerformance', name: 'InstallerPerformance' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockDailyData = makeDaily();
    mockIndividualData = makeIndividual();
    mockSelectedStoreId = 3;
});

describe('InstallerPerformanceScreen — Diário', () => {
    it('renderiza grupos, veículos e total do dia', async () => {
        const { getByText, getAllByText } = await renderScreen();
        expect(getAllByText('Ana Silva').length).toBeGreaterThan(0);
        expect(getByText('ABC1D23')).toBeTruthy();
        expect(getByText('Total do dia')).toBeTruthy();
    });

    it('"Exportar PDF" chama downloadAndSharePdf com date/store_id', async () => {
        const { getByLabelText } = await renderScreen();
        await act(async () => {
            fireEvent.press(getByLabelText('Exportar relatório diário em PDF'));
        });
        await waitFor(() => expect(mockDownloadPdf).toHaveBeenCalledTimes(1));
        const arg = mockDownloadPdf.mock.calls[0][0];
        expect(arg.path).toBe('/installer-performance/export/daily');
        expect(arg.params.date).toBe('2026-07-20');
        expect(arg.params.store_id).toBe(3);
        expect(arg.filename).toContain('desempenho_instaladores_');
    });
});

describe('InstallerPerformanceScreen — Individual', () => {
    it('sem instalador mostra estado vazio; após escolher, exporta com employee_id', async () => {
        const { getByText, getByLabelText, getAllByText } = await renderScreen();

        // Vai para a aba Individual.
        await act(async () => {
            fireEvent.press(getByText('Individual'));
        });
        // "Selecione um instalador" aparece 2x (EmptyState + picker); a descrição
        // do EmptyState é única.
        expect(
            getByText('Use o seletor acima para escolher o instalador desejado.')
        ).toBeTruthy();

        // Seleciona um instalador via Select-double (single → passa o value).
        await act(async () => {
            fireEvent.press(getAllByText('Ana Silva — Loja Centro')[0]);
        });

        // Agora o resumo/linhas aparecem e o export está habilitado.
        await waitFor(() => expect(getByText('XYZ9K88')).toBeTruthy());

        await act(async () => {
            fireEvent.press(getByLabelText('Gerar PDF do instalador'));
        });
        await waitFor(() => expect(mockDownloadPdf).toHaveBeenCalledTimes(1));
        const arg = mockDownloadPdf.mock.calls[0][0];
        expect(arg.path).toBe('/installer-performance/export/individual');
        expect(arg.params.employee_id).toBe(1);
        expect(arg.params.start).toBe('2026-07-01');
        expect(arg.params.end).toBe('2026-07-20');
    });
});
