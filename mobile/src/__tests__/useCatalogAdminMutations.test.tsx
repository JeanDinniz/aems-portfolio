import React, { type ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Admin — Fatia 5b: hooks de toggle dos catálogos. Verifica que cada mutação
 * escolhe activate/deactivate conforme `isActive`, passa os args certos (inclusive
 * o brand_id dos modelos) e invalida as queryKeys corretas no sucesso.
 */
const mockBrandActivate = jest.fn();
const mockBrandDeactivate = jest.fn();
const mockModelActivate = jest.fn();
const mockModelDeactivate = jest.fn();
const mockServiceActivate = jest.fn();
const mockServiceDeactivate = jest.fn();
const mockSupplierActivate = jest.fn();
const mockSupplierDeactivate = jest.fn();
const mockDealershipActivate = jest.fn();
const mockDealershipDeactivate = jest.fn();

jest.mock('@/services/api/brands.service', () => ({
    brandsService: {
        activate: (...a: unknown[]) => mockBrandActivate(...a),
        deactivate: (...a: unknown[]) => mockBrandDeactivate(...a),
    },
}));
jest.mock('@/services/api/vehicle-models.service', () => ({
    vehicleModelsService: {
        activate: (...a: unknown[]) => mockModelActivate(...a),
        deactivate: (...a: unknown[]) => mockModelDeactivate(...a),
    },
}));
jest.mock('@/services/api/services.service', () => ({
    servicesService: {
        activate: (...a: unknown[]) => mockServiceActivate(...a),
        deactivate: (...a: unknown[]) => mockServiceDeactivate(...a),
    },
}));
jest.mock('@/services/api/suppliers.service', () => ({
    suppliersService: {
        activate: (...a: unknown[]) => mockSupplierActivate(...a),
        deactivate: (...a: unknown[]) => mockSupplierDeactivate(...a),
    },
}));
jest.mock('@/services/api/dealerships.service', () => ({
    dealershipsService: {
        activate: (...a: unknown[]) => mockDealershipActivate(...a),
        deactivate: (...a: unknown[]) => mockDealershipDeactivate(...a),
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

import { useToggleBrandActive } from '@/hooks/useBrandsAdmin';
import { useToggleVehicleModelActive } from '@/hooks/useVehicleModelsAdmin';
import { useToggleServiceActive } from '@/hooks/useServicesAdmin';
import { useToggleSupplierActive } from '@/hooks/useSuppliersAdmin';
import { useToggleDealershipActive } from '@/hooks/useDealerships';

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

function invalidatedKeys(spy: jest.SpyInstance): unknown[] {
    return spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockBrandActivate.mockResolvedValue({ id: 1, is_active: true });
    mockBrandDeactivate.mockResolvedValue({ id: 1, is_active: false });
    mockModelActivate.mockResolvedValue({ id: 1, is_active: true });
    mockModelDeactivate.mockResolvedValue({ id: 1, is_active: false });
    mockServiceActivate.mockResolvedValue({ id: 1, is_active: true });
    mockServiceDeactivate.mockResolvedValue({ id: 1, is_active: false });
    mockSupplierActivate.mockResolvedValue({ id: 1, is_active: true });
    mockSupplierDeactivate.mockResolvedValue({ id: 1, is_active: false });
    mockDealershipActivate.mockResolvedValue({ id: 1, is_active: true });
    mockDealershipDeactivate.mockResolvedValue({ id: 1, is_active: false });
});

describe('useToggleBrandActive', () => {
    it('desativar chama deactivate e invalida ["brands-admin"] + ["brands"]', async () => {
        const client = newClient();
        const spy = jest.spyOn(client, 'invalidateQueries');
        const { result } = await renderHook(() => useToggleBrandActive(), {
            wrapper: wrapper(client),
        });

        await act(async () => {
            await result.current.mutateAsync({ id: 5, isActive: false });
        });

        await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
        expect(mockBrandDeactivate).toHaveBeenCalledWith(5);
        expect(mockBrandActivate).not.toHaveBeenCalled();
        const keys = invalidatedKeys(spy);
        expect(keys).toContain('brands-admin');
        expect(keys).toContain('brands');
    });

    it('ativar chama activate', async () => {
        const { result } = await renderHook(() => useToggleBrandActive(), {
            wrapper: wrapper(newClient()),
        });
        await act(async () => {
            await result.current.mutateAsync({ id: 5, isActive: true });
        });
        expect(mockBrandActivate).toHaveBeenCalledWith(5);
    });
});

describe('useToggleVehicleModelActive', () => {
    it('passa o brandId para deactivate e invalida chaves de modelos', async () => {
        const client = newClient();
        const spy = jest.spyOn(client, 'invalidateQueries');
        const { result } = await renderHook(() => useToggleVehicleModelActive(), {
            wrapper: wrapper(client),
        });

        await act(async () => {
            await result.current.mutateAsync({ id: 9, brandId: 3, isActive: false });
        });

        await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
        expect(mockModelDeactivate).toHaveBeenCalledWith(9, 3);
        const keys = invalidatedKeys(spy);
        expect(keys).toContain('vehicle-models-admin');
        expect(keys).toContain('vehicle-models');
    });

    it('ativar passa o brandId para activate', async () => {
        const { result } = await renderHook(() => useToggleVehicleModelActive(), {
            wrapper: wrapper(newClient()),
        });
        await act(async () => {
            await result.current.mutateAsync({ id: 9, brandId: 3, isActive: true });
        });
        expect(mockModelActivate).toHaveBeenCalledWith(9, 3);
    });
});

describe('useToggleServiceActive', () => {
    it('invalida ["services-admin"] + ["services"]', async () => {
        const client = newClient();
        const spy = jest.spyOn(client, 'invalidateQueries');
        const { result } = await renderHook(() => useToggleServiceActive(), {
            wrapper: wrapper(client),
        });
        await act(async () => {
            await result.current.mutateAsync({ id: 2, isActive: false });
        });
        await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
        expect(mockServiceDeactivate).toHaveBeenCalledWith(2);
        const keys = invalidatedKeys(spy);
        expect(keys).toContain('services-admin');
        expect(keys).toContain('services');
    });
});

describe('useToggleSupplierActive', () => {
    it('invalida ["suppliers-admin"] + ["suppliers"]', async () => {
        const client = newClient();
        const spy = jest.spyOn(client, 'invalidateQueries');
        const { result } = await renderHook(() => useToggleSupplierActive(), {
            wrapper: wrapper(client),
        });
        await act(async () => {
            await result.current.mutateAsync({ id: 2, isActive: true });
        });
        await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
        expect(mockSupplierActivate).toHaveBeenCalledWith(2);
        const keys = invalidatedKeys(spy);
        expect(keys).toContain('suppliers-admin');
        expect(keys).toContain('suppliers');
    });
});

describe('useToggleDealershipActive', () => {
    it('invalida ["dealerships"]', async () => {
        const client = newClient();
        const spy = jest.spyOn(client, 'invalidateQueries');
        const { result } = await renderHook(() => useToggleDealershipActive(), {
            wrapper: wrapper(client),
        });
        await act(async () => {
            await result.current.mutateAsync({ id: 2, isActive: false });
        });
        await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
        expect(mockDealershipDeactivate).toHaveBeenCalledWith(2);
        const keys = invalidatedKeys(spy);
        expect(keys).toContain('dealerships');
    });
});
