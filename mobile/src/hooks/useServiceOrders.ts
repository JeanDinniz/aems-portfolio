import { useMemo } from 'react';
import {
    useQuery,
    useInfiniteQuery,
    useMutation,
    useQueryClient,
} from '@tanstack/react-query';

import {
    serviceOrdersService,
    type ConferenceStoreSummaryItem,
    type DuplicateCheckResult,
} from '@/services/api/service-orders.service';
import { useStoreStore } from '@/stores/store.store';
import { addBreadcrumb } from '@/lib/sentry';
import type { ServiceOrder, ServiceOrderFilters, CreateServiceOrderData } from '@/types/service-order.types';

/**
 * Hooks de Ordens de Serviço (OS-01) — adaptados de
 * frontend/src/hooks/useServiceOrders.ts para o mobile.
 *
 * Diferenças do web:
 * - A LISTA usa `useInfiniteQuery` (paginação infinita por page/limit) em vez
 *   de `useQuery` paginado, para suportar scroll infinito + pull-to-refresh.
 * - O `store_id` da loja selecionada globalmente (`selectedStoreId`) é injetado
 *   nos filtros. `null` = "Todas as Lojas" → não envia store_id. Filtros vindos
 *   do componente têm precedência (permitem sobrescrever a loja).
 */

/**
 * Mescla a loja selecionada globalmente nos filtros. Filtros explícitos do
 * componente vencem; se nenhum store/location for passado e houver loja
 * selecionada, injeta `store_id`. `selectedStoreId === null` → não injeta.
 */
function withSelectedStore(
    filters: ServiceOrderFilters | undefined,
    selectedStoreId: number | null
): ServiceOrderFilters | undefined {
    const hasExplicitStore =
        filters?.store_id !== undefined || filters?.location_id !== undefined;
    if (selectedStoreId === null || hasExplicitStore) {
        return filters;
    }
    return { ...filters, store_id: selectedStoreId };
}

export interface ServiceOrdersPage {
    items: ServiceOrder[];
    total: number;
}

/**
 * Lista paginada (scroll infinito) de O.S. Injeta a loja selecionada.
 * Use `flattenServiceOrders(query.data)` para obter `{ items, total }`.
 */
export const useServiceOrders = (filters?: ServiceOrderFilters, skip = 0, limit = 20) => {
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);
    const effectiveFilters = withSelectedStore(filters, selectedStoreId);

    return useInfiniteQuery<ServiceOrdersPage>({
        // limit faz parte da chave; skip/page não (a paginação é interna ao infinite query)
        queryKey: ['service-orders', effectiveFilters, limit],
        queryFn: ({ pageParam }) =>
            serviceOrdersService.getAll(effectiveFilters, (pageParam as number) ?? skip, limit),
        initialPageParam: skip,
        getNextPageParam: (lastPage, allPages) => {
            const loaded = allPages.reduce((acc, p) => acc + p.items.length, 0);
            if (loaded >= lastPage.total) return undefined;
            return loaded; // próximo `skip`
        },
        staleTime: 60_000,
    });
};

/** Achata as páginas do infinite query em `{ items, total }`. */
export function flattenServiceOrders(
    data: { pages: ServiceOrdersPage[] } | undefined
): { items: ServiceOrder[]; total: number } {
    if (!data) return { items: [], total: 0 };
    const items = data.pages.flatMap((p) => p.items);
    const total = data.pages[data.pages.length - 1]?.total ?? 0;
    return { items, total };
}

/** Hook utilitário: lista já achatada + flags de paginação. */
export function useServiceOrdersList(filters?: ServiceOrderFilters, limit = 20) {
    const query = useServiceOrders(filters, 0, limit);
    const { items, total } = useMemo(() => flattenServiceOrders(query.data), [query.data]);
    return { ...query, items, total };
}

