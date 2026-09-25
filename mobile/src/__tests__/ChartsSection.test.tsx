import { render, fireEvent, act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ChartsSection from '@/components/features/dashboard/ChartsSection';
import { ThemeProvider } from '@/theme';
import type {
    TimeSeriesPoint,
    TimeSeriesByTypePoint,
    DepartmentBreakdownItem,
    FilmPpfStoreRankingItem,
} from '@/types/dashboard.types';

/**
 * Dashboard 3b — ChartsSection.
 *
 * victory-native e @shopify/react-native-skia são mockados em jest.setup.js
 * (binários nativos). Aqui mockamos os 4 hooks de dados de useDashboard e
 * verificamos: os 4 títulos de gráfico aparecem; a troca de granularidade
 * (chips Dia/Semana/Mês) altera o estado de seleção e refaz a busca por tipo.
 * Não inspecionamos pixels do Skia (mockado).
 */

// ─── Captura da granularidade recebida pelos hooks de timeseries ─────────────
const timeseriesGranularities: string[] = [];

const TIMESERIES: TimeSeriesPoint[] = [
    { date: '2026-04-01', orders_count: 10, revenue: 1000 },
    { date: '2026-05-01', orders_count: 20, revenue: 2500 },
    { date: '2026-06-01', orders_count: 15, revenue: 1800 },
];

const BY_TYPE: TimeSeriesByTypePoint[] = [
    { date: '2026-04-01', film_count: 5, ppf_count: 2, estetica_count: 3 },
    { date: '2026-05-01', film_count: 8, ppf_count: 4, estetica_count: 6 },
];

const DEPARTMENTS: DepartmentBreakdownItem[] = [
    { department: 'film', count: 12, revenue: 5000, pct_revenue: 50 },
    { department: 'ppf', count: 6, revenue: 3000, pct_revenue: 30 },
    { department: 'workshop', count: 4, revenue: 2000, pct_revenue: 20 },
];

const FILM_PPF: FilmPpfStoreRankingItem[] = [
    {
        store_id: 1,
        store_name: 'Loja Centro',
        orders_count: 10,
        revenue: 4000,
        loja_count: 7,
        galpon_count: 3,
    },
    {
        store_id: 2,
        store_name: 'Loja Barra',
        orders_count: 6,
        revenue: 2500,
        loja_count: 4,
        galpon_count: 2,
    },
];

jest.mock('@/hooks/useDashboard', () => {
    const q = (data: unknown) => ({
        data,
        isLoading: false,
        isError: false,
        isRefetching: false,
        refetch: jest.fn(),
    });
    return {
        useDashboardTimeseries: (_params: unknown, granularity: string) => {
            timeseriesGranularities.push(granularity);
            return q(TIMESERIES);
        },
        useDashboardTimeseriesByType: (_params: unknown, granularity: string) => {
            timeseriesGranularities.push(`type:${granularity}`);
            return q(BY_TYPE);
        },
        useDashboardDepartmentBreakdown: () => q(DEPARTMENTS),
        useDashboardFilmPpfRanking: () => q(FILM_PPF),
    };
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

const params = { start_date: '2026-04-01', end_date: '2026-06-30' };

async function renderSection() {
    return render(
        <Providers>
            <ChartsSection params={params} />
        </Providers>
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    timeseriesGranularities.length = 0;
});

describe('ChartsSection — render', () => {
    it('renderiza os 4 títulos de gráfico', async () => {
        const { getByText } = await renderSection();

        expect(getByText('O.S. e Receita no período')).toBeTruthy();
        expect(getByText('O.S. por tipo')).toBeTruthy();
        expect(getByText('Receita por departamento')).toBeTruthy();
        expect(getByText('Película/PPF por loja')).toBeTruthy();
    });

    it('mostra a legenda do donut com rótulos de departamento legíveis', async () => {
        const { getAllByText } = await renderSection();
        // DEPARTMENT_LABELS: film → Película, ppf → PPF, workshop → Oficina.
        // Rótulos aparecem como legenda do donut. "Película" e "PPF" também
        // aparecem na legenda do gráfico por tipo (logo, >= 1 ocorrência cada).
        expect(getAllByText('Película').length).toBeGreaterThan(0);
        expect(getAllByText('PPF').length).toBeGreaterThan(0);
        // "Oficina" só existe no donut (vinda de DEPARTMENT_LABELS).
        expect(getAllByText('Oficina').length).toBeGreaterThan(0);
    });

    it('mostra os nomes das lojas como rótulos do gráfico de barras', async () => {
        const { getByText } = await renderSection();
        expect(getByText('Loja Centro')).toBeTruthy();
        expect(getByText('Loja Barra')).toBeTruthy();
    });
});

describe('ChartsSection — granularidade', () => {
    it('default = Mês selecionado', async () => {
        const { getByLabelText } = await renderSection();
        expect(
            getByLabelText('Granularidade: Mês').props.accessibilityState.selected
        ).toBe(true);
        expect(
            getByLabelText('Granularidade: Dia').props.accessibilityState.selected
        ).toBe(false);
    });

    it('trocar para Dia atualiza a seleção e refaz a busca com a nova granularidade', async () => {
        const { getByLabelText } = await renderSection();

        // O render inicial já consultou com 'month'.
        expect(timeseriesGranularities).toContain('month');

        await act(async () => {
            fireEvent.press(getByLabelText('Granularidade: Dia'));
        });

        expect(
            getByLabelText('Granularidade: Dia').props.accessibilityState.selected
        ).toBe(true);
        expect(
            getByLabelText('Granularidade: Mês').props.accessibilityState.selected
        ).toBe(false);
        // hooks foram chamados novamente com 'day'
        expect(timeseriesGranularities).toContain('day');
        expect(timeseriesGranularities).toContain('type:day');
    });
});
