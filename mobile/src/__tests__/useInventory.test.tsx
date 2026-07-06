import React, { type ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * INV-01 — hooks de inventário.
 * Verifica:
 *  - useExhaustRoll invalida ['inventory-rolls'] (e ['inventory-critical']) no
 *    sucesso e dispara toast.success;
 *  - useAddServiceToFilmType invalida ['film-types'] e dispara toast.success;
 *  - useCreateRoll: erro NÃO vira toast aqui (propaga CriticalRollsError p/ a tela).
 *
 * O inventoryService é mockado; o Toast é mockado com spies.
 * Gotcha: renderHook da RNTL v14 é assíncrono — sempre await + waitFor.
 */
const mockExhaustRoll = jest.fn();
const mockAddService = jest.fn();
const mockCreateRoll = jest.fn();

jest.mock('@/services/api/inventory.service', () => {
    const actual = jest.requireActual('@/services/api/inventory.service');
    return {
        ...actual,
        inventoryService: {
            exhaustRoll: (...a: unknown[]) => mockExhaustRoll(...a),
            addServiceToFilmType: (...a: unknown[]) => mockAddService(...a),
            createRoll: (...a: unknown[]) => mockCreateRoll(...a),
        },
    };
});

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
    useExhaustRoll,
    useAddServiceToFilmType,
    useCreateRoll,
} from '@/hooks/useInventory';
import { CriticalRollsError } from '@/services/api/inventory.service';

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
    mockExhaustRoll.mockResolvedValue({ id: 1, status: 'esgotada' });
    mockAddService.mockResolvedValue({ service_id: 9 });
    mockCreateRoll.mockResolvedValue({ id: 1 });
});

describe('useExhaustRoll', () => {
    it('invalida ["inventory-rolls"]/["inventory-critical"] e dispara toast no sucesso', async () => {
        const client = newClient();
        const spy = jest.spyOn(client, 'invalidateQueries');
        const { result } = await renderHook(() => useExhaustRoll(), { wrapper: wrapper(client) });

        await act(async () => {
            await result.current.mutateAsync(1);
        });

        await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
        expect(mockExhaustRoll).toHaveBeenCalledWith(1);
        const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
        expect(keys).toContain('inventory-rolls');
        expect(keys).toContain('inventory-critical');
    });
});

describe('useAddServiceToFilmType', () => {
    it('invalida ["film-types"] e dispara toast no sucesso', async () => {
        const client = newClient();
        const spy = jest.spyOn(client, 'invalidateQueries');
        const { result } = await renderHook(() => useAddServiceToFilmType(), {
            wrapper: wrapper(client),
        });

        await act(async () => {
            await result.current.mutateAsync({
                filmTypeId: 3,
                payload: { service_id: 9, meters_consumed: 2 },
            });
        });

        await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
        expect(mockAddService).toHaveBeenCalledWith(3, { service_id: 9, meters_consumed: 2 });
        const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
        expect(keys).toContain('film-types');
    });
});

describe('useCreateRoll', () => {
    it('propaga CriticalRollsError SEM disparar toast (tela decide)', async () => {
        mockCreateRoll.mockRejectedValueOnce(new CriticalRollsError());
        const { result } = await renderHook(() => useCreateRoll(), { wrapper: wrapper(newClient()) });

        await act(async () => {
            await expect(
                result.current.mutateAsync({
                    payload: {
                        store_id: 1,
                        film_type_id: 2,
                        total_meters: 30,
                        receipt_date: '2026-06-21',
                    },
                })
            ).rejects.toBeInstanceOf(CriticalRollsError);
        });

        expect(mockToastError).not.toHaveBeenCalled();
        expect(mockToastSuccess).not.toHaveBeenCalled();
    });
});
