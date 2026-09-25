import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import type { User } from '@/types/auth.types';
import type { EffectivePermissions } from '@/types/accessProfile.types';

const ownerUser = { id: 1, role: 'owner', full_name: 'Owner' } as unknown as User;
const plainUser = { id: 2, role: 'user', full_name: 'User' } as unknown as User;

const perms = (
    partial: Partial<EffectivePermissions['permissions'][number]> & { sub_module: 'services' },
): EffectivePermissions => ({
    permissions: [
        {
            sub_module: partial.sub_module,
            can_view: partial.can_view ?? false,
            can_edit: partial.can_edit ?? false,
            can_delete: partial.can_delete ?? false,
        },
    ],
    store_ids: [],
    is_galpon_profile: false,
    hide_galpon_option: false,
    scheduling_departments: [],
});

describe('auth.store hasPermission (fail-closed)', () => {
    beforeEach(() => {
        useAuthStore.setState({ user: null, effectivePermissions: null });
    });

    it('sem usuário → nega tudo', () => {
        expect(useAuthStore.getState().hasPermission('services', 'view')).toBe(false);
    });

    it('owner → libera mesmo sem effectivePermissions', () => {
        useAuthStore.setState({ user: ownerUser, effectivePermissions: null });
        expect(useAuthStore.getState().hasPermission('services', 'delete')).toBe(true);
    });

    it('não-owner sem permissões carregadas → NEGA (fail-closed)', () => {
        // Antes liberava (fail-open) → não-owner via UI restrita até /me/permissions.
        useAuthStore.setState({ user: plainUser, effectivePermissions: null });
        expect(useAuthStore.getState().hasPermission('services', 'view')).toBe(false);
        expect(useAuthStore.getState().hasPermission('services', 'edit')).toBe(false);
    });

    it('não-owner respeita as permissões efetivas por ação', () => {
        useAuthStore.setState({
            user: plainUser,
            effectivePermissions: perms({ sub_module: 'services', can_view: true, can_edit: true }),
        });
        const { hasPermission } = useAuthStore.getState();
        expect(hasPermission('services', 'view')).toBe(true);
        expect(hasPermission('services', 'edit')).toBe(true);
        expect(hasPermission('services', 'delete')).toBe(false);
        expect(hasPermission('brands', 'view')).toBe(false); // submódulo não concedido
    });
});
