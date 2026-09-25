import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { IndicatorDepartment } from '@/types/indicators.types';

/**
 * Filtros da tela "Películas" (ex-"Indicadores de Películas"), persistidos
 * por SESSÃO (sessionStorage): sobrevivem à navegação entre páginas e ao F5,
 * mas voltam aos padrões ao fechar o navegador/aba. Segue o mesmo padrão de
 * `filters.store.ts` (create + persist + createJSONStorage(sessionStorage)).
 *
 * Guarda os filtros COMPARTILHADOS aplicados (após clicar "Aplicar"). Desde a
 * v3, Tipo e Tonalidade são GLOBAIS (afetam os 8 cards) — antes eram filtros
 * LOCAIS de cada card (Rentabilidade / Performance Comercial). Ver ADR 0034.
 *
 * Os filtros "pendentes" (em edição, antes de aplicar) vivem em useState
 * local dentro de `PeliculasFiltersBar` — isso preserva o gate que evita
 * refetch das 8 queries a cada tecla/seleção.
 */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function getCurrentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

/** 'prev' = mês anterior (padrão do backend); senão 'YYYY-MM' de comparação. */
export const COMPARE_PREV = 'prev';

export interface PeliculasFiltersValues {
  monthValue: string;
  compareValue: string;
  brandIds: number[];
  storeIds: number[];
  departments: IndicatorDepartment[];
  /** Global desde a v3 (era filtro local por card nas v1/v2). */
  filmTypeIds: number[];
  /** Global desde a v3 (era filtro local por card nas v1/v2). */
  tonalities: string[];
}

interface PeliculasFiltersState extends PeliculasFiltersValues {
  /** Grava de uma vez todos os filtros pendentes como aplicados. */
  apply: (filters: PeliculasFiltersValues) => void;
  reset: () => void;
}

function peliculasDefaults(): PeliculasFiltersValues {
  return {
    monthValue: getCurrentMonthValue(),
    compareValue: COMPARE_PREV,
    brandIds: [],
    storeIds: [],
    departments: [],
    filmTypeIds: [],
    tonalities: [],
  };
}

export const usePeliculasFiltersStore = create<PeliculasFiltersState>()(
  persist(
    (set) => ({
      ...peliculasDefaults(),
      apply: (filters) => set(filters),
      reset: () => set(peliculasDefaults()),
    }),
    {
      name: 'aems-peliculas-filters',
      version: 3,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({
        monthValue: s.monthValue,
        compareValue: s.compareValue,
        brandIds: s.brandIds,
        storeIds: s.storeIds,
        departments: s.departments,
        filmTypeIds: s.filmTypeIds,
        tonalities: s.tonalities,
      }),
      migrate: (persisted: unknown, version: number) => {
        if (version < 3) {
          // v1 tinha filmTypeIds/tonalities GLOBAIS (reaproveitados aqui); v2
          // os tinha como filtro LOCAL por card (sem persistência, por isso
          // o fallback []). Da v3 em diante voltam a ser globais (ADR 0034).
          const old = persisted as Record<string, unknown>;
          return {
            monthValue: (old.monthValue as string) ?? getCurrentMonthValue(),
            compareValue: (old.compareValue as string) ?? COMPARE_PREV,
            brandIds: (old.brandIds as number[]) ?? [],
            storeIds: (old.storeIds as number[]) ?? [],
            departments: (old.departments as IndicatorDepartment[]) ?? [],
            filmTypeIds: (old.filmTypeIds as number[]) ?? [],
            tonalities: (old.tonalities as string[]) ?? [],
          };
        }
        return persisted as PeliculasFiltersValues;
      },
    },
  ),
);
