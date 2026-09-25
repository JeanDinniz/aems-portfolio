/**
 * Types do módulo "Películas" (/analytics/indicators/...).
 * Espelham 1:1 os schemas Pydantic do backend — ver AGENTS.md/docs para o
 * contrato completo.
 */

export type IndicatorDepartment = 'film' | 'security_film' | 'ppf';

export interface KPIValue {
  current: number;
  previous: number;
  delta_pct: number | null;
}

// ─── E1: Estoque — KPIs ─────────────────────────────────────────────────────

export interface InventoryKpis {
  stock_meters: KPIValue;
  stock_value: KPIValue;
  coverage_days: KPIValue;
  consumption_meters: KPIValue;
  applications_count: KPIValue;
  entries_meters: KPIValue;
  bobinas_count: KPIValue;
}

// ─── E2: Estoque — Rentabilidade do Consumo ─────────────────────────────────

export interface ProfitabilityItem {
  film_type_id: number | null;
  type_name: string;
  tonality: string | null;
  consumption_meters: number;
  cost: number;
  revenue: number;
  margin_pct: number | null;
  revenue_per_meter: number | null;
}

export interface ProfitabilityTotal {
  consumption_meters: number;
  cost: number;
  revenue: number;
  margin_pct: number | null;
  revenue_per_meter: number | null;
}

export interface ProfitabilityResponse {
  items: ProfitabilityItem[];
  total: ProfitabilityTotal;
}

// ─── E3: Estoque — Saúde do Estoque ─────────────────────────────────────────

export type StockHealthStatus = 'em_estoque' | 'em_uso' | 'alerta' | 'esgotada';

export interface StockHealthBucket {
  status: StockHealthStatus;
  count: number;
  percentage: number;
}

export interface StockHealth {
  total_bobinas: number;
  coverage_days: number;
  breakdown: StockHealthBucket[];
}

// ─── E4: Estoque — Entradas × Consumo ───────────────────────────────────────

export interface EntriesVsConsumptionPoint {
  period: string;
  entries_meters: number;
  consumption_meters: number;
}

// ─── E5: Faturamento — KPIs ─────────────────────────────────────────────────

export interface FinancialKpis {
  revenue: KPIValue;
  margin_pct: KPIValue;
  profit: KPIValue;
  avg_ticket: KPIValue;
  revenue_per_meter: KPIValue;
  applications_count: KPIValue;
}

// ─── E6: Faturamento — Performance Comercial ────────────────────────────────

export type CommercialSortBy = 'revenue' | 'meters' | 'applications';

export interface CommercialPerformanceItem {
  store_id: number;
  store_name: string;
  types: string;
  meters: number;
  applications: number;
  revenue: number;
}

// ─── E7: Faturamento — Saúde Financeira ─────────────────────────────────────

export interface FinancialHealth {
  stock_value: number;
  cost_consumed: number;
  revenue: number;
  margin: number;
  roi: number | null;
}

// ─── E8: Faturamento — Evolução Financeira ──────────────────────────────────

export type FinancialEvolutionGranularity = 'day' | 'week' | 'month';

export interface FinancialEvolutionPoint {
  period: string;
  revenue: number;
  cost: number;
  margin_pct: number | null;
}

// ─── Parâmetros compartilhados ──────────────────────────────────────────────

export interface IndicatorsBaseParams {
  start_date: string;
  end_date: string;
  /** Filtros multi-escolha. Arrays vazios/ausentes = sem filtro (tudo). */
  store_ids?: number[];
  brand_ids?: number[];
  departments?: IndicatorDepartment[];
  film_type_ids?: number[];
  tonalities?: string[];
  /**
   * "Comparar com" — mês livre. Quando ausentes, o backend compara com o
   * período anterior de mesma duração (mês anterior). Só afetam os KPIs
   * (E1 Estoque e E5 Financeiro), que têm comparativo.
   */
  compare_start_date?: string;
  compare_end_date?: string;
}
