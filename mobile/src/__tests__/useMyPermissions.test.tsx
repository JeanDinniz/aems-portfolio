/**
 * QA-05 — Hooks de permissão (useCanView/useCanEdit/useCanDelete + useMyPermissions).
 *
 * Comportamento REAL de `src/hooks/useMyPermissions.ts`:
 *   - Owner: sempre true, independentemente das permissões, SEM disparar a query.
 *   - Durante o carregamento das permissões (query enabled + pendente): libera
 *     (true) para evitar flicker de UI escondida.
 *   - Após carregar: respeita can_view/can_edit/can_delete por submódulo.
 *   - useMyPermissions sincroniza a resposta no auth store (setEffectivePermissions).
 *
 * A query bate em accessProfilesService.getMyPermissions — mockado aqui. Usamos
 * QueryClientProvider real (retry off) e renderHook assíncrono (RNTL v14 → await).
 */
import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGetMyPermissions = jest.fn();
jest.mock('@/services/api/access-profiles.service', () => ({
    accessProfilesService: {
        getMyPermissions: (...a: unknown[]) => mockGetMyPermissions(...a),
    },
}));

/* eslint-disable import/first -- imports após jest.mock (mock içado pelo Babel). */
import { useCanView, useCanEdit, useCanDelete, useMyPermissions } from '@/hooks/useMyPermissions';
import { useAuthStore } from '@/stores/auth.store';
import type { SubModule, EffectivePermissions } from '@/types/accessProfile.types';
import type { User } from '@/types/auth.types';

const ownerUser: User = {
    id: 1,
    full_name: 'Dona Owner',
    email: 'owner@aems.com',
    role: 'owner',
    is_active: true,
    must_change_password: false,
    created_at: '2024-01-01',
    updated_at: null,
};
const plainUser: User = { ...ownerUser, id: 2, role: 'user', email: 'user@aems.com', store_id: 5 };

const perms: EffectivePermissions = {
    permissions: [
        { sub_module: 'service_orders', can_view: true, can_edit: true, can_delete: false },
        { sub_module: 'inventory', can_view: false, can_edit: false, can_delete: false },
        { sub_module: 'conference', can_view: true, can_edit: false, can_delete: false },
    ],
    store_ids: ['5'],
    is_galpon_profile: false,
    hide_galpon_option: false,
};

let sharedClient: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={sharedClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
    jest.clearAllMocks();
    sharedClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    useAuthStore.setState({
        user: null,
        tokens: null,
        isAuthenticated: false,
        isLoading: true,
        effectivePermissions: null,
    });
});

/** Renderiza um dos hooks de permissão e devolve `result`. */
async function renderPerm(
    hook: (m: SubModule) => boolean,
    mod: SubModule
) {
    const { result } = await renderHook(() => hook(mod), { wrapper: Wrapper });
    return result;
}

describe('Owner — acesso total sem query', () => {
    it('view/edit/delete retornam true para qualquer submódulo e NÃO chamam a API', async () => {
        useAuthStore.setState({ user: ownerUser });
        const view = await renderPerm(useCanView, 'inventory');
        const edit = await renderPerm(useCanEdit, 'users');
        const del = await renderPerm(useCanDelete, 'stores');

        expect(view.current).toBe(true);
        expect(edit.current).toBe(true);
        expect(del.current).toBe(true);
        // Owner não dispara a query de permissões (enabled = !!user && !isOwner).
        expect(mockGetMyPermissions).not.toHaveBeenCalled();
    });
});

describe('usuário comum — respeita permissões efetivas (já carregadas)', () => {
    // Pré-carrega as permissões no store (simulando query já resolvida). Assim os
    // hooks leem o valor FINAL já na 1ª renderização, sem depender do timing da
    // query — a sincronização query→store é coberta no describe abaixo.
    beforeEach(() => {
        mockGetMyPermissions.mockResolvedValue(perms);
        useAuthStore.setState({ user: plainUser, effectivePermissions: perms });
    });

    it('service_orders: view + edit, sem delete', async () => {
        const view = await renderPerm(useCanView, 'service_orders');
        const edit = await renderPerm(useCanEdit, 'service_orders');
        const del = await renderPerm(useCanDelete, 'service_orders');
        // Após a query settlar (isLoading→false), lê o valor real do perfil.
        await waitFor(() => expect(del.current).toBe(false));
        expect(view.current).toBe(true);
        expect(edit.current).toBe(true);
    });

    it('inventory: negado em tudo (can_view=false)', async () => {
        const view = await renderPerm(useCanView, 'inventory');
        const edit = await renderPerm(useCanEdit, 'inventory');
        await waitFor(() => expect(view.current).toBe(false));
        expect(edit.current).toBe(false);
    });

    it('conference: só view', async () => {
        const view = await renderPerm(useCanView, 'conference');
        const edit = await renderPerm(useCanEdit, 'conference');
        await waitFor(() => expect(edit.current).toBe(false));
        expect(view.current).toBe(true);
    });

    it('submódulo ausente do perfil → negado', async () => {
        const view = await renderPerm(useCanView, 'users');
        await waitFor(() => expect(view.current).toBe(false));
    });
});

describe('useMyPermissions — sincronização no store', () => {
    it('grava as permissões efetivas no auth store após a query', async () => {
        mockGetMyPermissions.mockResolvedValue(perms);
        useAuthStore.setState({ user: plainUser });
        await renderHook(() => useMyPermissions(), { wrapper: Wrapper });
        await waitFor(() =>
            expect(useAuthStore.getState().effectivePermissions).toEqual(perms)
        );
    });

    it('não dispara a query quando o usuário é Owner', async () => {
        useAuthStore.setState({ user: ownerUser });
        await renderHook(() => useMyPermissions(), { wrapper: Wrapper });
        await new Promise((r) => setTimeout(r, 10));
        expect(mockGetMyPermissions).not.toHaveBeenCalled();
    });
});
