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

export type ConferenceVerifiedFilter =
    | 'pending' | 'verified' | 'all' | 'cancelled' | 'wrong' | 'duplicate';

export interface ConferenceFlagFilters {
    courtesy: boolean;
    galpon: boolean;
    retorno: boolean;
}

interface ConferenceFiltersState {
    dateFrom: string;
    dateTo: string;
    department: string;
    search: string;
    verifiedFilter: ConferenceVerifiedFilter;
    flagFilters: ConferenceFlagFilters;
    workerId: number | undefined;
    selectedStoreIds: number[];
    setDateFrom: (v: string) => void;
    setDateTo: (v: string) => void;
    setDepartment: (v: string) => void;
    setSearch: (v: string) => void;
    setVerifiedFilter: (v: ConferenceVerifiedFilter) => void;
    setFlagFilters: (v: ConferenceFlagFilters | ((prev: ConferenceFlagFilters) => ConferenceFlagFilters)) => void;
    setWorkerId: (v: number | undefined) => void;
    setSelectedStoreIds: (v: number[] | ((prev: number[]) => number[])) => void;
    reset: () => void;
}

function conferenceDefaults() {
    return {
        dateFrom: firstOfMonthStr(),
        dateTo: todayStr(),
        department: '',
        search: '',
        verifiedFilter: 'pending' as ConferenceVerifiedFilter,
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
            setDepartment: (v) => set({ department: v }),
            setSearch: (v) => set({ search: v }),
            setVerifiedFilter: (v) => set({ verifiedFilter: v }),
            setFlagFilters: (v) =>
                set((s) => ({ flagFilters: typeof v === 'function' ? v(s.flagFilters) : v })),
            setWorkerId: (v) => set({ workerId: v }),
            setSelectedStoreIds: (v) =>
                set((s) => ({ selectedStoreIds: typeof v === 'function' ? v(s.selectedStoreIds) : v })),
            reset: () => set(conferenceDefaults()),
        }),
        {
            name: 'aems-conference-filters',
            storage: createJSONStorage(() => sessionStorage),
            partialize: (s) => ({
                dateFrom: s.dateFrom,
                dateTo: s.dateTo,
                department: s.department,
                search: s.search,
                verifiedFilter: s.verifiedFilter,
                flagFilters: s.flagFilters,
                workerId: s.workerId,
                selectedStoreIds: s.selectedStoreIds,
            }),
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
