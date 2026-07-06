import React, { type ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Admin — Fatia 5a: hooks de mutação (Users / Stores / Access Profiles).
 * Verifica que cada mutação invalida as queryKeys corretas no sucesso e dispara o
 * Toast esperado. Services mockados; Toast mockado com spies.
 * RNTL v14: renderHook é assíncrono — sempre await + waitFor.
 */
const mockUserDeactivate = jest.fn();
const mockUserActivate = jest.fn();
const mockUserReset = jest.fn();
const mockStoreUpdate = jest.fn();
const mockProfileUpdate = jest.fn();
const mockProfileRemoveUsers = jest.fn();

jest.mock('@/services/api/users.service', () => ({
    usersService: {
        activate: (...a: unknown[]) => mockUserActivate(...a),
        deactivate: (...a: unknown[]) => mockUserDeactivate(...a),
        resetPassword: (...a: unknown[]) => mockUserReset(...a),
    },
}));

jest.mock('@/services/api/stores.service', () => ({
    storesService: {
        update: (...a: unknown[]) => mockStoreUpdate(...a),
    },
}));

jest.mock('@/services/api/access-profiles.service', () => ({
    accessProfilesService: {
        update: (...a: unknown[]) => mockProfileUpdate(...a),
        removeUsers: (...a: unknown[]) => mockProfileRemoveUsers(...a),
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

import { useDeactivateUser, useResetUserPassword } from '@/hooks/useUsers';
import { useToggleStoreActive } from '@/hooks/useStoresAdmin';
import {
    useToggleAccessProfileActive,
    useRemoveProfileUser,
} from '@/hooks/useAccessProfiles';

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
    mockUserActivate.mockResolvedValue({ id: 1, is_active: true });
    mockUserDeactivate.mockResolvedValue({ id: 1, is_active: false });
    mockUserReset.mockResolvedValue({ temporary_password: 'Ab12cd34' });
    mockStoreUpdate.mockResolvedValue({ id: 2, is_active: false });
    mockProfileUpdate.mockResolvedValue({ id: 'p1', is_active: false });
    mockProfileRemoveUsers.mockResolvedValue(undefined);
});

describe('useDeactivateUser', () => {
    it('invalida ["users"] e ["user", id] e dispara toast no sucesso', async () => {
        const client = newClient();
        const spy = jest.spyOn(client, 'invalidateQueries');
        const { result } = await renderHook(() => useDeactivateUser(), { wrapper: wrapper(client) });

        await act(async () => {
            await result.current.mutateAsync(1);
        });

        await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
        expect(mockUserDeactivate).toHaveBeenCalledWith(1);
        const keys = invalidatedKeys(spy);
        expect(keys).toContain('users');
        expect(keys).toContain('user');
    });
});

describe('useResetUserPassword', () => {
    it('retorna a senha temporária e NÃO dispara toast de sucesso (a tela exibe)', async () => {
        const { result } = await renderHook(() => useResetUserPassword(), {
            wrapper: wrapper(newClient()),
        });

        let data: { temporary_password: string } | undefined;
        await act(async () => {
            data = await result.current.mutateAsync(1);
        });

        expect(data).toEqual({ temporary_password: 'Ab12cd34' });
        expect(mockUserReset).toHaveBeenCalledWith(1);
        expect(mockToastSuccess).not.toHaveBeenCalled();
    });
});

describe('useToggleStoreActive', () => {
    it('chama update com is_active e invalida ["stores-admin"] + ["stores"]', async () => {
        const client = newClient();
        const spy = jest.spyOn(client, 'invalidateQueries');
        const { result } = await renderHook(() => useToggleStoreActive(), {
            wrapper: wrapper(client),
        });

        await act(async () => {
            await result.current.mutateAsync({ id: 2, isActive: false });
        });

        await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
        expect(mockStoreUpdate).toHaveBeenCalledWith(2, { is_active: false });
        const keys = invalidatedKeys(spy);
        expect(keys).toContain('stores-admin');
        expect(keys).toContain('stores');
    });
});

describe('useToggleAccessProfileActive', () => {
    it('chama update e invalida ["access-profiles"] + ["access-profile", id]', async () => {
        const client = newClient();
        const spy = jest.spyOn(client, 'invalidateQueries');
        const { result } = await renderHook(() => useToggleAccessProfileActive(), {
            wrapper: wrapper(client),
        });

        await act(async () => {
            await result.current.mutateAsync({ id: 'p1', isActive: false });
        });

        await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
        expect(mockProfileUpdate).toHaveBeenCalledWith('p1', { is_active: false });
        const keys = invalidatedKeys(spy);
        expect(keys).toContain('access-profiles');
        expect(keys).toContain('access-profile');
    });
});

describe('useRemoveProfileUser', () => {
    it('remove o usuário do perfil e invalida ["access-profiles"]', async () => {
        const client = newClient();
        const spy = jest.spyOn(client, 'invalidateQueries');
        const { result } = await renderHook(() => useRemoveProfileUser(), {
            wrapper: wrapper(client),
        });

        await act(async () => {
            await result.current.mutateAsync({ id: 'p1', userId: 'u9' });
        });

        await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
        expect(mockProfileRemoveUsers).toHaveBeenCalledWith('p1', ['u9']);
        const keys = invalidatedKeys(spy);
        expect(keys).toContain('access-profiles');
    });
});
