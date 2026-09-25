import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User, AuthTokens, AuthState } from '@/types/auth.types';
import type { EffectivePermissions, SubModule } from '@/types/accessProfile.types';

interface AuthStore extends AuthState {
    effectivePermissions: EffectivePermissions | null;
    setAuth: (user: User, tokens: AuthTokens) => void;
    clearAuth: () => void;
    updateUser: (user: Partial<User>) => void;
    updateTokens: (tokens: AuthTokens) => void;
    setLoading: (isLoading: boolean) => void;
    setEffectivePermissions: (permissions: EffectivePermissions | null) => void;
    isOwner: () => boolean;
    hasPermission: (sub_module: SubModule, action: 'view' | 'edit' | 'delete') => boolean;
}

export const useAuthStore = create<AuthStore>()(
    persist(
        (set, get) => ({
            user: null,
            tokens: null,
            isAuthenticated: false,
            isLoading: true,
            effectivePermissions: null,

            setAuth: (user, tokens) =>
                set({
                    user,
                    tokens,
                    isAuthenticated: true,
                    isLoading: false,
                }),

            clearAuth: () =>
                set({
                    user: null,
                    tokens: null,
                    isAuthenticated: false,
                    isLoading: false,
                    effectivePermissions: null,
                }),

            updateUser: (userData) =>
                set((state) => ({
                    user: state.user ? { ...state.user, ...userData } : null,
                })),

            updateTokens: (tokens) =>
                set({ tokens }),

            setLoading: (isLoading) =>
                set({ isLoading }),

            setEffectivePermissions: (permissions) =>
                set({ effectivePermissions: permissions }),

            isOwner: () => {
                return get().user?.role === 'owner';
            },

            hasPermission: (sub_module, action) => {
                const state = get();
                if (!state.user) return false;
                // Owner always has full access
                if (state.user.role === 'owner') return true;
                // Permissões ainda não carregadas → NEGA (fail-closed). Antes liberava,
                // deixando o não-owner ver UI restrita até /me/permissions responder.
                // O flicker transitório de carregamento é tratado nos hooks
                // useCanView/Edit/Delete (isLoading libera); os callers diretos usam
                // useHasPermission (reativo) para recalcular quando os dados chegam.
                if (!state.effectivePermissions) return false;
                const perm = state.effectivePermissions.permissions.find(
                    (p) => p.sub_module === sub_module
                );
                if (!perm) return false;
                if (action === 'view') return perm.can_view;
                if (action === 'edit') return perm.can_edit;
                if (action === 'delete') return perm.can_delete;
                return false;
            },
        }),
        {
            name: 'aems-auth',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                user: state.user,
                tokens: state.tokens ? { ...state.tokens, persistedAt: Date.now() } : null,
                isAuthenticated: state.isAuthenticated,
                // effectivePermissions is intentionally NOT persisted — always re-fetched on boot
            }),
            onRehydrateStorage: () => (state) => {
                if (state) {
                    state.isLoading = false;

                    // Validate token expiration on rehydration
                    if (state.tokens && state.isAuthenticated) {
                        const { expiresIn, persistedAt } = state.tokens as AuthTokens & { persistedAt?: number };
                        if (persistedAt) {
                            const elapsedSeconds = (Date.now() - persistedAt) / 1000;
                            if (elapsedSeconds >= expiresIn) {
                                // Token expired — clear auth state
                                state.user = null;
                                state.tokens = null;
                                state.isAuthenticated = false;
                                state.effectivePermissions = null;
                            }
                        }
                    }
                }
            },
        }
    )
);
