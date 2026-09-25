import apiClient from './client';
import type {
    Employee,
    CreateEmployeePayload,
    UpdateEmployeePayload,
    EmployeeFilters,
    EmployeesListResponse,
    EmployeeStats,
    VacationMovement,
    EmployeeMovement,
    MovementListResponse,
    DayStatusResponse,
} from '@/types/employee.types';

export const employeesService = {
    async list(filters?: EmployeeFilters, page = 1, pageSize = 20): Promise<EmployeesListResponse> {
        const params = new URLSearchParams();
        if (filters?.store_id) params.append('store_id', filters.store_id.toString());
        if (filters?.is_active !== undefined) params.append('is_active', filters.is_active.toString());
        if (filters?.search) params.append('search', filters.search);
        if (filters?.department) params.append('department', filters.department);
        if (filters?.position) params.append('position', filters.position);
        if (filters?.is_volante !== undefined) params.append('is_volante', filters.is_volante.toString());
        if (filters?.for_galpon !== undefined) params.append('for_galpon', filters.for_galpon.toString());
        if (filters?.hr_status) params.append('hr_status', filters.hr_status);
        if (filters?.has_user !== undefined) params.append('has_user', filters.has_user.toString());
        params.append('page', page.toString());
        params.append('limit', pageSize.toString());

        const response = await apiClient.get<{ items: Employee[]; pagination: { total: number } }>(
            `/employees?${params.toString()}`
        );
        return {
            employees: response.data.items,
            total: response.data.pagination.total,
            page,
            pageSize,
        };
    },

    async listByStore(storeId: number): Promise<Employee[]> {
        const response = await apiClient.get<{ items: Employee[]; pagination: { total: number } }>(
            `/employees?store_id=${storeId}&is_active=true&limit=200`
        );
        return response.data.items;
    },

    async listByStoreAndDepartment(storeId: number, department?: string): Promise<Employee[]> {
        const params = new URLSearchParams();
        params.append('store_id', storeId.toString());
        params.append('is_active', 'true');
        params.append('limit', '200');
        if (department) params.append('department', department);
        const response = await apiClient.get<{ items: Employee[]; pagination: { total: number } }>(
            `/employees?${params.toString()}`
        );
        return response.data.items;
    },

    async listByDepartmentAllStores(department: string): Promise<Employee[]> {
        const response = await apiClient.get<{ items: Employee[]; pagination: { total: number } }>(
            `/employees?department=${department}&is_active=true&limit=500`
        );
        return response.data.items;
    },

    async create(payload: CreateEmployeePayload): Promise<Employee> {
        const response = await apiClient.post<Employee>('/employees', payload);
        return response.data;
    },

    async update(id: number, payload: UpdateEmployeePayload): Promise<Employee> {
        const response = await apiClient.patch<Employee>(`/employees/${id}`, payload);
        return response.data;
    },

    async delete(id: number): Promise<void> {
        await apiClient.delete(`/employees/${id}`);
    },

    async deactivate(id: number): Promise<Employee> {
        const response = await apiClient.patch<Employee>(`/employees/${id}`, { is_active: false });
        return response.data;
    },

    async activate(id: number): Promise<Employee> {
        const response = await apiClient.patch<Employee>(`/employees/${id}`, { is_active: true });
        return response.data;
    },

    async listForGalpon(): Promise<Employee[]> {
        const response = await apiClient.get<{ items: Employee[]; pagination: { total: number } }>(
            `/employees?for_galpon=true&is_active=true&limit=200`
        );
        return response.data.items;
    },

    async getStats(storeId?: number): Promise<EmployeeStats> {
        const params = storeId ? { store_id: storeId } : {};
        const response = await apiClient.get<EmployeeStats>('/employees/stats', { params });
        return response.data;
    },

    async listVacations(params?: { store_id?: number; search?: string; position?: string }): Promise<VacationMovement[]> {
        const response = await apiClient.get<VacationMovement[]>('/employees/vacations', { params });
        return response.data;
    },

    async listMovements(employeeId: number, page = 1, limit = 20): Promise<MovementListResponse> {
        const response = await apiClient.get<MovementListResponse>(
            `/employees/${employeeId}/movements`,
            { params: { page, limit } }
        );
        return response.data;
    },

    async createMovement(employeeId: number, data: {
        type: string;
        movement_date: string;
        movement_data?: Record<string, unknown>;
        attachment_url?: string | null;
        notes?: string | null;
    }): Promise<EmployeeMovement> {
        const response = await apiClient.post<EmployeeMovement>(
            `/employees/${employeeId}/movements`,
            data
        );
        return response.data;
    },

    async getMovement(employeeId: number, movementId: number): Promise<EmployeeMovement> {
        const response = await apiClient.get<EmployeeMovement>(
            `/employees/${employeeId}/movements/${movementId}`
        );
        return response.data;
    },

    async deleteMovement(employeeId: number, movementId: number): Promise<void> {
        await apiClient.delete(`/employees/${employeeId}/movements/${movementId}`);
    },

    async dayStatus(storeId: number, date: string): Promise<DayStatusResponse> {
        const response = await apiClient.get<DayStatusResponse>('/employees/day-status', {
            params: { store_id: storeId, date },
        });
        return response.data;
    },

    async returnFromAbsence(employeeId: number): Promise<void> {
        await apiClient.post(`/employees/${employeeId}/return-from-absence`);
    },

    async frequencyReport(employeeId: number, date: string): Promise<Blob> {
        const response = await apiClient.get<Blob>(
            `/employees/${employeeId}/frequency-report`,
            { params: { date }, responseType: 'blob' }
        );
        return response.data;
    },
};
