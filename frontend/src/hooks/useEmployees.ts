import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesService } from '@/services/api/employees.service';
import { toast } from '@/hooks/use-toast';
import type { CreateEmployeePayload, UpdateEmployeePayload, EmployeeFilters } from '@/types/employee.types';
import { getApiErrorMessage } from '@/lib/api-error';

export function useEmployeeStats(storeId?: number) {
    return useQuery({
        queryKey: ['employee-stats', storeId],
        queryFn: () => employeesService.getStats(storeId),
        staleTime: 1000 * 60 * 2,
    });
}

export function useVacations(params?: { store_id?: number; search?: string; position?: string }) {
    return useQuery({
        queryKey: ['employee-vacations', params],
        queryFn: () => employeesService.listVacations(params),
        staleTime: 1000 * 60 * 5,
    });
}

export function useEmployeeMovements(employeeId: number, page = 1) {
    return useQuery({
        queryKey: ['employee-movements', employeeId, page],
        queryFn: () => employeesService.listMovements(employeeId, page),
        enabled: !!employeeId,
        staleTime: 1000 * 60 * 2,
    });
}

export function useCreateMovement() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ employeeId, data }: {
            employeeId: number;
            data: {
                type: string;
                movement_date: string;
                movement_data?: Record<string, unknown>;
                attachment_url?: string | null;
                notes?: string | null;
            };
        }) => employeesService.createMovement(employeeId, data),
        onSuccess: (_, { employeeId }) => {
            queryClient.invalidateQueries({ queryKey: ['employee-movements', employeeId] });
            queryClient.invalidateQueries({ queryKey: ['employee-stats'] });
            queryClient.invalidateQueries({ queryKey: ['employees'] });
            queryClient.invalidateQueries({ queryKey: ['employee-vacations'] });
            toast({ title: 'Movimentacao registrada com sucesso!' });
        },
        onError: (error: Error) => {
            toast({
                title: 'Erro ao registrar movimentacao',
                description: getApiErrorMessage(error),
                variant: 'destructive',
            });
        },
    });
}

export function useEmployees(filters?: EmployeeFilters, page = 1) {
    const queryClient = useQueryClient();

    const { data, isLoading, error } = useQuery({
        queryKey: ['employees', filters, page],
        queryFn: () => employeesService.list(filters, page),
    });

    const createMutation = useMutation({
        mutationFn: (payload: CreateEmployeePayload) => employeesService.create(payload),
        onSuccess: (emp) => {
            queryClient.invalidateQueries({ queryKey: ['employees'] });
            toast({
                title: 'Funcionário cadastrado',
                description: `${emp.name} foi adicionado ao sistema.`,
            });
        },
        onError: (error: Error) => {
            toast({ title: 'Erro ao cadastrar funcionário', description: getApiErrorMessage(error), variant: 'destructive' });
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: UpdateEmployeePayload }) =>
            employeesService.update(id, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['employees'] });
            queryClient.invalidateQueries({ queryKey: ['employee-stats'] });
            toast({ title: 'Funcionário atualizado', description: 'As alterações foram salvas.' });
        },
        onError: (error: Error) => {
            toast({ title: 'Erro ao atualizar funcionário', description: getApiErrorMessage(error), variant: 'destructive' });
        },
    });

    const deactivateMutation = useMutation({
        mutationFn: (id: number) => employeesService.deactivate(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['employees'] });
            toast({ title: 'Funcionário desativado' });
        },
        onError: () => {
            toast({ title: 'Erro ao desativar funcionário', variant: 'destructive' });
        },
    });

    const activateMutation = useMutation({
        mutationFn: (id: number) => employeesService.activate(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['employees'] });
            toast({ title: 'Funcionário reativado' });
        },
        onError: () => {
            toast({ title: 'Erro ao reativar funcionário', variant: 'destructive' });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => employeesService.delete(id),
        onSuccess: (_, deletedId) => {
            queryClient.setQueriesData(
                { queryKey: ['employees'] },
                (old: { employees: Array<{ id: number }>; total: number } | undefined) => {
                    if (!old) return old;
                    return {
                        ...old,
                        employees: old.employees.filter((e) => e.id !== deletedId),
                        total: Math.max(0, old.total - 1),
                    };
                }
            );
            toast({ title: 'Funcionário excluído com sucesso.' });
        },
        onError: () => {
            toast({
                title: 'Erro ao excluir funcionário',
                description: 'Verifique se o funcionário não possui vínculos ativos e tente novamente.',
                variant: 'destructive',
            });
        },
    });

    return {
        employees: data?.employees || [],
        total: data?.total || 0,
        isLoading,
        error,
        createEmployee: createMutation.mutate,
        updateEmployee: updateMutation.mutate,
        deactivateEmployee: deactivateMutation.mutate,
        activateEmployee: activateMutation.mutate,
        deleteEmployee: deleteMutation.mutate,
        isDeletingEmployee: deleteMutation.isPending,
        isCreating: createMutation.isPending,
        isUpdating: updateMutation.isPending,
    };
}

export function useEmployeesByStore(storeId: number | undefined) {
    return useQuery({
        queryKey: ['employees', 'by-store', storeId],
        queryFn: () => employeesService.listByStore(storeId!),
        enabled: !!storeId,
    });
}

export function useEmployeesByDepartment(storeId: number | undefined, department: string | undefined) {
    return useQuery({
        queryKey: ['employees', 'by-department', storeId, department],
        queryFn: () => employeesService.listByStoreAndDepartment(storeId!, department),
        enabled: !!(storeId && department),
    });
}

export function useFilmInstallers(department: 'film' | 'security_film' | 'ppf') {
    return useQuery({
        queryKey: ['employees', 'film-installers', department],
        queryFn: () => employeesService.listByDepartmentAllStores('film'),
        staleTime: 5 * 60 * 1000,
    });
}

export function useGalponEmployees() {
    return useQuery({
        queryKey: ['employees', 'galpon'],
        queryFn: () => employeesService.listForGalpon(),
        staleTime: 5 * 60 * 1000,
    });
}
