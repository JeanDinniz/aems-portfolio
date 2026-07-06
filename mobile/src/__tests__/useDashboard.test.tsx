import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Dashboard 3a — hooks do Dashboard executivo.
 * Verifica:
 *  - queryKeys corretas (overview/services/queue);
 *  - `enabled` falso quando sem período (não dispara o service);
 *  - useDashboardServicesRanking injeta limit: 10 e o department;
 *  - useDashboardQueue usa queryKey ['dashboard','queue'] (sem params),
 *    tem refetchInterval e repassa o storeId ao service.
 *
 * O analyticsService é mockado. Gotcha: renderHook da RNTL v14 é assíncrono.
 */
const mockGetOverview = jest.fn();
const mockGetServices = jest.fn();
const mockGetQueue = jest.fn();

jest.mock('@/services/api/analytics.service', () => {
    const actual = jest.requireActual('@/services/api/analytics.service');
    return {
        ...actual,
        analyticsService: {
            getOverview: (...a: unknown[]) => mockGetOverview(...a),
            getServicesRanking: (...a: unknown[]) => mockGetServices(...a),
            getQueue: (...a: unknown[]) => mockGetQueue(...a),
        },
    };
});

import {
    useDashboardOverview,
    useDashboardServicesRanking,
    useDashboardQueue,
} from '@/hooks/useDashboard';
import type { DashboardParams } from '@/services/api/analytics.service';

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

const PARAMS: DashboardParams = {
    start_date: '2026-06-01',
    end_date: '2026-06-30',
    store_id: 3,
};

beforeEach(() => {
    jest.clearAllMocks();
    mockGetOverview.mockResolvedValue({ revenue: { current: 1 } });
    mockGetServices.mockResolvedValue([]);
    mockGetQueue.mockResolvedValue([]);
});

describe('useDashboardOverview', () => {
    it('usa queryKey ["dashboard","overview", params] e chama o service com período', async () => {
        const client = newClient();
        const { result } = await renderHook(() => useDashboardOverview(PARAMS), {
            wrapper: wrapper(client),
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(mockGetOverview).toHaveBeenCalledWith(PARAMS);
        expect(client.getQueryCache().find({ queryKey: ['dashboard', 'overview', PARAMS] })).toBeDefined();
    });

    it('enabled=false sem período: não chama o service', async () => {
        const empty: DashboardParams = { start_date: '', end_date: '' };
        const { result } = await renderHook(() => useDashboardOverview(empty), {
            wrapper: wrapper(newClient()),
        });

        expect(result.current.fetchStatus).toBe('idle');
        expect(mockGetOverview).not.toHaveBeenCalled();
    });
});

describe('useDashboardServicesRanking', () => {
    it('injeta limit:10 e o department, e usa a queryKey com department', async () => {
        const client = newClient();
        const { result } = await renderHook(
            () => useDashboardServicesRanking(PARAMS, 'film'),
            { wrapper: wrapper(client) }
        );

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(mockGetServices).toHaveBeenCalledWith({ ...PARAMS, department: 'film', limit: 10 });
        expect(
            client
                .getQueryCache()
                .find({ queryKey: ['dashboard', 'services', PARAMS, 'film'] })
        ).toBeDefined();
    });
});

describe('useDashboardQueue', () => {
    it('usa queryKey fixa ["dashboard","queue"], repassa storeId e define refetchInterval', async () => {
        const client = newClient();
        const { result } = await renderHook(() => useDashboardQueue(9), {
            wrapper: wrapper(client),
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(mockGetQueue).toHaveBeenCalledWith(9);

        const entry = client.getQueryCache().find({ queryKey: ['dashboard', 'queue'] });
        expect(entry).toBeDefined();
        const opts = entry?.options as { refetchInterval?: number };
        expect(opts.refetchInterval).toBe(30_000);
    });

    it('dispara mesmo sem período (não depende de start/end)', async () => {
        await renderHook(() => useDashboardQueue(), { wrapper: wrapper(newClient()) });
        await waitFor(() => expect(mockGetQueue).toHaveBeenCalled());
    });
});
