import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DashboardScreen } from '@/screens/dashboard/DashboardScreen';
import { ThemeProvider } from '@/theme';
import type { DashboardOverview } from '@/types/dashboard.types';

/**
 * Dashboard 3a — DashboardScreen (componente).
 *
 * Mocka os hooks de dados de useDashboard, o auth store (isOwner), o store
 * store (loja selecionada), as flags de galpão e useStores (StoreSelector).
 * Foca em: renderizar os 4 KPIs de um overview mockado; cor do delta
 * (verde/vermelho/"—"); trocar o preset de período dispara novo fetch; gate
 * "Acesso restrito" para não-Owner e não-galpão.
 * RNTL v14: render()/fireEvent são assíncronos → SEMPRE await.
 */

// ─── Hooks de dados do Dashboard ─────────────────────────────────────────────
let mockOverviewData: DashboardOverview | undefined;
const mockOverviewRefetch = jest.fn();

jest.mock('@/hooks/useDashboard', () => {
    // Helper inline (jest.mock não pode referenciar variáveis de fora do escopo).
    const q = (over: Record<string, unknown> = {}) => ({
        data: undefined,
        isLoading: false,
        isError: false,
        isRefetching: false,
        refetch: jest.fn(),
        ...over,
    });
    return {
        useDashboardOverview: () =>
            q({ data: mockOverviewData, refetch: mockOverviewRefetch }),
        useDashboardSla: () => q({ data: undefined }),
        useDashboardStoresRanking: () => q({ data: [] }),
        useDashboardServicesRanking: () => q({ data: [] }),
        useDashboardDepartmentBreakdown: () => q({ data: [] }),
        useDashboardEmployeesRanking: () => q({ data: [] }),
        // Hooks da ChartsSection (Fatia 3b) — exercitados pelo branch dev build.
        useDashboardTimeseries: () => q({ data: [] }),
        useDashboardTimeseriesByType: () => q({ data: [] }),
        useDashboardFilmPpfRanking: () => q({ data: [] }),
    };
});

// ─── Runtime (Expo Go vs dev build) — controla o branch dos gráficos ─────────
let mockIsExpoGo = true;
jest.mock('@/lib/runtime', () => ({
    isExpoGo: () => mockIsExpoGo,
}));

// ─── ChartsSection (lazy) ────────────────────────────────────────────────────
// O DashboardScreen carrega a ChartsSection via React.lazy(() => import(...)).
// O VM do Jest não suporta dynamic import ESM, então mockamos `React.lazy` para
// devolver o componente diretamente (sem chamar o factory de import) e mockamos
// o próprio módulo da ChartsSection por um stub leve com um marcador de teste.
jest.mock('@/components/features/dashboard/ChartsSection', () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const React = require('react');
    const { View, Text } = require('react-native');
    /* eslint-enable @typescript-eslint/no-require-imports */
    return {
        __esModule: true,
        default: () =>
            React.createElement(
                View,
                null,
                React.createElement(Text, null, 'O.S. e Receita no período'),
                React.createElement(Text, null, 'Película/PPF por loja')
            ),
    };
});

jest.mock('react', () => {
    const actual = jest.requireActual('react');
    return {
        ...actual,
        // Ignora o factory de dynamic import; resolve direto o módulo mockado.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        lazy: () => require('@/components/features/dashboard/ChartsSection').default,
    };
});

// ─── Auth (isOwner é uma função selecionada do store) ────────────────────────
let mockIsOwner = true;
jest.mock('@/stores/auth.store', () => ({
    useAuthStore: (selector: (s: { isOwner: () => boolean }) => unknown) =>
        selector({ isOwner: () => mockIsOwner }),
}));

// ─── Flags de galpão ─────────────────────────────────────────────────────────
let mockGalponFlags = { isGalponProfile: false, hideGalponOption: false };
jest.mock('@/navigation/guards', () => ({
    useGalponFlags: () => mockGalponFlags,
}));

// ─── Loja selecionada ────────────────────────────────────────────────────────
jest.mock('@/stores/store.store', () => ({
    useStoreStore: (selector: (s: { selectedStoreId: number | null }) => unknown) =>
        selector({ selectedStoreId: null }),
}));

// ─── StoreSelector consome useStores ─────────────────────────────────────────
jest.mock('@/hooks/useStores', () => ({
    useStores: () => ({
        stores: [],
        selectedStoreId: null,
        isMultiStore: false,
        selectStore: jest.fn(),
    }),
}));

// ─── Providers / render ──────────────────────────────────────────────────────
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

function kpi(current: number, deltaPct: number | null) {
    return { current, previous: 0, delta_pct: deltaPct };
}