export const useServiceOrder = (id?: number) => {
    return useQuery({
        queryKey: ['service-order', id],
        queryFn: () => serviceOrdersService.getById(id!),
        enabled: !!id,
        staleTime: 60_000,
    });
};

export const useOSHistory = (id?: number) => {
    return useQuery({
        queryKey: ['os-history', id],
        queryFn: () => serviceOrdersService.getOSHistory(id!),
        enabled: !!id,
        staleTime: 60_000,
    });
};

// ─── Mutations (prontas para Sprint 3) ──────────────────────────────────────

export const useCreateServiceOrder = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: CreateServiceOrderData) => {
            // Breadcrumb SEM PII: só contadores/flags (nada de placa, notas,
            // consultor ou URLs). Ajuda a diagnosticar falhas de criação.
            addBreadcrumb('service_order', 'create submitted', {
                items: data.items?.length ?? 0,
                photos: data.photos?.length ?? 0,
                workers: data.workers?.length ?? 0,
                is_galpon: !!data.is_galpon,
                is_return: !!data.is_return,
                is_courtesy: !!data.is_courtesy,
            });
            return serviceOrdersService.create(data);
        },
        onSuccess: () => {
            addBreadcrumb('service_order', 'create success');
            queryClient.invalidateQueries({ queryKey: ['service-orders'] });
        },
        onError: () => {
            addBreadcrumb('service_order', 'create failed');
        },
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
        },
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
    return useMutation({
        mutationFn: ({
            id,
            status,
            extras,
        }: {
            id: number;
            status: string;
            extras?: Record<string, unknown>;
        }) => serviceOrdersService.updateStatus(id, status, extras),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['service-orders'] });
            queryClient.invalidateQueries({ queryKey: ['service-order', variables.id] });
            queryClient.invalidateQueries({ queryKey: ['os-history', variables.id] });
        },
    });
};

export const useFinalizeServiceOrder = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({
            id,
            payload,
        }: {
            id: number;
            payload: {
                completion_photos: string[];
                film_roll_assignments: Array<{ service_id: number; film_roll_id: number }>;
                employee_ids: number[];
            };
        }) => serviceOrdersService.finalize(id, payload),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['service-orders'] });
            queryClient.invalidateQueries({ queryKey: ['service-order', variables.id] });
            queryClient.invalidateQueries({ queryKey: ['os-history', variables.id] });
        },
    });
};

// ─── Conferência (OS-10) ─────────────────────────────────────────────────────
// Espelha frontend/src/hooks/useConferenceSummary.ts + as mutations verify/unverify
// da ConferencePage. Backend: PATCH /service-orders/{id} { is_verified } e
// GET /service-orders/conference/summary.

export interface ConferenceSummaryFilters {
    store_ids?: number[];
    date_from?: string;
    date_to?: string;
    plate?: string;
    worker_id?: number;
    include_cancelled?: boolean;
    is_courtesy?: boolean;
}

export interface ConferenceSummaryItem {
    department: string;
    total: number;
    verified: number;
    waiting: number;
    wrong: number;
    cancelled: number;
    percent_verified: number;
}

/** Resumo de conferência por departamento. queryKey espelha o web. */
export const useConferenceSummary = (filters: ConferenceSummaryFilters, enabled = true) => {
    return useQuery<ConferenceSummaryItem[]>({
        queryKey: ['service-orders', 'conference', 'summary', filters],
        queryFn: () => serviceOrdersService.getConferenceSummary(filters),
        staleTime: 30_000,
        enabled,
    });
};

/** Resumo de conferência por LOJA (A4). queryKey espelha o resumo por depto. */
export const useConferenceSummaryByStore = (filters: ConferenceSummaryFilters, enabled = true) => {
    return useQuery<ConferenceStoreSummaryItem[]>({
        queryKey: ['service-orders', 'conference', 'summary-by-store', filters],
        queryFn: () => serviceOrdersService.getConferenceSummaryByStore(filters),
        staleTime: 30_000,
        enabled,
    });
};

