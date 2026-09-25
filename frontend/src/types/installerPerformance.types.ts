// ─── Daily report ─────────────────────────────────────────────────────────────

export interface DailyVehicleRow {
    os_id: number;
    order_number: string | null;
    external_os_number: string | null;
    plate: string;
    vehicle: string | null;
    store_name: string | null;
    services: string[];
    is_courtesy: boolean;
    is_return: boolean;
    /** Algum serviço feito por mais de um instalador (produção dividida) */
    has_shared: boolean;
    value: number;
}

export interface DailyInstallerGroup {
    employee_id: number;
    employee_name: string;
    vehicles: DailyVehicleRow[];
    total_cars: number;
    total_revenue: number;
}

export interface DailyReportResponse {
    report_date: string;
    store_name: string | null;
    groups: DailyInstallerGroup[];
    grand_total_cars: number;
    grand_total_revenue: number;
}

// ─── Individual report ────────────────────────────────────────────────────────

export interface IndividualServiceRow {
    completion_date: string;
    os_id: number;
    order_number: string | null;
    external_os_number: string | null;
    plate: string;
    vehicle: string | null;
    store_name: string | null;
    services: string[];
    is_courtesy: boolean;
    is_return: boolean;
    /** Algum serviço feito por mais de um instalador (produção dividida) */
    has_shared: boolean;
    value: number;
    points: number;
}

export interface IndividualReportResponse {
    employee_id: number;
    employee_name: string;
    period_start: string;
    period_end: string;
    store_name: string | null;
    total_cars: number;
    /** Fracionado: serviço compartilhado entre K instaladores conta 1/K */
    total_services: number;
    total_revenue: number;
    total_points: number;
    rows: IndividualServiceRow[];
}

// ─── Filter types ─────────────────────────────────────────────────────────────

export interface DailyFilters {
    date: string;
    store_id?: number;
    employee_ids?: number[];
}

export interface IndividualFilters {
    start: string;
    end: string;
    employee_id: number;
    store_id?: number;
}

// ─── Summary report ───────────────────────────────────────────────────────────

export interface SummaryRankingRow {
    employee_id: number;
    employee_name: string;
    orders_count: number;
    services_count: number;
    cars_count: number;
    points: number;
    revenue: number;
}

export interface SummaryTotals {
    total_cars: number;
    total_services: number;
    total_points: number;
    total_revenue: number;
    film_cost: number;
}

export interface SummaryReportResponse {
    period_start: string;
    period_end: string;
    store_name: string | null;
    totals: SummaryTotals;
    rows: SummaryRankingRow[];
}

export interface SummaryFilters {
    start: string;
    end: string;
    store_id?: number | null;
}

// ─── Returns report ───────────────────────────────────────────────────────────

export interface ReturnRow {
    return_os_id: number;
    return_date: string;
    return_workers: string[];
    return_notes: string | null;
    return_services: string[];
    origin_os_id: number | null;
    origin_date: string | null;
    origin_workers: string[];
    origin_notes: string | null;
    origin_services: string[];
    model: string | null;
    chassis: string | null;
    color: string | null;
}

export interface ReturnsReportResponse {
    period_start: string;
    period_end: string;
    store_name: string | null;
    rows: ReturnRow[];
}

export interface ReturnsFilters {
    start: string;
    end: string;
    store_id?: number | null;
}
