import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { secureStorage, appStorage, TOKEN_META_KEY, type TokenMeta } from '@/lib/storage';
import type { User, AuthTokens, AuthState } from '@/types/auth.types';
import type { EffectivePermissions, SubModule } from '@/types/accessProfile.types';

/**
 * Auth store (DATA-04) — portado de frontend/src/stores/auth.store.ts.
 *
 * Diferenças do web (a razão de existir do app):
 * - **Tokens só no SecureStore.** O estado mantém os tokens em memória, mas o
 *   `persist` (AsyncStorage) guarda APENAS `user` + `isAuthenticated`. Os tokens
 *   são espelhados no `secureStorage` (Keychain/Keystore) em `setAuth`/`clearAuth`.
 * - **Validação de expiração no boot** via `bootstrapAuth()` (chamado no App.tsx),
 *   que lê os tokens do SecureStore + metadados (`expiresIn`/`persistedAt`).
 * - Sem `window.location`: navegação reage ao estado (RootNavigator).
 */
interface AuthStore extends AuthState {
    effectivePermissions: EffectivePermissions | null;
    setAuth: (user: User, tokens: AuthTokens) => void;
    clearAuth: () => void;
    updateUser: (user: Partial<User>) => void;
    updateTokens: (tokens: AuthTokens) => void;
    setLoading: (isLoading: boolean) => void;
    setEffectivePermissions: (permissions: EffectivePermissions | null) => void;
    bootstrapAuth: () => Promise<void>;
    isOwner: () => boolean;
    hasPermission: (sub_module: SubModule, action: 'view' | 'edit' | 'delete') => boolean;
}

/** Persiste tokens no SecureStore + metadados de validade no AsyncStorage. */
async function persistTokens(tokens: AuthTokens): Promise<void> {
    const meta: TokenMeta = { expiresIn: tokens.expiresIn, persistedAt: Date.now() };
    await Promise.all([
        secureStorage.setTokens(tokens.accessToken, tokens.refreshToken),
        appStorage.set(TOKEN_META_KEY, meta),
    ]);
}

/** Remove tokens do SecureStore + metadados. */
async function wipeTokens(): Promise<void> {
    await Promise.all([secureStorage.clearTokens(), appStorage.remove(TOKEN_META_KEY)]);
}

export const useAuthStore = create<AuthStore>()(
    persist(
        (set, get) => ({
            user: null,
            tokens: null,
            isAuthenticated: false,
            isLoading: true,
            effectivePermissions: null,

            setAuth: (user, tokens) => {
                // Espelha tokens no armazenamento seguro (fire-and-forget).
                void persistTokens(tokens);
                set({
                    user,
                    tokens,
                    isAuthenticated: true,
                    isLoading: false,
                });
            },

            clearAuth: () => {
                void wipeTokens();
                set({
                    user: null,
                    tokens: null,
                    isAuthenticated: false,
                    isLoading: false,
                    effectivePermissions: null,
                });
            },

            updateUser: (userData) =>
                set((state) => ({
                    user: state.user ? { ...state.user, ...userData } : null,
                })),

            updateTokens: (tokens) => {
                void persistTokens(tokens);
                set({ tokens });
            },

            setLoading: (isLoading) => set({ isLoading }),

            setEffectivePermissions: (permissions) => set({ effectivePermissions: permissions }),

            /**
             * Restaura a sessão no boot: lê tokens do SecureStore e valida a
             * expiração contra os metadados. Deve ser chamado DEPOIS da
             * reidratação do persist (que repõe `user`/`isAuthenticated`).
             */
            bootstrapAuth: async () => {
                try {
                    const [accessToken, refreshToken, meta] = await Promise.all([
                        secureStorage.getToken(),
                        secureStorage.getRefreshToken(),
                        appStorage.get<TokenMeta>(TOKEN_META_KEY),
                    ]);

                    const hasTokens = !!accessToken && !!refreshToken;
                    // Considera o refresh válido por ~7 dias (REFRESH_TOKEN_EXPIRE_DAYS).
                    // Se o access expirou, o apiClient faz refresh no 1º 401.
                    const refreshExpired =
                        !!meta &&
                        Date.now() - meta.persistedAt >= 7 * 24 * 60 * 60 * 1000;

                    if (!hasTokens || refreshExpired || !get().user) {
                        await wipeTokens();
                        set({
                            user: null,
                            tokens: null,
                            isAuthenticated: false,
                            isLoading: false,
                            effectivePermissions: null,
                        });
                        return;
                    }

                    set({
                        tokens: {
                            accessToken: accessToken!,
                            refreshToken: refreshToken!,
                            expiresIn: meta?.expiresIn ?? 1800,
                        },
                        isAuthenticated: true,
                        isLoading: false,
                    });
                } catch {
                    set({ isLoading: false });
                }
            },

            isOwner: () => get().user?.role === 'owner',

            hasPermission: (sub_module, action) => {
                const state = get();
                if (!state.user) return false;
                // Owner sempre tem acesso total.
                if (state.user.role === 'owner') return true;
                // Permissões ainda não carregadas: liberar para evitar telas em branco.
                if (!state.effectivePermissions) return true;
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
            storage: createJSONStorage(() => AsyncStorage),
            // NUNCA persistir tokens nem permissões no AsyncStorage.
            partialize: (state) => ({
                user: state.user,
                isAuthenticated: state.isAuthenticated,
            }),
        }
    )
);
