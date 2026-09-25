import { useAuthStore } from '@/stores/auth.store';
import { secureStorage, appStorage, TOKEN_META_KEY } from '@/lib/storage';
import type { User } from '@/types/auth.types';
import type { EffectivePermissions } from '@/types/accessProfile.types';

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

const permissions: EffectivePermissions = {
    permissions: [
        { sub_module: 'service_orders', can_view: true, can_edit: true, can_delete: false },
        { sub_module: 'inventory', can_view: false, can_edit: false, can_delete: false },
    ],
    store_ids: ['5'],
    is_galpon_profile: false,
    hide_galpon_option: false,
};

beforeEach(() => {
    useAuthStore.setState({
        user: null,
        tokens: null,
        isAuthenticated: false,
        isLoading: true,
        effectivePermissions: null,
    });
    jest.clearAllMocks();
});

describe('auth.store — permissões', () => {
    it('Owner sempre tem acesso total', () => {
        useAuthStore.setState({ user: ownerUser });
        const { isOwner, hasPermission } = useAuthStore.getState();
        expect(isOwner()).toBe(true);
        expect(hasPermission('inventory', 'delete')).toBe(true);
    });

    it('M2: usuário sem permissões carregadas NEGA (fail-closed)', () => {
        // O flicker de carregamento é tratado nos hooks useCanView/Edit/Delete
        // (isLoading libera). hasPermission em si nunca deve liberar sem dados.
        useAuthStore.setState({ user: plainUser, effectivePermissions: null });
        expect(useAuthStore.getState().hasPermission('service_orders', 'view')).toBe(false);
    });

    it('usuário respeita as permissões efetivas por ação', () => {
        useAuthStore.setState({ user: plainUser, effectivePermissions: permissions });
        const { hasPermission } = useAuthStore.getState();
        expect(hasPermission('service_orders', 'view')).toBe(true);
        expect(hasPermission('service_orders', 'edit')).toBe(true);
        expect(hasPermission('service_orders', 'delete')).toBe(false);
        expect(hasPermission('inventory', 'view')).toBe(false);
    });

    it('sem usuário, nega tudo', () => {
        expect(useAuthStore.getState().hasPermission('service_orders', 'view')).toBe(false);
    });
});

describe('auth.store — tokens e SecureStore', () => {
    it('setAuth grava tokens no SecureStore e marca autenticado', async () => {
        const setSpy = jest.spyOn(secureStorage, 'setTokens');
        useAuthStore.getState().setAuth(ownerUser, {
            accessToken: 'acc',
            refreshToken: 'ref',
            expiresIn: 1800,
        });
        expect(setSpy).toHaveBeenCalledWith('acc', 'ref');
        const s = useAuthStore.getState();
        expect(s.isAuthenticated).toBe(true);
        expect(s.tokens?.accessToken).toBe('acc');
    });

    it('clearAuth limpa estado e SecureStore', () => {
        const clearSpy = jest.spyOn(secureStorage, 'clearTokens');
        useAuthStore.getState().setAuth(ownerUser, {
            accessToken: 'a',
            refreshToken: 'r',
            expiresIn: 1800,
        });
        useAuthStore.getState().clearAuth();
        expect(clearSpy).toHaveBeenCalled();
        const s = useAuthStore.getState();
        expect(s.isAuthenticated).toBe(false);
        expect(s.tokens).toBeNull();
        expect(s.user).toBeNull();
    });
});

describe('auth.store — bootstrapAuth', () => {
    it('restaura sessão quando há tokens válidos e usuário reidratado', async () => {
        await secureStorage.setTokens('acc1', 'ref1');
        await appStorage.set(TOKEN_META_KEY, { expiresIn: 1800, persistedAt: Date.now() });
        useAuthStore.setState({ user: ownerUser, isAuthenticated: false, isLoading: true });

        await useAuthStore.getState().bootstrapAuth();

        const s = useAuthStore.getState();
        expect(s.isAuthenticated).toBe(true);
        expect(s.tokens?.accessToken).toBe('acc1');
        expect(s.isLoading).toBe(false);
    });

    it('limpa sessão quando não há tokens no SecureStore', async () => {
        await secureStorage.clearTokens();
        useAuthStore.setState({ user: ownerUser, isAuthenticated: true, isLoading: true });

        await useAuthStore.getState().bootstrapAuth();

        const s = useAuthStore.getState();
        expect(s.isAuthenticated).toBe(false);
        expect(s.isLoading).toBe(false);
    });

    it('limpa sessão quando o refresh token expirou (>7 dias)', async () => {
        await secureStorage.setTokens('old', 'oldref');
        const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
        await appStorage.set(TOKEN_META_KEY, { expiresIn: 1800, persistedAt: eightDaysAgo });
        useAuthStore.setState({ user: ownerUser, isAuthenticated: true, isLoading: true });

        await useAuthStore.getState().bootstrapAuth();

        expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
});
