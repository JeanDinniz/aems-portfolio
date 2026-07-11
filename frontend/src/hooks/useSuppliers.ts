import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { suppliersService } from '@/services/api/suppliers.service';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api-error';
import type { SupplierCreate, SupplierFilters, SupplierUpdate } from '@/types/supplier';

/** Lista de fornecedores ativos — ideal para dropdowns */
export function useSuppliers(params?: SupplierFilters) {
    return useQuery({
        queryKey: ['suppliers', params],
        queryFn: () => suppliersService.list({ is_active: true, limit: 100, ...params }),
        staleTime: 1000 * 60 * 5,
    });
}

/** Lista completa para o CRUD admin (sem filtro de is_active por default) */
export function useSuppliersAdmin(params?: SupplierFilters) {
    return useQuery({
        queryKey: ['suppliers-admin', params],
        queryFn: () => suppliersService.list(params),
        staleTime: 1000 * 60 * 5,
    });
}

export function useCreateSupplier() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: (payload: SupplierCreate) => suppliersService.create(payload),
        onSuccess: (newSupplier) => {
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            queryClient.invalidateQueries({ queryKey: ['suppliers-admin'] });
            toast({
                title: 'Fornecedor criado',
                description: `${newSupplier.company_name} foi adicionado ao sistema.`,
            });
        },
        onError: (error: Error) => {
            toast({
                title: 'Erro ao criar fornecedor',
                description: getApiErrorMessage(error),
                variant: 'destructive',
            });
        },
    });
}

export function useUpdateSupplier() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: SupplierUpdate }) =>
            suppliersService.update(id, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            queryClient.invalidateQueries({ queryKey: ['suppliers-admin'] });
            toast({
                title: 'Fornecedor atualizado',
                description: 'As alterações foram salvas.',
            });
        },
        onError: (error: Error) => {
            toast({
                title: 'Erro ao atualizar fornecedor',
                description: getApiErrorMessage(error),
                variant: 'destructive',
            });
        },
    });
}

export function useDeactivateSupplier() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    return useMutation({
        mutationFn: (id: number) => suppliersService.deactivate(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
            queryClient.invalidateQueries({ queryKey: ['suppliers-admin'] });
            toast({ title: 'Fornecedor desativado' });
        },
        onError: (error: Error) => {
            toast({
                title: 'Erro ao desativar fornecedor',
                description: getApiErrorMessage(error),
                variant: 'destructive',
            });
        },
    });
}
