import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/stores/auth.store';
import { authService } from '@/services/api/auth.service';
import { unregisterPushNotificationsAsync } from '@/services/push/push.service';
import { addBreadcrumb, setUserId } from '@/lib/sentry';
import type { LoginCredentials } from '@/types/auth.types';

/**
 * useAuth (DATA-05) — adaptado de frontend/src/hooks/useAuth.ts.
 *
 * Sem `useNavigate`/toast: a navegação reage ao estado de auth (RootNavigator),
 * e `must_change_password` é roteado lá. As telas tratam erros inline.
 */
export function useAuth() {
    const queryClient = useQueryClient();
    const { user, tokens, isAuthenticated, setAuth, clearAuth } = useAuthStore();

    const loginMutation = useMutation({
        // Breadcrumbs SEM PII: nunca e-mail/senha — só o marco do fluxo.
        mutationFn: (credentials: LoginCredentials) => {
            addBreadcrumb('auth', 'login attempt');
            return authService.login(credentials);
        },
        onSuccess: (data) => {
            addBreadcrumb('auth', 'login success');
            // Correlaciona crashes ao usuário SÓ pelo id (nunca email/nome).
            setUserId(data.user?.id ?? null);
            setAuth(data.user, data.tokens);
        },
        onError: () => {
            addBreadcrumb('auth', 'login failed');
        },
    });

    const logoutMutation = useMutation({
        // Desregistra o push ANTES de revogar a sessão: o DELETE /push/devices
        // precisa do Bearer ainda válido (clearAuth limpa os tokens). É
        // best-effort (idempotente e com try/catch interno) — nunca bloqueia o
        // logout. Só então revoga a sessão no backend.
        mutationFn: async () => {
            await unregisterPushNotificationsAsync();
            return authService.logout();
        },
        // Revoga no backend; em qualquer desfecho limpa sessão local.
        onSettled: () => {
            setUserId(null);
            clearAuth();
            queryClient.clear();
        },
    });

    const login = useCallback(
        (credentials: LoginCredentials) => loginMutation.mutateAsync(credentials),
        [loginMutation]
    );

    const logout = useCallback(() => logoutMutation.mutate(), [logoutMutation]);

    return {
        user,
        tokens,
        isAuthenticated,
        login,
        logout,
        loginError: loginMutation.error as Error | null,
        isLoggingIn: loginMutation.isPending,
        isLoggingOut: logoutMutation.isPending,
    };
}