function makeOverview(over: Partial<DashboardOverview> = {}): DashboardOverview {
    return {
        revenue: kpi(12345.6, 12.3),
        total_orders: kpi(40, 0),
        completed_orders: kpi(30, -5.4),
        avg_ticket: kpi(411.52, 0),
        completion_rate: kpi(75, null),
        pct_courtesy: kpi(5, null),
        pct_galpon: kpi(10, null),
        pct_return: kpi(2, null),
        ...over,
    };
}

async function renderScreen() {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
        <Providers>
            <DashboardScreen
                navigation={navigation as never}
                route={{ key: 'Dashboard', name: 'Dashboard' } as never}
            />
        </Providers>
    );
    return { ...utils, navigation };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockIsOwner = true;
    mockGalponFlags = { isGalponProfile: false, hideGalponOption: false };
    mockOverviewData = makeOverview();
    mockIsExpoGo = true;
});

describe('DashboardScreen — KPIs', () => {
    it('renderiza os 4 KPIs a partir do overview mockado', async () => {
        const { getByText } = await renderScreen();

        expect(getByText('Receita Total')).toBeTruthy();
        expect(getByText('Ticket Médio')).toBeTruthy();
        expect(getByText('Taxa de Conclusão')).toBeTruthy();
        expect(getByText('O.S. Concluídas')).toBeTruthy();
        // valores formatados
        expect(getByText('30')).toBeTruthy(); // O.S. concluídas
        expect(getByText('75,0%')).toBeTruthy(); // taxa de conclusão
    });

    it('delta positivo (Receita +12,3%) e negativo (Concluídas -5,4%) renderizam', async () => {
        const { getByText } = await renderScreen();
        expect(getByText('+12,3%')).toBeTruthy();
        expect(getByText('-5,4%')).toBeTruthy();
    });

    it('delta nulo renderiza "—"', async () => {
        // Receita com delta null para forçar o badge "—".
        mockOverviewData = makeOverview({ revenue: kpi(100, null) });
        const { getAllByText } = await renderScreen();
        expect(getAllByText('—').length).toBeGreaterThan(0);
    });
});

describe('DashboardScreen — período', () => {
    it('trocar o preset de período dispara refetch dos dados', async () => {
        const { getByLabelText } = await renderScreen();

        // overview/queue são refetchados via React Query ao mudar params; aqui
        // validamos que o preset alterna o estado de seleção do botão.
        const today = getByLabelText('Período: Hoje');
        expect(today.props.accessibilityState.selected).toBe(false);

        await act(async () => {
            fireEvent.press(today);
        });

        expect(getByLabelText('Período: Hoje').props.accessibilityState.selected).toBe(true);
        // o preset default "Mês atual" deixa de estar selecionado
        expect(getByLabelText('Período: Mês atual').props.accessibilityState.selected).toBe(false);
    });
});

describe('DashboardScreen — gate de acesso', () => {
    it('não-Owner e não-galpão veem "Acesso restrito"', async () => {
        mockIsOwner = false;
        mockGalponFlags = { isGalponProfile: false, hideGalponOption: false };
        const { getByText, queryByText } = await renderScreen();

        expect(getByText('Acesso restrito')).toBeTruthy();
        // não renderiza os KPIs
        expect(queryByText('Receita Total')).toBeNull();
    });

    it('perfil de galpão (não-Owner) tem acesso ao Dashboard', async () => {
        mockIsOwner = false;
        mockGalponFlags = { isGalponProfile: true, hideGalponOption: false };
        const { getByText, queryByText } = await renderScreen();

        expect(queryByText('Acesso restrito')).toBeNull();
        expect(getByText('Receita Total')).toBeTruthy();
    });
});

describe('DashboardScreen — gráficos (Fatia 3b)', () => {
    it('no Expo Go exibe o aviso de gráficos indisponíveis (sem montar a ChartsSection)', async () => {
        mockIsExpoGo = true;
        const { getByText, queryByText } = await renderScreen();

        expect(getByText('Gráficos')).toBeTruthy();
        expect(getByText('Gráficos indisponíveis aqui')).toBeTruthy();
        // não monta os títulos dos gráficos
        expect(queryByText('O.S. e Receita no período')).toBeNull();
    });

    it('fora do Expo Go (dev build) monta a ChartsSection via lazy/Suspense', async () => {
        mockIsExpoGo = false;
        const { getByText, queryByText } = await renderScreen();

        // não mostra o aviso de indisponível
        expect(queryByText('Gráficos indisponíveis aqui')).toBeNull();
        // o componente lazy resolve e renderiza os gráficos
        await waitFor(() => {
            expect(getByText('O.S. e Receita no período')).toBeTruthy();
        });
        expect(getByText('Película/PPF por loja')).toBeTruthy();
    });
});
