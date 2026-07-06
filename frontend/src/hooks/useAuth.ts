import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { authService } from '@/services/api/auth.service';
import type { LoginCredentials } from '@/types/auth.types';
import { useToast } from '@/hooks/use-toast';

export function useAuth() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const { user, tokens, isAuthenticated, setAuth, clearAuth } = useAuthStore();

    const loginMutation = useMutation({
        mutationFn: (credentials: LoginCredentials) => authService.login(credentials),
        onSuccess: (data) => {
            setAuth(data.user, data.tokens);

            if (data.user.must_change_password) {
                toast({
                    title: 'Troca de senha obrigatória',
                    description: 'Por favor, defina uma nova senha.',
                    variant: 'default',
                });
                navigate('/change-password');
                return;
            }

            toast({
                title: 'Login realizado',
                description: `Bem-vindo, ${data.user.full_name}!`,
            });
            navigate('/');
        },
    });

    const logoutMutation = useMutation({
        mutationFn: async () => authService.logout(),
        onSettled: () => {
            clearAuth();
            navigate('/login');
            toast({
                title: 'Logout realizado',
                description: 'Até logo!',
            });
        },
    });

    const login = useCallback(
        async (credentials: LoginCredentials) => {
            return loginMutation.mutateAsync(credentials);
        },
        [loginMutation]
    );

    const logout = useCallback(() => {
        logoutMutation.mutate();
    }, [logoutMutation]);

    return {
        user,
        tokens,
        isAuthenticated,
        isLoading: loginMutation.isPending || logoutMutation.isPending,
        login,
        logout,
    };
}
