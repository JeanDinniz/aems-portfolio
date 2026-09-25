import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { holidaysService } from '@/services/api/holidays.service';
import type { CreateHolidayPayload, UpdateHolidayPayload } from '@/types/holiday.types';

/**
 * Feriados (Admin) — paridade com o web `HolidaysManagementPage`.
 *
 * A lista é chaveada por ano (`['holidays', year]`, staleTime 2min); traz todas
 * as lojas do ano (o web não filtra por loja aqui). As mutations invalidam
 * `['holidays']` em cascata (todos os anos).
 */
export function useHolidays(year: number) {
    return useQuery({
        queryKey: ['holidays', year],
        queryFn: () => holidaysService.list({ year, limit: 100 }),
        staleTime: 1000 * 60 * 2,
    });
}

export function useCreateHoliday() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (payload: CreateHolidayPayload) => holidaysService.create(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['holidays'] });
        },
    });
}

export function useUpdateHoliday() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: UpdateHolidayPayload }) =>
            holidaysService.update(id, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['holidays'] });
        },
    });
}

export function useDeleteHoliday() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => holidaysService.remove(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['holidays'] });
        },
    });
}
