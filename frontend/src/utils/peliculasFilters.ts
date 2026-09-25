import type { IndicatorDepartment } from '@/types/indicators.types';

/**
 * Helpers puros da barra de filtros de Películas
 * (`components/features/indicators/PeliculasFiltersBar.tsx`).
 *
 * Ficam aqui (fora do componente) por causa do lint
 * `react-refresh/only-export-components`: um arquivo de componente só pode
 * exportar componentes.
 */

/** Os 5 campos de filtro "Escopo" (Marca/Loja/Departamento) + "Produto"
 * (Tipo/Tonalidade) — Período/Comparar com ficam de fora (aplicam na hora,
 * não fazem parte do rascunho nem da poda por cascata). */
export interface PeliculasScopeAndProductValues {
  brandIds: number[];
  storeIds: number[];
  departments: IndicatorDepartment[];
  filmTypeIds: number[];
  tonalities: string[];
}

const SCOPE_AND_PRODUCT_KEYS = [
  'brandIds',
  'storeIds',
  'departments',
  'filmTypeIds',
  'tonalities',
] as const;

/** Total de filtros de Escopo (Marca/Loja/Departamento) + Produto (Tipo/Tonalidade) ativos. */
export function countActivePeliculasFilters(f: PeliculasScopeAndProductValues): number {
  return (
    f.brandIds.length +
    f.storeIds.length +
    f.departments.length +
    f.filmTypeIds.length +
    f.tonalities.length
  );
}

interface PrunableStore {
  id: number;
  brand_id?: number;
}

interface PrunableFilmType {
  id: number;
  department: IndicatorDepartment | string;
}

/**
 * Remove seleções de Loja/Tipo que não são mais válidas — Loja fora das
 * marcas selecionadas, Tipo fora dos departamentos selecionados, ou (sem
 * filtro de marca/departamento) um id que simplesmente não existe mais no
 * catálogo carregado (ex.: bobina/tipo inativado). Só poda quando a lista de
 * referência (`stores`/`filmTypes`) já carregou — uma lista vazia por ainda
 * não ter chegado do servidor NUNCA deve zerar uma seleção persistida.
 *
 * Único caminho de poda da tela: usado no × do chip, no "Aplicar" e no efeito
 * que poda o rascunho enquanto o painel está aberto — assim os três lugares
 * nunca divergem sobre o que é "válido".
 */
export function pruneInvalidSelections<T extends PeliculasScopeAndProductValues>(
  values: T,
  stores: PrunableStore[],
  filmTypes: PrunableFilmType[]
): T {
  let storeIds = values.storeIds;
  if (stores.length > 0) {
    const eligible = values.brandIds.length
      ? stores.filter((s) => s.brand_id !== undefined && values.brandIds.includes(s.brand_id))
      : stores;
    const validIds = new Set(eligible.map((s) => s.id));
    const next = values.storeIds.filter((id) => validIds.has(id));
    if (next.length !== values.storeIds.length) storeIds = next;
  }

  let filmTypeIds = values.filmTypeIds;
  if (filmTypes.length > 0) {
    const eligible = values.departments.length
      ? filmTypes.filter((ft) => values.departments.includes(ft.department as IndicatorDepartment))
      : filmTypes;
    const validIds = new Set(eligible.map((ft) => ft.id));
    const next = values.filmTypeIds.filter((id) => validIds.has(id));
    if (next.length !== values.filmTypeIds.length) filmTypeIds = next;
  }

  if (storeIds === values.storeIds && filmTypeIds === values.filmTypeIds) return values;
  return { ...values, storeIds, filmTypeIds };
}

/** Quais dos 5 campos de Escopo/Produto mudaram entre dois estados. */
export function diffScopeAndProductKeys(
  a: PeliculasScopeAndProductValues,
  b: PeliculasScopeAndProductValues
): (keyof PeliculasScopeAndProductValues)[] {
  return SCOPE_AND_PRODUCT_KEYS.filter((key) => {
    const av = a[key];
    const bv = b[key];
    return av.length !== bv.length || av.some((v, i) => v !== bv[i]);
  });
}

/**
 * Aplica em `draft` (ex.: o rascunho pendente) só os campos que de fato
 * mudaram de `current` para `next` — preserva qualquer edição independente
 * que o usuário tenha em andamento nos outros campos do rascunho.
 */
export function mergeChangedScopeAndProductFields<T extends PeliculasScopeAndProductValues>(
  draft: T,
  current: PeliculasScopeAndProductValues,
  next: PeliculasScopeAndProductValues
): T {
  const changedKeys = diffScopeAndProductKeys(current, next);
  if (changedKeys.length === 0) return draft;

  let result = draft;
  for (const key of changedKeys) {
    switch (key) {
      case 'brandIds':
        result = { ...result, brandIds: next.brandIds };
        break;
      case 'storeIds':
        result = { ...result, storeIds: next.storeIds };
        break;
      case 'departments':
        result = { ...result, departments: next.departments };
        break;
      case 'filmTypeIds':
        result = { ...result, filmTypeIds: next.filmTypeIds };
        break;
      case 'tonalities':
        result = { ...result, tonalities: next.tonalities };
        break;
    }
  }
  return result;
}
