import { useEffect, useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { ChevronDown, ChevronUp, FileDown, Loader2, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { useStores } from '@/hooks/useStores';
import { useBrands } from '@/hooks/useBrands';
import { inventoryService } from '@/services/api/inventory.service';
import {
  COMPARE_PREV,
  usePeliculasFiltersStore,
  type PeliculasFiltersValues,
} from '@/stores/peliculasFilters.store';
import type { IndicatorDepartment } from '@/types/indicators.types';
import {
  countActivePeliculasFilters,
  mergeChangedScopeAndProductFields,
  pruneInvalidSelections,
  type PeliculasScopeAndProductValues,
} from '@/utils/peliculasFilters';

interface MonthOption {
  value: string;
  label: string;
}

interface PeliculasFiltersBarProps {
  monthOptions: MonthOption[];
  onExportPdf: () => void;
  isExportingPdf: boolean;
}

interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

const DEPARTMENT_OPTIONS: { value: IndicatorDepartment; label: string }[] = [
  { value: 'film', label: 'Película' },
  { value: 'security_film', label: 'Segurança' },
  { value: 'ppf', label: 'PPF' },
];

const LABEL_CLASS = 'text-[10px] font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide';

function draftFromApplied(applied: PeliculasFiltersValues): PeliculasScopeAndProductValues {
  return {
    brandIds: applied.brandIds,
    storeIds: applied.storeIds,
    departments: applied.departments,
    filmTypeIds: applied.filmTypeIds,
    tonalities: applied.tonalities,
  };
}

/**
 * Barra de filtros da tela Películas — dona do rascunho de Escopo/Produto
 * (Marca/Loja/Departamento/Tipo/Tonalidade). Isso mantém a seleção isolada
 * aqui dentro: os 8 cards da página (que leem os filtros APLICADOS no store)
 * não re-renderizam a cada clique no painel.
 *
 * Período e "Comparar com" (Nível 1) NÃO fazem parte do rascunho — aplicam na
 * hora, para nunca ficarem fora de sincronia com a tela/PDF (ver ADR 0034 /
 * code review). Nível 2 (recolhível): grupos "Escopo" e "Produto", com
 * "Limpar"/"Aplicar". Abaixo, chips dos filtros APLICADOS com remoção
 * individual (aplica na hora).
 *
 * A poda de seleções inválidas (Loja fora da Marca, Tipo fora do
 * Departamento, id inativo/inexistente) usa um único helper puro
 * (`pruneInvalidSelections`) nos três lugares onde isso importa: × do chip,
 * "Aplicar" e o efeito que poda o rascunho enquanto o painel está aberto.
 */
export function PeliculasFiltersBar({
  monthOptions,
  onExportPdf,
  isExportingPdf,
}: PeliculasFiltersBarProps) {
  const applied = usePeliculasFiltersStore(
    useShallow((s) => ({
      monthValue: s.monthValue,
      compareValue: s.compareValue,
      brandIds: s.brandIds,
      storeIds: s.storeIds,
      departments: s.departments,
      filmTypeIds: s.filmTypeIds,
      tonalities: s.tonalities,
    }))
  );
  const apply = usePeliculasFiltersStore((s) => s.apply);

  const { stores } = useStores();
  const { brands } = useBrands();

  const { data: filmTypesData } = useQuery({
    queryKey: ['film-types', 'indicators'],
    queryFn: () => inventoryService.listFilmTypes({ limit: 200 }),
    staleTime: 1000 * 60 * 10,
  });
  const filmTypesItems = useMemo(() => filmTypesData?.items ?? [], [filmTypesData]);

  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [pending, setPending] = useState<PeliculasScopeAndProductValues>(() => draftFromApplied(applied));
  const filtersPanelId = useId();

  // Autocura: se marca/departamento passam a excluir uma seleção já aplicada
  // (ex.: bobina/tipo inativado, ou a própria cascata) — poda o que está
  // APLICADO (não só o rascunho) assim que as listas de referência carregam
  // ou mudam. Único caminho de poda (mesmo helper do × do chip/Aplicar).
  useEffect(() => {
    const next = pruneInvalidSelections(applied, stores, filmTypesItems);
    if (next === applied) return;
    apply(next);
    setPending((p) => mergeChangedScopeAndProductFields(p, applied, next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, stores, filmTypesItems]);

  // Poda o RASCUNHO enquanto o painel está aberto (ex.: usuário troca a Marca
  // pendente e a Loja pendente de outra marca deixa de fazer sentido).
  useEffect(() => {
    setPending((p) => pruneInvalidSelections(p, stores, filmTypesItems));
  }, [stores, filmTypesItems, pending.brandIds, pending.departments]);

  // ── Cascata: Loja restrita às marcas pendentes ──────────────────────────
  const storeOptions = useMemo(() => {
    const filtered = pending.brandIds.length
      ? stores.filter((s) => s.brand_id !== undefined && pending.brandIds.includes(s.brand_id))
      : stores;
    return filtered.map((s) => ({ value: s.id, label: s.name }));
  }, [stores, pending.brandIds]);

  // ── Cascata: Tipo restrito aos departamentos pendentes ──────────────────
  const filmTypeOptions = useMemo(() => {
    const filtered = pending.departments.length
      ? filmTypesItems.filter((ft) => pending.departments.includes(ft.department as IndicatorDepartment))
      : filmTypesItems;
    return filtered.map((ft) => ({ id: ft.id, name: ft.name }));
  }, [filmTypesItems, pending.departments]);

  const tonalityOptions = useMemo(() => {
    const set = new Set<string>();
    filmTypesItems.forEach((ft) => ft.available_tonalities.forEach((t) => set.add(t)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [filmTypesItems]);

  // ── Período / Comparar com — aplicam NA HORA (fora do rascunho) ─────────
  const handleMonthChange = (v: string) => {
    // Regra: "Comparar com" não pode apontar pro mesmo mês selecionado.
    const nextCompare = applied.compareValue === v ? COMPARE_PREV : applied.compareValue;
    apply({ ...applied, monthValue: v, compareValue: nextCompare });
  };

  const handleCompareChange = (v: string) => {
    apply({ ...applied, compareValue: v });
  };

  // ── Painel Nível 2 ───────────────────────────────────────────────────────
  const toggleFiltersPanel = () => {
    if (isFiltersOpen) {
      // Fechando sem aplicar: descarta o rascunho, volta ao que está aplicado.
      setPending(draftFromApplied(applied));
    }
    setIsFiltersOpen((o) => !o);
  };

  const handleApply = () => {
    const next = pruneInvalidSelections({ ...applied, ...pending }, stores, filmTypesItems);
    apply(next);
    setPending(draftFromApplied(next));
    setIsFiltersOpen(false);
  };

  const handleClear = () => {
    setPending({ brandIds: [], storeIds: [], departments: [], filmTypeIds: [], tonalities: [] });
  };

  const activeCount = countActivePeliculasFilters(applied);

  // ── Chips dos filtros APLICADOS — remover um aplica na hora ─────────────
  const removeAppliedValue = (patch: Partial<PeliculasScopeAndProductValues>) => {
    const merged = { ...applied, ...patch };
    const next = pruneInvalidSelections(merged, stores, filmTypesItems);
    apply(next);
    setPending((p) => mergeChangedScopeAndProductFields(p, applied, next));
  };

  const chips: FilterChip[] = [];

  applied.brandIds.forEach((id) => {
    const label = brands.find((b) => b.id === id)?.name ?? `#${id}`;
    chips.push({
      key: `brand-${id}`,
      label: `Marca: ${label}`,
      onRemove: () => removeAppliedValue({ brandIds: applied.brandIds.filter((v) => v !== id) }),
    });
  });

  applied.storeIds.forEach((id) => {
    const label = stores.find((s) => s.id === id)?.name ?? `#${id}`;
    chips.push({
      key: `store-${id}`,
      label: `Loja: ${label}`,
      onRemove: () => removeAppliedValue({ storeIds: applied.storeIds.filter((v) => v !== id) }),
    });
  });

  applied.departments.forEach((d) => {
    const label = DEPARTMENT_OPTIONS.find((o) => o.value === d)?.label ?? d;
    chips.push({
      key: `dept-${d}`,
      label: `Departamento: ${label}`,
      onRemove: () =>
        removeAppliedValue({ departments: applied.departments.filter((v) => v !== d) }),
    });
  });

  applied.filmTypeIds.forEach((id) => {
    const label = filmTypesItems.find((ft) => ft.id === id)?.name ?? `#${id}`;
    chips.push({
      key: `type-${id}`,
      label: `Tipo: ${label}`,
      onRemove: () =>
        removeAppliedValue({ filmTypeIds: applied.filmTypeIds.filter((v) => v !== id) }),
    });
  });

  applied.tonalities.forEach((t) => {
    chips.push({
      key: `tonality-${t}`,
      label: `Tonalidade: ${t}`,
      onRemove: () =>
        removeAppliedValue({ tonalities: applied.tonalities.filter((v) => v !== t) }),
    });
  });

  return (
    <div className="flex flex-col gap-2 w-full lg:w-auto">
      {/* ── Nível 1 — sempre visível ─────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Período</span>
          <Select value={applied.monthValue} onValueChange={handleMonthChange}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Comparar com</span>
          <Select value={applied.compareValue} onValueChange={handleCompareChange}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={COMPARE_PREV} className="text-xs">
                Mês anterior
              </SelectItem>
              {monthOptions
                .filter((opt) => opt.value !== applied.monthValue)
                .map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={toggleFiltersPanel}
          aria-expanded={isFiltersOpen}
          aria-controls={filtersPanelId}
          className="h-8 text-xs gap-1.5"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filtros
          {activeCount > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#F5A800] px-1 text-[10px] font-semibold text-black">
              {activeCount}
            </span>
          )}
          {isFiltersOpen ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </Button>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onExportPdf}
          disabled={isExportingPdf}
          className="h-8 text-xs gap-1.5"
        >
          {isExportingPdf ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Gerando PDF…
            </>
          ) : (
            <>
              <FileDown className="h-3.5 w-3.5" />
              Exportar PDF
            </>
          )}
        </Button>
      </div>

      {/* ── Nível 2 — recolhível (Escopo | Produto) ─────────────────────── */}
      {isFiltersOpen && (
        <div
          id={filtersPanelId}
          className="w-full rounded-lg border border-gray-200 dark:border-[#2a2a2a] bg-white dark:bg-[#161616] p-3"
        >
          <div className="flex flex-wrap gap-6">
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Escopo
              </span>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <span className={LABEL_CLASS}>Marca</span>
                  <MultiSelect<number>
                    ariaLabel="Marca"
                    options={brands.map((b) => ({ value: b.id, label: b.name }))}
                    selected={pending.brandIds}
                    onChange={(brandIds) => setPending((f) => ({ ...f, brandIds }))}
                    placeholder="Todas"
                    countLabel="marcas"
                    className="w-44"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <span className={LABEL_CLASS}>Loja</span>
                  <MultiSelect<number>
                    ariaLabel="Loja"
                    options={storeOptions}
                    selected={pending.storeIds}
                    onChange={(storeIds) => setPending((f) => ({ ...f, storeIds }))}
                    placeholder="Todas as lojas"
                    countLabel="lojas"
                    className="w-44"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <span className={LABEL_CLASS}>Departamento</span>
                  <MultiSelect<IndicatorDepartment>
                    ariaLabel="Departamento"
                    options={DEPARTMENT_OPTIONS}
                    selected={pending.departments}
                    onChange={(departments) => setPending((f) => ({ ...f, departments }))}
                    placeholder="Todos"
                    countLabel="deptos."
                    className="w-36"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Produto
              </span>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <span className={LABEL_CLASS}>Tipo</span>
                  <MultiSelect<number>
                    ariaLabel="Tipo"
                    options={filmTypeOptions.map((ft) => ({ value: ft.id, label: ft.name }))}
                    selected={pending.filmTypeIds}
                    onChange={(filmTypeIds) => setPending((f) => ({ ...f, filmTypeIds }))}
                    placeholder="Todos os tipos"
                    countLabel="tipos"
                    className="w-36"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <span className={LABEL_CLASS}>Tonalidade</span>
                  <MultiSelect<string>
                    ariaLabel="Tonalidade"
                    options={tonalityOptions.map((t) => ({ value: t, label: t }))}
                    selected={pending.tonalities}
                    onChange={(tonalities) => setPending((f) => ({ ...f, tonalities }))}
                    placeholder="Todas"
                    countLabel="tonalidades"
                    className="w-32"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-[#1E1E1E]">
            <Button type="button" size="sm" variant="ghost" onClick={handleClear} className="h-8 text-xs">
              Limpar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleApply}
              className="h-8 text-xs bg-[#F5A800] hover:bg-[#d48f00] text-black font-semibold"
            >
              Aplicar
            </Button>
          </div>
        </div>
      )}

      {/* ── Chips dos filtros aplicados ──────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.length === 0 ? (
          <span className="text-xs text-gray-400 dark:text-gray-500">Nenhum filtro aplicado</span>
        ) : (
          chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-[#2a2a2a] bg-gray-50 dark:bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-gray-700 dark:text-gray-300"
            >
              {chip.label}
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={`Remover filtro ${chip.label}`}
                className="ml-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
