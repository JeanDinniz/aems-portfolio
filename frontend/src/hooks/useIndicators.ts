import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { indicatorsService } from '@/services/api/indicators.service';
import type {
  CommercialSortBy,
  FinancialEvolutionGranularity,
  IndicatorsBaseParams,
} from '@/types/indicators.types';

const STALE_TIME = 60_000;

// `placeholderData: keepPreviousData` evita o "flash" de skeleton ao reaplicar
// filtros: mantém os dados antigos na tela (com opacidade reduzida, ver
// `isFetching && isPlaceholderData` em PeliculasPage) enquanto a nova busca
// não volta. O skeleton só aparece no `isLoading` inicial (sem dado nenhum).

function isEnabled(params: IndicatorsBaseParams) {
  return !!params.start_date && !!params.end_date;
}

// ── Estoque ────────────────────────────────────────────────────────────────

export function useInventoryKpis(params: IndicatorsBaseParams) {
  return useQuery({
    queryKey: ['indicators', 'inventory-kpis', params],
    queryFn: () => indicatorsService.getInventoryKpis(params),
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    enabled: isEnabled(params),
  });
}

export function useInventoryProfitability(params: IndicatorsBaseParams) {
  return useQuery({
    queryKey: ['indicators', 'inventory-profitability', params],
    queryFn: () => indicatorsService.getInventoryProfitability(params),
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    enabled: isEnabled(params),
  });
}

export function useInventoryHealth(params: IndicatorsBaseParams) {
  return useQuery({
    queryKey: ['indicators', 'inventory-health', params],
    queryFn: () => indicatorsService.getInventoryHealth(params),
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    enabled: isEnabled(params),
  });
}

export function useEntriesVsConsumption(
  params: IndicatorsBaseParams & { granularity?: 'month' | 'week' }
) {
  return useQuery({
    queryKey: ['indicators', 'entries-vs-consumption', params],
    queryFn: () => indicatorsService.getEntriesVsConsumption(params),
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    enabled: isEnabled(params),
  });
}

// ── Faturamento ────────────────────────────────────────────────────────────

export function useFinancialKpis(params: IndicatorsBaseParams) {
  return useQuery({
    queryKey: ['indicators', 'financial-kpis', params],
    queryFn: () => indicatorsService.getFinancialKpis(params),
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    enabled: isEnabled(params),
  });
}

export function useCommercialPerformance(
  params: IndicatorsBaseParams & { sort_by?: CommercialSortBy }
) {
  return useQuery({
    queryKey: ['indicators', 'commercial-performance', params],
    queryFn: () => indicatorsService.getCommercialPerformance(params),
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    enabled: isEnabled(params),
  });
}

export function useFinancialHealth(params: IndicatorsBaseParams) {
  return useQuery({
    queryKey: ['indicators', 'financial-health', params],
    queryFn: () => indicatorsService.getFinancialHealth(params),
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    enabled: isEnabled(params),
  });
}

export function useFinancialEvolution(
  params: IndicatorsBaseParams & { granularity?: FinancialEvolutionGranularity }
) {
  return useQuery({
    queryKey: ['indicators', 'financial-evolution', params],
    queryFn: () => indicatorsService.getFinancialEvolution(params),
    staleTime: STALE_TIME,
    placeholderData: keepPreviousData,
    enabled: isEnabled(params),
  });
}
