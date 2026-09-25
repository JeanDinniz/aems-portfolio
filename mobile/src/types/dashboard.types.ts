export interface KPIComparison {
  current: number;
  previous: number;
  delta_pct: number | null;
}

export interface DashboardOverview {
  revenue: KPIComparison;
  total_orders: KPIComparison;
  completed_orders: KPIComparison;
  avg_ticket: KPIComparison;
  completion_rate: KPIComparison;
  pct_courtesy: KPIComparison;
  pct_galpon: KPIComparison;
  pct_return: KPIComparison;
}

export interface StoreRankingItem {
  store_id: number;
  store_name: string;
  revenue: number;
  orders_count: number;
  avg_ticket: number;
  completion_rate: number;
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
  hours_worked: number;
  avg_hours_per_order: number;
}

export interface SLAMetrics {
  avg_wait_minutes: number;
  avg_execution_minutes: number;
  pct_return: number;
  pct_courtesy: number;
  pct_galpon: number;
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
}

export interface FilmPpfStoreRankingItem {
  store_id: number;
  store_name: string;
  orders_count: number;
  revenue: number;
  loja_count: number;
  galpon_count: number;
}
