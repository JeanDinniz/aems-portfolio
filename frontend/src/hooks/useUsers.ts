import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersService } from '@/services/api/users.service';
import { toast } from '@/hooks/use-toast';
import type { CreateUserPayload, UpdateUserPayload, UserFilters } from '@/types/user.types';
import { getApiErrorStatus } from '@/lib/api-error';

export function useUsers(filters?: UserFilters, page = 1) {
    const queryClient = useQueryClient();

    const { data, isLoading, error } = useQuery({
        queryKey: ['users', filters, page],
        queryFn: () => usersService.list(filters, page),
    });

    const createMutation = useMutation({
        mutationFn: (payload: CreateUserPayload) => usersService.create(payload),
        onSuccess: (newUser) => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            toast({
                title: 'Usuário criado',
                description: `${newUser.full_name} foi adicionado ao sistema.`,
            });
        },
        onError: (error: Error) => {
            const isConflict = getApiErrorStatus(error) === 409;
            toast({
                title: 'Erro ao criar usuário',
                description: isConflict
                    ? 'Este e-mail já está cadastrado no sistema.'
                    : 'Não foi possível criar o usuário. Verifique os dados e tente novamente.',
                variant: 'destructive',
            });
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: UpdateUserPayload }) =>
            usersService.update(id, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            toast({
                title: 'Usuário atualizado',
                description: 'As alterações foram salvas.',
            });
        },
        onError: (error: Error) => {
            const isConflict = getApiErrorStatus(error) === 409;
            toast({
                title: 'Erro ao atualizar usuário',
                description: isConflict
                    ? 'Este e-mail já está em uso por outro usuário.'
                    : 'Não foi possível salvar as alterações. Tente novamente.',
                variant: 'destructive',
            });
        },
    });

    const activateMutation = useMutation({
        mutationFn: (id: number) => usersService.activate(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            toast({ title: 'Usuário ativado' });
        },
        onError: () => {
            toast({
                title: 'Erro ao ativar usuário',
                description: 'Não foi possível ativar o usuário. Tente novamente.',
                variant: 'destructive',
            });
        },
    });

    const deactivateMutation = useMutation({
        mutationFn: (id: number) => usersService.deactivate(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            toast({ title: 'Usuário desativado' });
        },
        onError: () => {
            toast({
                title: 'Erro ao desativar usuário',
                description: 'Não foi possível desativar o usuário. Tente novamente.',
                variant: 'destructive',
            });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => usersService.delete(id),
        onSuccess: (_, deletedId) => {
            queryClient.setQueriesData(
                { queryKey: ['users'] },
                (old: { users: Array<{ id: number }>; total: number } | undefined) => {
                    if (!old) return old;
                    return {
                        ...old,
                        users: old.users.filter((u) => u.id !== deletedId),
                        total: Math.max(0, old.total - 1),
                    };
                }
            );
            toast({ title: 'Usuário excluído com sucesso.' });
        },
        onError: () => {
            toast({
                title: 'Erro ao excluir usuário',
                description: 'Verifique se o usuário não possui vínculos ativos e tente novamente.',
                variant: 'destructive',
            });
        },
    });

    const resetPasswordMutation = useMutation({
        mutationFn: (id: number) => usersService.resetPassword(id),
        onError: () => {
            toast({
                title: 'Não foi possível redefinir a senha',
                description: 'Tente novamente ou contate o suporte.',
                variant: 'destructive',
            });
        },
    });

    return {
        users: data?.users || [],
        total: data?.total || 0,
        isLoading,
        error,
        createUser: createMutation.mutate,
        updateUser: updateMutation.mutate,
        activateUser: activateMutation.mutate,
        deactivateUser: deactivateMutation.mutate,
        deleteUser: deleteMutation.mutate,
        isDeletingUser: deleteMutation.isPending,
        resetPassword: resetPasswordMutation.mutateAsync,
        isResettingPassword: resetPasswordMutation.isPending,
        isCreating: createMutation.isPending,
        isUpdating: updateMutation.isPending,
    };
}
