import { apiClient } from './client';

/**
 * Portado de frontend/src/services/api/suppliersService.ts (subset usado no
 * mobile). Só LEITURA: a entrada de bobina (INV-04) precisa listar fornecedores
 * para o `supplier_id`. Cadastro/edição de fornecedor não é exposto no app.
 */

export interface Supplier {
    id: number;
    company_name: string;
    cnpj: string | null;
    responsible: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    is_active: boolean;
}

export interface SuppliersListResponse {
    items: Supplier[];
    total: number;
}

export const suppliersService = {
    list: async (params?: { search?: string; is_active?: boolean }): Promise<SuppliersListResponse> => {
        const queryParams: Record<string, string | number | boolean> = {
            page: 1,
            limit: 200,
        };
        if (params?.search) queryParams.search = params.search;
        if (params?.is_active !== undefined) queryParams.is_active = params.is_active;
        const response = await apiClient.get('/suppliers', { params: queryParams });
        return {
            items: response.data.items ?? [],
            total: response.data.total ?? response.data.pagination?.total ?? 0,
        };
    },

    getById: async (id: number): Promise<Supplier> =>
        apiClient.get(`/suppliers/${id}`).then((r) => r.data),

    /** Soft delete (DELETE /suppliers/{id}) → is_active=false (Owner only). */
    deactivate: async (id: number): Promise<Supplier> =>
        apiClient.delete(`/suppliers/${id}`).then((r) => r.data),

    /** Reativa via PATCH /suppliers/{id} { is_active: true }. */
    activate: async (id: number): Promise<Supplier> =>
        apiClient.patch(`/suppliers/${id}`, { is_active: true }).then((r) => r.data),
};
