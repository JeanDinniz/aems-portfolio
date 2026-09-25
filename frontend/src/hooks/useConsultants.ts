import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { consultantsService } from '@/services/api/consultants.service';
import { toast } from '@/hooks/use-toast';
import type { CreateConsultantPayload, UpdateConsultantPayload, ConsultantFilters } from '@/types/consultant.types';
import { getApiErrorMessage } from '@/lib/api-error';
import { CATALOG_STALE_TIME, CATALOG_GC_TIME, consultantsKey } from '@/lib/catalog-queries';

export function useConsultants(filters?: ConsultantFilters, page = 1, pageSize = 20) {
    const queryClient = useQueryClient();

    const { data, isLoading, error } = useQuery({
        queryKey: consultantsKey(filters, page, pageSize),
        queryFn: () => consultantsService.list(filters, page, pageSize),
        staleTime: CATALOG_STALE_TIME,
        gcTime: CATALOG_GC_TIME,
    });

    const createMutation = useMutation({
        mutationFn: (payload: CreateConsultantPayload) => consultantsService.create(payload),
        onSuccess: (newConsultant) => {
            queryClient.invalidateQueries({ queryKey: ['consultants'] });
            toast({
                title: 'Consultor criado',
                description: `${newConsultant.name} foi adicionado ao sistema.`,
            });
        },
        onError: (error: Error) => {
            toast({
                title: 'Erro ao criar consultor',
                description: getApiErrorMessage(error),
                variant: 'destructive',
            });
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: UpdateConsultantPayload }) =>
            consultantsService.update(id, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['consultants'] });
            toast({
                title: 'Consultor atualizado',
                description: 'As alterações foram salvas.',
            });
        },
        onError: (error: Error) => {
            toast({
                title: 'Erro ao atualizar consultor',
                description: getApiErrorMessage(error),
                variant: 'destructive',
            });
        },
    });

    const activateMutation = useMutation({
        mutationFn: (id: number) => consultantsService.activate(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['consultants'] });
            toast({ title: 'Consultor ativado' });
        },
    });

    const deactivateMutation = useMutation({
        mutationFn: (id: number) => consultantsService.deactivate(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['consultants'] });
            toast({ title: 'Consultor desativado' });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => consultantsService.delete(id),
        onSuccess: (_, deletedId) => {
            queryClient.setQueriesData(
                { queryKey: ['consultants'] },
                (old: { consultants: Array<{ id: number }>; total: number } | undefined) => {
                    if (!old) return old;
                    return {
                        ...old,
                        consultants: old.consultants.filter((c) => c.id !== deletedId),
                        total: Math.max(0, old.total - 1),
                    };
                }
            );
            toast({ title: 'Consultor excluído com sucesso.' });
        },
        onError: () => {
            toast({
                title: 'Erro ao excluir consultor',
                description: 'Verifique se o consultor não possui vínculos ativos e tente novamente.',
                variant: 'destructive',
            });
        },
    });

    return {
        consultants: data?.consultants || [],
        total: data?.total || 0,
        isLoading,
        error,
        createConsultant: createMutation.mutate,
        updateConsultant: updateMutation.mutate,
        activateConsultant: activateMutation.mutate,
        deactivateConsultant: deactivateMutation.mutate,
        deleteConsultant: deleteMutation.mutate,
        isDeletingConsultant: deleteMutation.isPending,
        isCreating: createMutation.isPending,
        isUpdating: updateMutation.isPending,
    };
}
