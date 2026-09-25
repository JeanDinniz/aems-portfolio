import apiClient from './client';
import type {
  CommercialPerformanceItem,
  CommercialSortBy,
  EntriesVsConsumptionPoint,
  FinancialEvolutionGranularity,
  FinancialEvolutionPoint,
  FinancialHealth,
  FinancialKpis,
  IndicatorsBaseParams,
  InventoryKpis,
  ProfitabilityResponse,
  StockHealth,
} from '@/types/indicators.types';

// Arrays de filtro (store_ids/brand_ids/departments) precisam virar
// `?store_ids=1&store_ids=2` (chave repetida SEM colchetes) — que é como o
// FastAPI lê `list[int] = Query(...)`. O default do axios (`store_ids[]=1`)
// não é parseado pelo FastAPI. `indexes: null` produz o formato repetido.
const REPEAT_ARRAY = { indexes: null } as const;

/** Extrai o filename de um header `Content-Disposition: attachment; filename="...".` */
function parseFilename(disposition: string, fallback: string): string {
  const match = disposition.match(/filename="?([^";\s]+)"?/);
  return match?.[1] ?? fallback;
}

export const indicatorsService = {
  // ── Estoque ────────────────────────────────────────────────────────────
  getInventoryKpis: (params: IndicatorsBaseParams) =>
    apiClient
      .get<InventoryKpis>('/analytics/indicators/inventory/kpis', {
        params,
        paramsSerializer: REPEAT_ARRAY,
      })
      .then((r) => r.data),

  getInventoryProfitability: (params: IndicatorsBaseParams) =>
    apiClient
      .get<ProfitabilityResponse>('/analytics/indicators/inventory/profitability', {
        params,
        paramsSerializer: REPEAT_ARRAY,
      })
      .then((r) => r.data),

  getInventoryHealth: (params: IndicatorsBaseParams) =>
    apiClient
      .get<StockHealth>('/analytics/indicators/inventory/health', {
        params,
        paramsSerializer: REPEAT_ARRAY,
      })
      .then((r) => r.data),

  getEntriesVsConsumption: (
    params: IndicatorsBaseParams & { granularity?: 'month' | 'week' }
  ) =>
    apiClient
      .get<EntriesVsConsumptionPoint[]>('/analytics/indicators/inventory/entries-vs-consumption', {
        params,
        paramsSerializer: REPEAT_ARRAY,
      })
      .then((r) => r.data),

  // ── Faturamento ────────────────────────────────────────────────────────
  getFinancialKpis: (params: IndicatorsBaseParams) =>
    apiClient
      .get<FinancialKpis>('/analytics/indicators/financial/kpis', {
        params,
        paramsSerializer: REPEAT_ARRAY,
      })
      .then((r) => r.data),

  getCommercialPerformance: (
    params: IndicatorsBaseParams & { sort_by?: CommercialSortBy }
  ) =>
    apiClient
      .get<CommercialPerformanceItem[]>('/analytics/indicators/financial/commercial-performance', {
        params,
        paramsSerializer: REPEAT_ARRAY,
      })
      .then((r) => r.data),

  getFinancialHealth: (params: IndicatorsBaseParams) =>
    apiClient
      .get<FinancialHealth>('/analytics/indicators/financial/health', {
        params,
        paramsSerializer: REPEAT_ARRAY,
      })
      .then((r) => r.data),

  getFinancialEvolution: (
    params: IndicatorsBaseParams & { granularity?: FinancialEvolutionGranularity }
  ) =>
    apiClient
      .get<FinancialEvolutionPoint[]>('/analytics/indicators/financial/evolution', {
        params,
        paramsSerializer: REPEAT_ARRAY,
      })
      .then((r) => r.data),

  // ── Exportação ────────────────────────────────────────────────────────
  /**
   * PDF estruturado da tela Películas — mesmo recorte aplicado na tela.
   * `fallbackFilename` só é usado se o backend não mandar Content-Disposition.
   */
  exportPdf: async (
    params: IndicatorsBaseParams & {
      commercial_sort_by?: CommercialSortBy;
      evolution_granularity?: FinancialEvolutionGranularity;
    },
    fallbackFilename: string
  ): Promise<{ blob: Blob; filename: string }> => {
    const response = await apiClient.get<Blob>('/analytics/indicators/export/pdf', {
      params,
      paramsSerializer: REPEAT_ARRAY,
      responseType: 'blob',
    });
    return {
      blob: response.data,
      filename: parseFilename(response.headers['content-disposition'] ?? '', fallbackFilename),
    };
  },
};
