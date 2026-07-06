import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { usersService } from '@/services/api/users.service';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/api-error';
import type { UserFilters } from '@/types/user.types';

/**
 * Hooks de Usuários (Admin — Fatia 5a). Leitura + ações essenciais.
 *
 * QueryKeys (paridade com o web):
 *  - ['users', filters, page, pageSize] — lista
 *  - ['user', id]                       — detalhe
 *
 * Mutations (activate/deactivate/resetPassword) invalidam ['users'] e o detalhe.
 * `resetPassword` retorna a senha temporária para a tela exibir; não mostra toast
 * de sucesso aqui (a tela apresenta a senha num Alert copiável).
 */

const PAGE_SIZE = 20;

/** Lista paginada de usuários (filtros de cargo/status/busca). */
export function useUsersList(filters: UserFilters, page = 1) {
    return useQuery({
        queryKey: ['users', filters, page, PAGE_SIZE],
        queryFn: () => usersService.list(filters, page, PAGE_SIZE),
        staleTime: 60 * 1000,
    });
}

/** Detalhe de um usuário. */
export function useUser(id?: number) {
    return useQuery({
        queryKey: ['user', id],
        queryFn: () => usersService.getById(id!),
        enabled: !!id,
        staleTime: 60 * 1000,
    });
}

function invalidateUsers(queryClient: ReturnType<typeof useQueryClient>, id?: number) {
    queryClient.invalidateQueries({ queryKey: ['users'] });
    if (id) queryClient.invalidateQueries({ queryKey: ['user', id] });
}

export function useActivateUser() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: (id: number) => usersService.activate(id),
        onSuccess: (_data, id) => {
            invalidateUsers(queryClient, id);
            toast.success('Usuário ativado.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao ativar usuário.'));
        },
    });
}

export function useDeactivateUser() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: (id: number) => usersService.deactivate(id),
        onSuccess: (_data, id) => {
            invalidateUsers(queryClient, id);
            toast.success('Usuário desativado.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao desativar usuário.'));
        },
    });
}

export function useResetUserPassword() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: (id: number) => usersService.resetPassword(id),
        onSuccess: (_data, id) => {
            invalidateUsers(queryClient, id);
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao redefinir a senha.'));
        },
    });
}
