import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { serviceOrdersService } from '@/services/api/service-orders.service';
import { useToast } from '@/hooks/use-toast';
import type { ServiceOrderFilters, CreateServiceOrderData } from '@/types/service-order.types';

export const useServiceOrders = (filters?: ServiceOrderFilters, skip = 0, limit = 20) => {
    return useQuery({
        queryKey: ['service-orders', filters, skip, limit],
        queryFn: () => serviceOrdersService.getAll(filters, skip, limit),
        staleTime: 60_000,
    });
};

export const useServiceOrder = (id?: number) => {
    return useQuery({
        queryKey: ['service-order', id],
        queryFn: () => serviceOrdersService.getById(id!),
        enabled: !!id,
        staleTime: 60_000,
    });
};

export const useCreateServiceOrder = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: CreateServiceOrderData) => serviceOrdersService.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['service-orders'] });
        }
    });
};

export const useUpdateServiceOrder = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: number; data: Partial<CreateServiceOrderData> }) =>
            serviceOrdersService.update(id, data),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['service-orders'] });
            queryClient.invalidateQueries({ queryKey: ['service-order'] });
            queryClient.invalidateQueries({ queryKey: ['os-history', variables.id] });
            queryClient.invalidateQueries({ queryKey: ['scheduling'] });
        }
    });
};

export const useCancelServiceOrder = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
            serviceOrdersService.cancel(id, reason),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['service-orders'] });
            queryClient.invalidateQueries({ queryKey: ['service-order', variables.id] });
            queryClient.invalidateQueries({ queryKey: ['os-history', variables.id] });
        },
    });
};

export const useUpdateServiceOrderStatus = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: ({ id, status, extras }: { id: number; status: string; extras?: Record<string, unknown> }) =>
            serviceOrdersService.updateStatus(id, status, extras),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['service-orders'] });
            queryClient.invalidateQueries({ queryKey: ['service-order', variables.id] });
            queryClient.invalidateQueries({ queryKey: ['os-history', variables.id] });
        },
        onError: () => {
            toast({
                variant: 'destructive',
                title: 'Erro ao atualizar status',
                description: 'Não foi possível atualizar o status da O.S. Verifique as condições necessárias.',
            });
        },
    });
};

export const useFinalizeServiceOrder = () => {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    return useMutation({
        mutationFn: ({ id, payload }: {
            id: number
            payload: {
                completion_photos: string[]
                film_roll_assignments: Array<{ service_id: number; film_roll_id: number }>
                employee_ids: number[]
            }
        }) => serviceOrdersService.finalize(id, payload),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['service-orders'] });
            queryClient.invalidateQueries({ queryKey: ['service-order', variables.id] });
            queryClient.invalidateQueries({ queryKey: ['os-history', variables.id] });
        },
        onError: () => {
            toast({
                variant: 'destructive',
                title: 'Erro ao finalizar O.S.',
                description: 'Não foi possível finalizar a ordem de serviço. Tente novamente.',
            });
        },
    });
};
