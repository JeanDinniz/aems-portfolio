import { useMemo } from 'react';
import {
    useQuery,
    useInfiniteQuery,
    useMutation,
    useQueryClient,
} from '@tanstack/react-query';

import { schedulingService } from '@/services/api/scheduling.service';
import { useStoreStore } from '@/stores/store.store';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/api-error';
import type {
    Appointment,
    AppointmentFilters,
    CreateAppointmentPayload,
    UpdateAppointmentPayload,
    SchedulingStoreSummary,
} from '@/types/scheduling.types';

/**
 * Hooks de Agendamentos (AGD-01) — adaptados de
 * frontend/src/hooks/useScheduling.ts para o mobile.
 *
 * Diferenças do web:
 * - A LISTA usa `useInfiniteQuery` (paginação infinita por page/limit) em vez do
 *   `useQuery` paginado, para suportar scroll infinito + pull-to-refresh.
 * - O `store_id` da loja selecionada globalmente (`selectedStoreId`) é injetado
 *   nos filtros (igual ao useServiceOrders). `null` = "Todas as Lojas".
 * - As queryKeys mantêm o prefixo `['scheduling', ...]` — o WebSocketProvider
 *   (Fatia 1) invalida `['scheduling']` em eventos de loja; manter o prefixo
 *   garante que a lista revalide em tempo real.
 * - Toast via `useToast()` do design system mobile (`.success`/`.error`).
 */

/**
 * Mescla a loja selecionada globalmente nos filtros. Filtros explícitos do
 * componente vencem; se nenhum `store_id` for passado e houver loja
 * selecionada, injeta `store_id`. `selectedStoreId === null` → não injeta.
 */
function withSelectedStore(
    filters: AppointmentFilters | undefined,
    selectedStoreId: number | null
): AppointmentFilters {
    const base = filters ?? {};
    const hasExplicitStore =
        base.store_id !== undefined && base.store_id !== null;
    if (selectedStoreId === null || hasExplicitStore) {
        return base;
    }
    return { ...base, store_id: selectedStoreId };
}

export interface AppointmentsPage {
    items: Appointment[];
    total: number;
}

const APPOINTMENTS_PAGE_SIZE = 50;

/**
 * Lista paginada (scroll infinito) de agendamentos. Injeta a loja selecionada.
 * Expõe a lista já achatada + flags de paginação/refresh, prontos para a tela.
 */
export function useAppointments(
    filters: AppointmentFilters = {},
    limit = APPOINTMENTS_PAGE_SIZE
) {
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);
    const effectiveFilters = withSelectedStore(filters, selectedStoreId);

    const query = useInfiniteQuery<AppointmentsPage>({
        queryKey: ['scheduling', effectiveFilters, limit],
        queryFn: async ({ pageParam }) => {
            const page = (pageParam as number) ?? 1;
            const data = await schedulingService.list(effectiveFilters, page, limit);
            return { items: data.items, total: data.pagination.total };
        },
        initialPageParam: 1,
        getNextPageParam: (lastPage, allPages) => {
            const loaded = allPages.reduce((acc, p) => acc + p.items.length, 0);
            if (loaded >= lastPage.total) return undefined;
            return allPages.length + 1; // próxima página (1-indexed)
        },
        staleTime: 0,
        gcTime: 1000 * 60 * 2,
    });

    const { items, total } = useMemo(() => {
        if (!query.data) return { items: [] as Appointment[], total: 0 };
        const flatItems = query.data.pages.flatMap((p) => p.items);
        const lastTotal = query.data.pages[query.data.pages.length - 1]?.total ?? 0;
        return { items: flatItems, total: lastTotal };
    }, [query.data]);

    return {
        items,
        total,
        isLoading: query.isLoading,
        isError: query.isError,
        refetch: query.refetch,
        fetchNextPage: query.fetchNextPage,
        hasNextPage: query.hasNextPage,
        isFetchingNextPage: query.isFetchingNextPage,
        isRefetching: query.isRefetching,
    };
}

export function useAppointment(id?: number) {
    return useQuery({
        queryKey: ['scheduling', id],
        queryFn: () => schedulingService.getById(id!),
        enabled: !!id,
        staleTime: 1000 * 30,
        gcTime: 1000 * 60 * 2,
    });
}

export function useTodaySummary(storeId?: number | null) {
    return useQuery({
        queryKey: ['scheduling-summary', storeId],
        queryFn: () => schedulingService.getTodaySummary(storeId),
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 2,
    });
}

export function useSchedulingStoreSummary(
    filters: { date_from?: string; date_to?: string; department?: string } = {},
    enabled = true
) {
    return useQuery<SchedulingStoreSummary[]>({
        queryKey: ['scheduling-store-summary', filters],
        queryFn: () => schedulingService.getStoreSummary(filters),
        staleTime: 1000 * 30,
        gcTime: 1000 * 60 * 2,
        enabled,
    });
}

export function useAppointmentCapacity(
    storeId: number | null,
    deliveryDate: string
) {
    return useQuery({
        queryKey: ['scheduling-capacity', storeId, deliveryDate],
        queryFn: () => schedulingService.getCapacity(storeId!, deliveryDate),
        enabled: !!storeId && !!deliveryDate,
        staleTime: 1000 * 60 * 1,
    });
}

export function useAppointmentHistory(id?: number | null) {
    return useQuery({
        queryKey: ['scheduling-history', id],
        queryFn: () => schedulingService.getHistory(id!),
        enabled: !!id,
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 2,
        retry: false,
    });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/** Invalida as queries de lista/resumo afetadas por mutações de agendamento. */
function invalidateSchedulingQueries(queryClient: ReturnType<typeof useQueryClient>) {
    queryClient.invalidateQueries({ queryKey: ['scheduling'] });
    queryClient.invalidateQueries({ queryKey: ['scheduling-summary'] });
    queryClient.invalidateQueries({ queryKey: ['scheduling-store-summary'] });
}

export function useCreateAppointment() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: (payload: CreateAppointmentPayload) => schedulingService.create(payload),
        onSuccess: () => {
            invalidateSchedulingQueries(queryClient);
            toast.success('Agendamento criado com sucesso.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error));
        },
    });
}

export function useUpdateAppointment() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: UpdateAppointmentPayload }) =>
            schedulingService.update(id, payload),
        onSuccess: (_, variables) => {
            invalidateSchedulingQueries(queryClient);
            queryClient.invalidateQueries({ queryKey: ['scheduling-history', variables.id] });
            toast.success('Agendamento atualizado.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error));
        },
    });
}

export function useCancelAppointment() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
            schedulingService.cancel(id, reason),
        onSuccess: () => {
            invalidateSchedulingQueries(queryClient);
            toast.success('Agendamento cancelado.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error));
        },
    });
}

export function useGenerateOS() {
    const queryClient = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: ({
            id,
            payload,
        }: {
            id: number;
            payload: { photos: string[]; notes?: string };
        }) => schedulingService.generateOS(id, payload),
        onSuccess: () => {
            invalidateSchedulingQueries(queryClient);
            queryClient.invalidateQueries({ queryKey: ['service-orders'] });
            toast.success('O.S. gerada e vinculada ao agendamento.');
        },
        onError: (error: Error) => {
            toast.error(getApiErrorMessage(error));
        },
    });
}
