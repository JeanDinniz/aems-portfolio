import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Desempenho de Instaladores — hooks TanStack Query.
 * Verifica:
 *  - useInstallerDaily chama o service com os filtros e expõe os dados;
 *  - useInstallerIndividual NÃO dispara com filtros null (enabled=false);
 *  - useInstallerIndividual dispara com instalador selecionado.
 *
 * O service é mockado; renderHook da RNTL v14 é assíncrono (await + waitFor).
 */
const mockGetDaily = jest.fn();
const mockGetIndividual = jest.fn();

jest.mock('@/services/api/installer-performance.service', () => ({
    installerPerformanceService: {
        getDaily: (...a: unknown[]) => mockGetDaily(...a),
        getIndividual: (...a: unknown[]) => mockGetIndividual(...a),
    },
}));

import {
    useInstallerDaily,
    useInstallerIndividual,
} from '@/hooks/useInstallerPerformance';

function wrapper(client: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    };
}

function newClient() {
    return new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockGetDaily.mockResolvedValue({ groups: [], grand_total_cars: 0, grand_total_revenue: 0 });
    mockGetIndividual.mockResolvedValue({ rows: [], total_cars: 0 });
});

describe('useInstallerDaily', () => {
    it('chama o service com os filtros e expõe os dados', async () => {
        const filters = { date: '2026-07-20', store_id: 3 };
        const { result } = await renderHook(() => useInstallerDaily(filters), {
            wrapper: wrapper(newClient()),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(mockGetDaily).toHaveBeenCalledWith(filters);
        expect(result.current.data?.grand_total_cars).toBe(0);
    });
});

describe('useInstallerIndividual', () => {
    it('não dispara com filtros null (enabled=false)', async () => {
        const { result } = await renderHook(() => useInstallerIndividual(null), {
            wrapper: wrapper(newClient()),
        });
        // pequeno tempo para garantir que não houve fetch
        await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
        expect(mockGetIndividual).not.toHaveBeenCalled();
    });

    it('dispara com instalador selecionado', async () => {
        const filters = { start: '2026-07-01', end: '2026-07-20', employee_id: 9 };
        const { result } = await renderHook(() => useInstallerIndividual(filters), {
            wrapper: wrapper(newClient()),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(mockGetIndividual).toHaveBeenCalledWith(filters);
    });
});
