/**
 * QA-05 — Guards de navegação / permissão / galpão.
 *
 * Cobre o comportamento REAL de `src/navigation/guards.ts`:
 *   - useVisibleModules(): Owner vê todos os módulos; usuário com perfil limitado
 *     só vê os submódulos com can_view; permissões ainda não carregadas liberam
 *     (evita tela em branco / flicker).
 *   - useGalponFlags(): expõe is_galpon_profile/hide_galpon_option a partir das
 *     permissões efetivas (default false quando ausentes).
 *
 * Estes hooks só leem seletores do auth.store (sem query/rede), então usamos
 * renderHook direto sem QueryClientProvider e montamos cenários via setState.
 */
import { renderHook } from '@testing-library/react-native';

import { useVisibleModules, useGalponFlags, MODULE_GUARDS } from '@/navigation/guards';
import { useAuthStore } from '@/stores/auth.store';
import type { User } from '@/types/auth.types';
import type { EffectivePermissions, SubModule } from '@/types/accessProfile.types';

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

/** Constrói permissões efetivas concedendo view apenas aos submódulos listados. */
function permsWithView(
    viewable: SubModule[],
    extra: Partial<EffectivePermissions> = {}
): EffectivePermissions {
    return {
        permissions: viewable.map((sub_module) => ({
            sub_module,
            can_view: true,
            can_edit: false,
            can_delete: false,
        })),
        store_ids: ['5'],
        is_galpon_profile: false,
        hide_galpon_option: false,
        ...extra,
    };
}

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

describe('useVisibleModules — visibilidade por permissão', () => {
    it('Owner vê TODOS os módulos, independentemente das permissões', async () => {
        useAuthStore.setState({ user: ownerUser, effectivePermissions: null });
        const { result } = await renderHook(() => useVisibleModules());
        expect(result.current).toHaveLength(MODULE_GUARDS.length);
        expect(result.current.map((m) => m.sub_module)).toEqual(
            MODULE_GUARDS.map((m) => m.sub_module)
        );
    });

    it('M2: usuário sem permissões carregadas NÃO vê módulos (fail-closed)', async () => {
        // Antes liberava tudo (fail-open) → não-owner via UI restrita até
        // /me/permissions responder. Agora nega até as permissões chegarem;
        // ao carregar, o hook re-renderiza (assina effectivePermissions).
        useAuthStore.setState({ user: plainUser, effectivePermissions: null });
        const { result } = await renderHook(() => useVisibleModules());
        expect(result.current).toHaveLength(0);
    });

    it('usuário com perfil limitado só vê os módulos com can_view', async () => {
        // Só service_orders + inventory liberados para visualização.
        useAuthStore.setState({
            user: plainUser,
            effectivePermissions: permsWithView(['service_orders', 'inventory']),
        });
        const { result } = await renderHook(() => useVisibleModules());
        const visible = result.current.map((m) => m.sub_module);
        expect(visible).toContain('service_orders');
        expect(visible).toContain('inventory');
        // scheduling/conference/fechamento não foram concedidos → ocultos.
        expect(visible).not.toContain('scheduling');
        expect(visible).not.toContain('conference');
        expect(visible).not.toContain('fechamento');
    });

    it('submódulo presente porém com can_view=false permanece oculto', async () => {
        useAuthStore.setState({
            user: plainUser,
            effectivePermissions: {
                permissions: [
                    { sub_module: 'service_orders', can_view: false, can_edit: true, can_delete: false },
                ],
                store_ids: [],
                is_galpon_profile: false,
                hide_galpon_option: false,
            },
        });
        const { result } = await renderHook(() => useVisibleModules());
        expect(result.current.map((m) => m.sub_module)).not.toContain('service_orders');
    });

    it('sem nenhum módulo concedido, a lista fica vazia', async () => {
        useAuthStore.setState({ user: plainUser, effectivePermissions: permsWithView([]) });
        const { result } = await renderHook(() => useVisibleModules());
        expect(result.current).toHaveLength(0);
    });
});

describe('useGalponFlags — flags de galpão', () => {
    it('default false quando não há permissões efetivas', async () => {
        useAuthStore.setState({ user: plainUser, effectivePermissions: null });
        const { result } = await renderHook(() => useGalponFlags());
        expect(result.current).toEqual({ isGalponProfile: false, hideGalponOption: false });
    });

    it('perfil de galpão: isGalponProfile=true', async () => {
        useAuthStore.setState({
            user: plainUser,
            effectivePermissions: permsWithView(['service_orders'], { is_galpon_profile: true }),
        });
        const { result } = await renderHook(() => useGalponFlags());
        expect(result.current.isGalponProfile).toBe(true);
        expect(result.current.hideGalponOption).toBe(false);
    });

    it('perfil que oculta galpão: hideGalponOption=true', async () => {
        useAuthStore.setState({
            user: plainUser,
            effectivePermissions: permsWithView(['service_orders'], { hide_galpon_option: true }),
        });
        const { result } = await renderHook(() => useGalponFlags());
        expect(result.current.hideGalponOption).toBe(true);
        expect(result.current.isGalponProfile).toBe(false);
    });

    it('ambas as flags refletem o perfil quando ativas', async () => {
        useAuthStore.setState({
            user: plainUser,
            effectivePermissions: permsWithView([], {
                is_galpon_profile: true,
                hide_galpon_option: true,
            }),
        });
        const { result } = await renderHook(() => useGalponFlags());
        expect(result.current).toEqual({ isGalponProfile: true, hideGalponOption: true });
    });
});
