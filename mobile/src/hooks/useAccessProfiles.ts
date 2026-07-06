import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
    accessProfilesService,
    type AccessProfileFilters,
} from '@/services/api/access-profiles.service';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/api-error';

/**
 * Hooks de Perfis de Acesso (Admin — Fatia 5a). Leitura + ações essenciais.
 *
 * QueryKeys (paridade com o web):
 *  - ['access-profiles', filters] — lista
 *  - ['access-profile', id]       — detalhe (id é string)
 *
 * Ações: alternar `is_active` (via update) e remover usuário vinculado
 * (removeUsers). Adicionar usuário fica para v2.
 */
export function useAccessProfilesList(filters?: AccessProfileFilters) {
    return useQuery({
        queryKey: ['access-profiles', filters],
        queryFn: () => accessProfilesService.list(filters),
        staleTime: 60 * 1000,
    });
}

export function useAccessProfile(id?: string) {
    return useQuery({
        queryKey: ['access-profile', id],
        queryFn: () => accessProfilesService.get(id!),
        enabled: !!id,
        staleTime: 60 * 1000,
    });
}

function invalidateProfiles(queryClient: ReturnType<typeof useQueryClient>, id?: string) {
    queryClient.invalidateQueries({ queryKey: ['access-profiles'] });
    if (id) queryClient.invalidateQueries({ queryKey: ['access-profile', id] });
}

export function useToggleAccessProfileActive() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
            accessProfilesService.update(id, { is_active: isActive }),
        onSuccess: (_data, { id, isActive }) => {
            invalidateProfiles(queryClient, id);
            toast.success(isActive ? 'Perfil ativado.' : 'Perfil desativado.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao atualizar o perfil.'));
        },
    });
}

export function useRemoveProfileUser() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({ id, userId }: { id: string; userId: string }) =>
            accessProfilesService.removeUsers(id, [userId]),
        onSuccess: (_data, { id }) => {
            invalidateProfiles(queryClient, id);
            toast.success('Usuário removido do perfil.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error, 'Erro ao remover o usuário.'));
        },
    });
}
