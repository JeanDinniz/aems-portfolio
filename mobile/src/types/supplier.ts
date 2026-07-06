export interface Supplier {
    id: number;
    company_name: string;
    cnpj: string | null;
    responsible: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string | null;
}

export interface SupplierCreate {
    company_name: string;
    cnpj?: string | null;
    responsible?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
}

export interface SupplierUpdate extends Partial<SupplierCreate> {
    is_active?: boolean;
}

export interface SupplierFilters {
    search?: string;
    is_active?: boolean;
    page?: number;
    limit?: number;
}

export interface SuppliersListResponse {
    items: Supplier[];
    total: number;
    page: number;
    limit: number;
}
