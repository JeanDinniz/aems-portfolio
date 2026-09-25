export interface Employee {
    id: number;
    name: string;
    last_name?: string | null;
    birth_date?: string | null;
    store_id: number;
    position?: string | null;
    department?: string | null;
    store_name?: string | null;
    is_active: boolean;
    hr_status?: 'active' | 'away' | 'dismissed' | null;
    is_volante: boolean;
    works_in_galpon: boolean;
    entry_date?: string | null;
    phone?: string | null;
    email?: string | null;
    /** CPF do funcionário — necessário para os arquivos fiscais do ponto (AFD/AEJ). */
    cpf?: string | null;
    pix_key?: string | null;
    bank_account?: string | null;
    address?: string | null;
    transport_allowance?: string | null;
    dismissal_date?: string | null;
    dismissal_reason?: string | null;
    would_rehire?: boolean | null;
    vacation_month?: number | null;
    created_at: string;
    updated_at?: string | null;
    user_id?: number | null;
    user_name?: string | null;
    work_start_time?: string | null;
    work_end_time?: string | null;
}

export interface CreateEmployeePayload {
    name: string;
    store_id: number;
    position?: string;
    department?: string;
    is_volante?: boolean;
    works_in_galpon?: boolean;
    entry_date?: string | null;
    phone?: string | null;
    email?: string | null;
    /** CPF do funcionário — necessário para os arquivos fiscais do ponto (AFD/AEJ). */
    cpf?: string | null;
    address?: string | null;
    pix_key?: string | null;
    bank_account?: string | null;
    transport_allowance?: string | null;
    vacation_month?: number | null;
    user_id?: number | null;
}

export interface UpdateEmployeePayload {
    name?: string;
    last_name?: string | null;
    position?: string | null;
    department?: string | null;
    is_active?: boolean;
    hr_status?: 'active' | 'away' | 'dismissed';
    store_id?: number;
    is_volante?: boolean;
    works_in_galpon?: boolean;
    birth_date?: string | null;
    entry_date?: string | null;
    phone?: string | null;
    email?: string | null;
    /** CPF do funcionário — necessário para os arquivos fiscais do ponto (AFD/AEJ). */
    cpf?: string | null;
    pix_key?: string | null;
    bank_account?: string | null;
    address?: string | null;
    transport_allowance?: string | null;
    dismissal_date?: string | null;
    dismissal_reason?: string | null;
    would_rehire?: boolean | null;
    vacation_month?: number | null;
    user_id?: number | null;
    clear_user?: boolean;
    work_start_time?: string | null;
    work_end_time?: string | null;
}

export interface EmployeeFilters {
    store_id?: number;
    is_active?: boolean;
    hr_status?: 'active' | 'away' | 'dismissed';
    search?: string;
    department?: string;
    position?: string;
    is_volante?: boolean;
    for_galpon?: boolean;
    has_user?: boolean;
}

export interface EmployeesListResponse {
    employees: Employee[];
    total: number;
    page: number;
    pageSize: number;
}

export type MovementType = 'transfer' | 'vacation' | 'absence' | 'fault' | 'promotion' | 'dismissal';

export interface EmployeeMovement {
    id: number;
    employee_id: number;
    employee_name: string;
    type: MovementType;
    movement_date: string;
    movement_data: Record<string, unknown> | null;
    attachment_url?: string | null;
    notes?: string | null;
    created_by_id?: number | null;
    created_by_name?: string | null;
    created_at: string;
}

export interface MovementListResponse {
    items: EmployeeMovement[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        total_pages: number;
        has_next: boolean;
        has_prev: boolean;
    };
}

export interface EmployeeStats {
    total: number;
    active: number;
    away: number;
    dismissed: number;
    vacations_planned: number;
}

export interface VacationMovement {
    id: number;
    employee_id: number;
    employee_name: string;
    employee_last_name?: string | null;
    employee_position?: string | null;
    employee_store_id?: number | null;
    employee_store_name?: string | null;
    movement_date: string;
    movement_data: {
        start_date?: string;
        return_date?: string;
        forecast_date?: string;
    } | null;
}

export interface UpdateEmployeeHrPayload extends UpdateEmployeePayload {
    hr_status?: 'active' | 'away' | 'dismissed';
    last_name?: string | null;
    birth_date?: string | null;
}

export type DayStatus = 'presente' | 'falta' | 'ferias' | 'afastado';

export interface EmployeeDayStatusItem {
    employee_id: number;
    name: string;
    position: string | null;
    status: DayStatus;
    reason: string | null;
    fault_movement_id: number | null;
    attachment_url: string | null;
    needs_return: boolean;
}

export interface DayStatusResponse {
    items: EmployeeDayStatusItem[];
    present: number;
    faults: number;
    vacations: number;
    absences: number;
}