/** Invalida as queries afetadas por verificar/desverificar uma O.S. */
function invalidateConferenceQueries(queryClient: ReturnType<typeof useQueryClient>) {
    queryClient.invalidateQueries({ queryKey: ['service-orders'] });
    queryClient.invalidateQueries({ queryKey: ['service-order'] });
    queryClient.invalidateQueries({ queryKey: ['os-history'] });
}

export type ConferenceVerifiedFilter = 'pending' | 'verified' | 'all';

export interface ConferenceListFilters {
    /** Lojas selecionadas explicitamente; quando vazio, usa a loja global. */
    verified: ConferenceVerifiedFilter;
    is_courtesy?: boolean;
    date_from?: string;
    date_to?: string;
    plate?: string;
    department?: string;
}

const CONFERENCE_PAGE_SIZE = 20;

/**
 * Lista paginada (scroll infinito) de O.S. para conferência. Espelha o filtro do
 * web ConferencePage: `is_verified` quando o filtro é pending/verified, sempre
 * status `completed` (apenas finalizadas são conferíveis), `flag=courtesy` opcional.
 * A loja selecionada globalmente é injetada via `store_id`.
 */
export const useConferenceList = (filters: ConferenceListFilters) => {
    const selectedStoreId = useStoreStore((s) => s.selectedStoreId);

    const buildParams = (page: number) => ({
        store_id: selectedStoreId ?? undefined,
        status: 'completed',
        is_verified:
            filters.verified === 'all' ? undefined : filters.verified === 'verified',
        flag: filters.is_courtesy ? ['courtesy'] : undefined,
        date_from: filters.date_from || undefined,
        date_to: filters.date_to || undefined,
        plate: filters.plate || undefined,
        department: filters.department || undefined,
        page,
        limit: CONFERENCE_PAGE_SIZE,
    });

    const query = useInfiniteQuery<ServiceOrdersPage>({
        queryKey: ['service-orders', 'conference', 'list', selectedStoreId, filters],
        queryFn: ({ pageParam }) => serviceOrdersService.getFiltered(buildParams((pageParam as number) ?? 1)),
        initialPageParam: 1,
        getNextPageParam: (lastPage, allPages) => {
            const loaded = allPages.reduce((acc, p) => acc + p.items.length, 0);
            if (loaded >= lastPage.total) return undefined;
            return allPages.length + 1; // próxima página
        },
        staleTime: 30_000,
    });

    const { items, total } = useMemo(() => flattenServiceOrders(query.data), [query.data]);
    return { ...query, items, total };
};

export const useVerifyServiceOrder = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => serviceOrdersService.verify(id),
        onSuccess: () => invalidateConferenceQueries(queryClient),
    });
};

export const useUnverifyServiceOrder = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: number) => serviceOrdersService.unverify(id),
        onSuccess: () => invalidateConferenceQueries(queryClient),
    });
};

// ─── Checagem de duplicidade ao lançar (A3) ──────────────────────────────────
// Espelha o web QuickCreateModal: alerta NÃO bloqueante. A query só dispara
// quando há placa + departamento + data + ≥1 serviço (gate via `enabled`).

export interface DuplicateCheckParams {
    plate: string;
    service_date: string; // YYYY-MM-DD
    department: string;
    service_ids: number[];
}

export const useDuplicateCheck = (params: DuplicateCheckParams, enabled: boolean) => {
    return useQuery<DuplicateCheckResult>({
        queryKey: ['service-orders', 'duplicate-check', params],
        queryFn: () => serviceOrdersService.duplicateCheck(params),
        enabled:
            enabled &&
            !!params.plate &&
            !!params.department &&
            !!params.service_date &&
            params.service_ids.length > 0,
        staleTime: 30_000,
        // Não relança em foco/reconexão — é só um aviso informativo.
        refetchOnWindowFocus: false,
    });
};
