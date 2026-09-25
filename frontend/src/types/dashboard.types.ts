export interface KPIComparison {
  current: number;
  previous: number;
  delta_pct: number | null;
}

export interface RevenueGoal {
  employee_count: number;
  per_employee: number[]; // [meta1, meta2, meta3] por funcionário
  targets: number[]; // [meta1, meta2, meta3] absolutas (× nº func)
  revenue: number;
  reached_tier: number; // 0..3
  next_tier: number | null; // 1..3
  next_target: number | null;
  remaining: number | null;
  progress_pct: number;
}

export interface DashboardOverview {
  revenue: KPIComparison;
  total_orders: KPIComparison;
  completed_orders: KPIComparison;
  verified_orders: KPIComparison;
  avg_ticket: KPIComparison;
  completion_rate: KPIComparison;
  pct_courtesy: KPIComparison;
  pct_galpon: KPIComparison;
  pct_return: KPIComparison;
  revenue_goal: RevenueGoal;
}

export interface StoreRankingItem {
  store_id: number;
  store_name: string;
  revenue: number;
  orders_count: number;
  avg_ticket: number;
  completion_rate: number;
  pct_return: number;
}

export interface ServiceRankingItem {
  service_id: number;
  service_name: string;
  department: string;
  count: number;
  revenue: number;
}

export interface DepartmentBreakdownItem {
  department: string;
  count: number;
  revenue: number;
  pct_revenue: number;
}

export interface EmployeeRankingItem {
  employee_id: number;
  employee_name: string;
  department: string | null;
  orders_count: number;
  services_count: number;
  hours_worked: number;
  avg_hours_per_order: number;
  revenue: number;
}

export interface SLAMetrics {
  avg_wait_minutes: number;
  avg_execution_minutes: number;
  pct_return: number;
  pct_courtesy: number;
  pct_galpon: number;
}

export interface DealershipRankingItem {
  dealership_id: number;
  dealership_name: string;
  orders_count: number;
  revenue: number;
  avg_ticket: number;
}

export interface TimeSeriesPoint {
  date: string;
  orders_count: number;
  revenue: number;
}

export interface TimeSeriesByTypePoint {
  date: string;
  film_count: number;
  ppf_count: number;
  estetica_count: number;
  film_revenue: number;
  ppf_revenue: number;
  estetica_revenue: number;
}

export interface RevenueForecast {
  month: string; // YYYY-MM
  revenue_so_far: number;
  forecast: number;
  business_days_elapsed: number;
  business_days_total: number;
}

export interface FilmPpfStoreRankingItem {
  store_id: number;
  store_name: string;
  orders_count: number;
  services_count: number;
  revenue: number;
  loja_count: number;
  galpon_count: number;
}
