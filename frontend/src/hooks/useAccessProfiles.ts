import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accessProfilesService, type AccessProfileFilters } from '@/services/api/access-profiles.service';
import type { AccessProfileCreate, AccessProfileUpdate } from '@/types/accessProfile.types';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api-error';

export function useAccessProfiles(filters?: AccessProfileFilters) {
    const result = useQuery({
        queryKey: ['access-profiles', filters],
        queryFn: () => accessProfilesService.list(filters),
    });

    return {
        profiles: result.data?.items ?? [],
        total: result.data?.pagination?.total ?? 0,
        isLoading: result.isLoading,
        error: result.error,
    };
}

export function useAccessProfile(id: string | null) {
    return useQuery({
        queryKey: ['access-profiles', id],
        queryFn: () => accessProfilesService.get(id!),
        enabled: id !== null,
    });
}

export function useCreateAccessProfile() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: (data: AccessProfileCreate) => accessProfilesService.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['access-profiles'] });
            toast({ title: 'Perfil criado com sucesso!' });
        },
        onError: (error: Error) => {
            toast({
                variant: 'destructive',
                title: 'Erro ao criar perfil',
                description: getApiErrorMessage(error),
            });
        },
    });
}

export function useUpdateAccessProfile() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: AccessProfileUpdate }) =>
            accessProfilesService.update(id, data),
        onSuccess: (_, { id }) => {
            queryClient.invalidateQueries({ queryKey: ['access-profiles'] });
            queryClient.invalidateQueries({ queryKey: ['access-profiles', id] });
            toast({ title: 'Perfil atualizado com sucesso!' });
        },
        onError: (error: Error) => {
            toast({
                variant: 'destructive',
                title: 'Erro ao atualizar perfil',
                description: getApiErrorMessage(error),
            });
        },
    });
}

export function useDeleteAccessProfile() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: (id: string) => accessProfilesService.remove(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['access-profiles'] });
            toast({ title: 'Perfil excluído com sucesso!' });
        },
        onError: (error: Error) => {
            toast({
                variant: 'destructive',
                title: 'Erro ao excluir perfil',
                description: getApiErrorMessage(error),
            });
        },
    });
}

export function useProfileUsers() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const addUsers = useMutation({
        mutationFn: ({ id, user_ids }: { id: string; user_ids: string[] }) =>
            accessProfilesService.addUsers(id, user_ids),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['access-profiles'] });
        },
        onError: (error: Error) => {
            toast({
                variant: 'destructive',
                title: 'Erro ao vincular usuários',
                description: getApiErrorMessage(error),
            });
        },
    });

    const removeUsers = useMutation({
        mutationFn: ({ id, user_ids }: { id: string; user_ids: string[] }) =>
            accessProfilesService.removeUsers(id, user_ids),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['access-profiles'] });
        },
        onError: (error: Error) => {
            toast({
                variant: 'destructive',
                title: 'Erro ao desvincular usuários',
                description: getApiErrorMessage(error),
            });
        },
    });

    return { addUsers, removeUsers };
}
