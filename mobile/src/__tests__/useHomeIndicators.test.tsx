import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * HomeScreen — indicadores da grade 2×2 (useHomeIndicators).
 * Deriva de endpoints NÃO-gated (resumo de agendamento + total de O.S.),
 * gated por permissão e respeitando a loja selecionada. Services/permissões/loja
 * mockados. RNTL v14: renderHook assíncrono → await + waitFor.
 */
const mockGetTodaySummary = jest.fn();
const mockGetStoreSummary = jest.fn();
const mockGetAll = jest.fn();

jest.mock('@/services/api/scheduling.service', () => ({
    schedulingService: {
        getTodaySummary: (...a: unknown[]) => mockGetTodaySummary(...a),
        getStoreSummary: (...a: unknown[]) => mockGetStoreSummary(...a),
    },
}));

jest.mock('@/services/api/service-orders.service', () => ({
    serviceOrdersService: {
        getAll: (...a: unknown[]) => mockGetAll(...a),
    },
}));

const mockPerms: Record<string, boolean> = { scheduling: true, service_orders: true };
jest.mock('@/hooks/useMyPermissions', () => ({
    useCanView: (mod: string) => mockPerms[mod] ?? false,
}));

let mockSelectedStoreId: number | null = null;
jest.mock('@/stores/store.store', () => ({
    useStoreStore: (selector: (s: { selectedStoreId: number | null }) => unknown) =>
        selector({ selectedStoreId: mockSelectedStoreId }),
}));

import { useHomeIndicators } from '@/hooks/useHomeIndicators';

function wrapper(client: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    };
}

function newClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockPerms.scheduling = true;
    mockPerms.service_orders = true;
    mockSelectedStoreId = null;
    mockGetTodaySummary.mockResolvedValue({
        atrasado: 2,
        atencao: 1,
        agendado: 3,
        em_execucao: 1,
        finalizado: 4,
        cancelado: 5,
    });
    mockGetStoreSummary.mockResolvedValue([
        { store_id: 1, store_name: 'A', total: 10, cancelado: 2, atrasado: 0, atencao: 0, agendado: 0, em_execucao: 0, finalizado: 0 },
        { store_id: 2, store_name: 'B', total: 5, cancelado: 1, atrasado: 0, atencao: 0, agendado: 0, em_execucao: 0, finalizado: 0 },
    ]);
    mockGetAll.mockResolvedValue({ items: [], total: 37 });
});

describe('useHomeIndicators', () => {
    it('calcula os 4 indicadores com as permissões e todas as lojas', async () => {
        const { result } = await renderHook(() => useHomeIndicators(), {
            wrapper: wrapper(newClient()),
        });

        await waitFor(() => expect(result.current.osThisMonth).toBe(37));
        expect(result.current.overdue).toBe(2);
        // hoje = agendado+atencao+em_execucao+atrasado+finalizado (exclui cancelado)
        expect(result.current.todayCount).toBe(11);
        // previstos = soma(total - cancelado) de todas as lojas = 8 + 4
        expect(result.current.forecast14d).toBe(12);
    });

    it('filtra a previsão pela loja selecionada', async () => {
        mockSelectedStoreId = 1;
        const { result } = await renderHook(() => useHomeIndicators(), {
            wrapper: wrapper(newClient()),
        });

        await waitFor(() => expect(result.current.forecast14d).toBe(8)); // só loja 1: 10 - 2
    });

    it('sem permissão de scheduling não chama os resumos e deixa os valores undefined', async () => {
        mockPerms.scheduling = false;
        const { result } = await renderHook(() => useHomeIndicators(), {
            wrapper: wrapper(newClient()),
        });

        await waitFor(() => expect(result.current.osThisMonth).toBe(37));
        expect(result.current.overdue).toBeUndefined();
        expect(result.current.todayCount).toBeUndefined();
        expect(result.current.forecast14d).toBeUndefined();
        expect(mockGetTodaySummary).not.toHaveBeenCalled();
        expect(mockGetStoreSummary).not.toHaveBeenCalled();
    });

    it('sem permissão de service_orders não chama getAll e O.S do mês fica undefined', async () => {
        mockPerms.service_orders = false;
        const { result } = await renderHook(() => useHomeIndicators(), {
            wrapper: wrapper(newClient()),
        });

        await waitFor(() => expect(result.current.overdue).toBe(2));
        expect(result.current.osThisMonth).toBeUndefined();
        expect(mockGetAll).not.toHaveBeenCalled();
    });
});
