import { apiClient } from './client';
import type {
    CreateMovementPayload,
    DayStatusResponse,
    Employee,
    EmployeeFilters,
    EmployeeMovement,
    EmployeesListResponse,
    EmployeeStats,
    MovementListResponse,
} from '@/types/employee.types';

/**
 * Portado de frontend/src/services/api/employees.service.ts.
 * Apenas os métodos de leitura usados pelos pickers de O.S.
 */
export const employeesService = {
    async list(
        filters?: EmployeeFilters,
        page = 1,
        pageSize = 20
    ): Promise<EmployeesListResponse> {
        const params = new URLSearchParams();
        if (filters?.store_id) params.append('store_id', filters.store_id.toString());
        if (filters?.is_active !== undefined)
            params.append('is_active', filters.is_active.toString());
        if (filters?.hr_status) params.append('hr_status', filters.hr_status);
        if (filters?.search) params.append('search', filters.search);
        if (filters?.department) params.append('department', filters.department);
        if (filters?.position) params.append('position', filters.position);
        if (filters?.is_volante !== undefined)
            params.append('is_volante', filters.is_volante.toString());
        if (filters?.for_galpon !== undefined)
            params.append('for_galpon', filters.for_galpon.toString());
        params.append('page', page.toString());
        params.append('limit', pageSize.toString());

        const response = await apiClient.get<{
            items: Employee[];
            pagination: { total: number };
        }>(`/employees?${params.toString()}`);
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

    async listForGalpon(): Promise<Employee[]> {
        const response = await apiClient.get<{ items: Employee[]; pagination: { total: number } }>(
            `/employees?for_galpon=true&is_active=true&limit=200`
        );
        return response.data.items;
    },

    /** Ficha de um funcionário (Admin — Fatia 5a). */
    async getById(id: number): Promise<Employee> {
        const response = await apiClient.get<Employee>(`/employees/${id}`);
        return response.data;
    },

    /**
     * Indicadores de RH (Total/Ativos/Afastados/Demitidos/Férias). Respeita a
     * loja selecionada globalmente quando `storeId` é informado.
     */
    async getStats(storeId?: number): Promise<EmployeeStats> {
        const params = storeId ? { store_id: storeId } : {};
        const response = await apiClient.get<EmployeeStats>('/employees/stats', { params });
        return response.data;
    },

    /** Histórico de movimentações de um funcionário (paginado). */
    async listMovements(id: number, page = 1, limit = 20): Promise<MovementListResponse> {
        const response = await apiClient.get<MovementListResponse>(
            `/employees/${id}/movements`,
            { params: { page, limit } }
        );
        return response.data;
    },

    /**
     * Status do dia por loja (Faltas do Dia). Retorna a lista de funcionários
     * com o status calculado (presente/falta/férias/afastado) + contadores.
     */
    async dayStatus(storeId: number, date: string): Promise<DayStatusResponse> {
        const response = await apiClient.get<DayStatusResponse>('/employees/day-status', {
            params: { store_id: storeId, date },
        });
        return response.data;
    },

    /** Registra uma movimentação (ex.: falta) — usado para marcar falta no dia. */
    async createMovement(
        employeeId: number,
        payload: CreateMovementPayload
    ): Promise<EmployeeMovement> {
        const response = await apiClient.post<EmployeeMovement>(
            `/employees/${employeeId}/movements`,
            payload
        );
        return response.data;
    },

    /** Remove uma movimentação (desfaz a falta). */
    async deleteMovement(employeeId: number, movementId: number): Promise<void> {
        await apiClient.delete(`/employees/${employeeId}/movements/${movementId}`);
    },

    /** Registra o retorno de afastamento (RH volta a Ativo). */
    async returnFromAbsence(employeeId: number): Promise<void> {
        await apiClient.post(`/employees/${employeeId}/return-from-absence`);
    },
};
