import React, { type ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * AGD-01 — hooks de Agendamentos.
 * Verifica:
 *  - useAppointments injeta a loja selecionada (withSelectedStore) e achata
 *    a página em { items, total };
 *  - useAppointmentCapacity só dispara com storeId E deliveryDate;
 *  - useCancelAppointment invalida ['scheduling'] no sucesso e dispara toast.
 *
 * O schedulingService é mockado; o Toast é mockado com spies que checamos.
 * Gotcha: o `renderHook` da RNTL v14 é assíncrono — sempre await + waitFor.
 */
const mockList = jest.fn();
const mockGetCapacity = jest.fn();
const mockCancel = jest.fn();
const mockCreateCombined = jest.fn();

jest.mock('@/services/api/scheduling.service', () => ({
    schedulingService: {
        list: (...a: unknown[]) => mockList(...a),
        getCapacity: (...a: unknown[]) => mockGetCapacity(...a),
        cancel: (...a: unknown[]) => mockCancel(...a),
        createCombined: (...a: unknown[]) => mockCreateCombined(...a),
    },
}));

const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
jest.mock('@/components/ui/Toast', () => ({
    useToast: () => ({
        success: mockToastSuccess,
        error: mockToastError,
        info: jest.fn(),
        show: jest.fn(),
    }),
}));

import {
    useAppointments,
    useAppointmentCapacity,
    useCancelAppointment,
    useCreateCombinedAppointment,
} from '@/hooks/useScheduling';
import { useStoreStore } from '@/stores/store.store';

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
    mockList.mockResolvedValue({ items: [], pagination: { total: 0, page: 1, limit: 50, pages: 0 } });
    mockGetCapacity.mockResolvedValue(0);
    mockCancel.mockResolvedValue({ id: 1 });
    mockCreateCombined.mockResolvedValue({ items: [{ id: 1 }, { id: 2 }] });
    useStoreStore.setState({ selectedStoreId: null });
});

describe('useAppointments', () => {
    it('injeta a loja selecionada globalmente nos filtros (store_id)', async () => {
        useStoreStore.setState({ selectedStoreId: 12 });
        await renderHook(() => useAppointments(), { wrapper: wrapper(newClient()) });

        await waitFor(() => expect(mockList).toHaveBeenCalled());
        expect(mockList).toHaveBeenCalledWith(
            expect.objectContaining({ store_id: 12 }),
            1,
            50
        );
    });

    it('com "Todas as Lojas" (null) não injeta store_id', async () => {
        useStoreStore.setState({ selectedStoreId: null });
        await renderHook(() => useAppointments(), { wrapper: wrapper(newClient()) });

        await waitFor(() => expect(mockList).toHaveBeenCalled());
        expect(mockList.mock.calls[0][0]).not.toHaveProperty('store_id');
    });

    it('achata a página em { items, total }', async () => {
        mockList.mockResolvedValueOnce({
            items: [{ id: 1 }, { id: 2 }],
            pagination: { total: 2, page: 1, limit: 50, pages: 1 },
        });
        const { result } = await renderHook(() => useAppointments(), {
            wrapper: wrapper(newClient()),
        });

        await waitFor(() => expect(result.current.items).toHaveLength(2));
        expect(result.current.total).toBe(2);
    });
});

describe('useAppointmentCapacity', () => {
    it('não dispara sem storeId ou deliveryDate', async () => {
        await renderHook(() => useAppointmentCapacity(null, ''), { wrapper: wrapper(newClient()) });
        await renderHook(() => useAppointmentCapacity(3, ''), { wrapper: wrapper(newClient()) });
        await renderHook(() => useAppointmentCapacity(null, '2026-06-21'), {
            wrapper: wrapper(newClient()),
        });
        await act(async () => {
            await Promise.resolve();
        });
        expect(mockGetCapacity).not.toHaveBeenCalled();
    });

    it('dispara quando ambos presentes', async () => {
        await renderHook(() => useAppointmentCapacity(3, '2026-06-21'), {
            wrapper: wrapper(newClient()),
        });
        await waitFor(() => expect(mockGetCapacity).toHaveBeenCalledWith(3, '2026-06-21'));
    });
});

describe('useCancelAppointment', () => {
    it('invalida ["scheduling"] e dispara toast de sucesso', async () => {
        const client = newClient();
        const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
        const { result } = await renderHook(() => useCancelAppointment(), {
            wrapper: wrapper(client),
        });

        await waitFor(() => expect(result.current).toBeTruthy());
        await act(async () => {
            await result.current.mutateAsync({ id: 7, reason: 'teste' });
        });

        expect(mockCancel).toHaveBeenCalledWith(7, 'teste');
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scheduling'] });
        expect(mockToastSuccess).toHaveBeenCalled();
    });
});

describe('useCreateCombinedAppointment', () => {
    it('chama createCombined, invalida ["scheduling"] e dispara toast de sucesso', async () => {
        const client = newClient();
        const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
        const { result } = await renderHook(() => useCreateCombinedAppointment(), {
            wrapper: wrapper(client),
        });

        await waitFor(() => expect(result.current).toBeTruthy());
        const payload = {
            store_id: 1,
            delivery_date: '2026-06-21',
            vehicle_plate: 'ABC1D23',
            departments: [
                { department: 'film', service_ids: [42] },
                { department: 'bodywork', service_ids: [43] },
            ],
        };
        await act(async () => {
            await result.current.mutateAsync(payload);
        });

        expect(mockCreateCombined).toHaveBeenCalledWith(payload);
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['scheduling'] });
        expect(mockToastSuccess).toHaveBeenCalled();
    });
});
