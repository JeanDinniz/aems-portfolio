import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Filtros persistidos por SESSÃO (sessionStorage): sobrevivem à navegação
 * entre páginas e ao F5, mas voltam aos padrões ao fechar o navegador/aba.
 */

// ─── helpers de datas padrão (calculadas na hora para sessões novas) ─────────
function todayStr(): string {
    return new Date().toISOString().split('T')[0];
}
function firstOfMonthStr(): string {
    return new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        .toISOString().split('T')[0];
}
function lastOfMonthStr(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
}

// ─── Conferência ─────────────────────────────────────────────────────────────

export type ConferenceStatusValue =
    | 'pending' | 'verified' | 'cancelled' | 'wrong' | 'duplicate';

export interface ConferenceFlagFilters {
    courtesy: boolean;
    galpon: boolean;
    retorno: boolean;
}

interface ConferenceFiltersState {
    dateFrom: string;
    dateTo: string;
    departments: string[];
    search: string;
    serviceIds: number[];
    statusFilters: ConferenceStatusValue[];
    flagFilters: ConferenceFlagFilters;
    workerId: number | undefined;
    selectedStoreIds: number[];
    setDateFrom: (v: string) => void;
    setDateTo: (v: string) => void;
    setDepartments: (v: string[]) => void;
    setSearch: (v: string) => void;
    setServiceIds: (v: number[]) => void;
    setStatusFilters: (v: ConferenceStatusValue[]) => void;
    setFlagFilters: (v: ConferenceFlagFilters | ((prev: ConferenceFlagFilters) => ConferenceFlagFilters)) => void;
    setWorkerId: (v: number | undefined) => void;
    setSelectedStoreIds: (v: number[] | ((prev: number[]) => number[])) => void;
    reset: () => void;
}

function conferenceDefaults() {
    return {
        dateFrom: firstOfMonthStr(),
        dateTo: todayStr(),
        departments: [] as string[],
        search: '',
        serviceIds: [] as number[],
        statusFilters: ['pending'] as ConferenceStatusValue[],
        flagFilters: { courtesy: false, galpon: false, retorno: false },
        workerId: undefined as number | undefined,
        selectedStoreIds: [] as number[],
    };
}

export const useConferenceFiltersStore = create<ConferenceFiltersState>()(
    persist(
        (set) => ({
            ...conferenceDefaults(),
            setDateFrom: (v) => set({ dateFrom: v }),
            setDateTo: (v) => set({ dateTo: v }),
            setDepartments: (v) => set({ departments: v }),
            setSearch: (v) => set({ search: v }),
            setServiceIds: (v) => set({ serviceIds: v }),
            setStatusFilters: (v) => set({ statusFilters: v }),
            setFlagFilters: (v) =>
                set((s) => ({ flagFilters: typeof v === 'function' ? v(s.flagFilters) : v })),
            setWorkerId: (v) => set({ workerId: v }),
            setSelectedStoreIds: (v) =>
                set((s) => ({ selectedStoreIds: typeof v === 'function' ? v(s.selectedStoreIds) : v })),
            reset: () => set(conferenceDefaults()),
        }),
        {
            name: 'aems-conference-filters',
            version: 1,
            storage: createJSONStorage(() => sessionStorage),
            partialize: (s) => ({
                dateFrom: s.dateFrom,
                dateTo: s.dateTo,
                departments: s.departments,
                search: s.search,
                serviceIds: s.serviceIds,
                statusFilters: s.statusFilters,
                flagFilters: s.flagFilters,
                workerId: s.workerId,
                selectedStoreIds: s.selectedStoreIds,
            }),
            migrate: (persisted: unknown, version: number) => {
                if (version === 0) {
                    const old = persisted as Record<string, unknown>;
                    const dep = typeof old.department === 'string' && old.department ? [old.department] : [];
                    let statusFilters: ConferenceStatusValue[] = ['pending'];
                    if (old.verifiedFilter === 'all') {
                        statusFilters = []; // vazio = "Todas" (mesmo significado do antigo 'all')
                    } else if (typeof old.verifiedFilter === 'string' && old.verifiedFilter !== '') {
                        statusFilters = [old.verifiedFilter as ConferenceStatusValue];
                    }
                    return {
                        ...old,
                        departments: dep,
                        serviceIds: [],
                        statusFilters,
                        department: undefined,
                        serviceSearch: undefined,
                        verifiedFilter: undefined,
                    };
                }
                return persisted as ConferenceFiltersState;
            },
        },
    ),
);

// ─── Fechamento ──────────────────────────────────────────────────────────────

interface FechamentoFiltersState {
    /** null = ainda não escolhida nesta sessão (a página aplica o fallback padrão) */
    storeId: number | null;
    dateFrom: string;
    dateTo: string;
    setStoreId: (v: number) => void;
    setDateFrom: (v: string) => void;
    setDateTo: (v: string) => void;
    reset: () => void;
}

function fechamentoDefaults() {
    return {
        storeId: null as number | null,
        dateFrom: firstOfMonthStr(),
        dateTo: lastOfMonthStr(),
    };
}

export const useFechamentoFiltersStore = create<FechamentoFiltersState>()(
    persist(
        (set) => ({
            ...fechamentoDefaults(),
            setStoreId: (v) => set({ storeId: v }),
            setDateFrom: (v) => set({ dateFrom: v }),
            setDateTo: (v) => set({ dateTo: v }),
            reset: () => set(fechamentoDefaults()),
        }),
        {
            name: 'aems-fechamento-filters',
            storage: createJSONStorage(() => sessionStorage),
            partialize: (s) => ({
                storeId: s.storeId,
                dateFrom: s.dateFrom,
                dateTo: s.dateTo,
            }),
        },
    ),
);
