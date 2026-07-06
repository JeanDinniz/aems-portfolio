export interface Consultant {
    id: number;
    name: string;
    store_id: number;
    store_name?: string;
    dealership_id: number;
    dealership_name?: string;
    phone?: string | null;
    email?: string | null;
    is_active: boolean;
    created_at: string;
    updated_at?: string;
    // Dados de pagamento
    pix_key?: string | null;
    bank_name?: string | null;
    bank_agency?: string | null;
    bank_account?: string | null;
    bank_account_type?: 'corrente' | 'poupanca' | null;
}

export interface CreateConsultantPayload {
    name: string;
    store_id: number;
    dealership_id?: number;
    phone?: string;
    email?: string;
    pix_key?: string;
    bank_name?: string;
    bank_agency?: string;
    bank_account?: string;
    bank_account_type?: 'corrente' | 'poupanca';
}

export interface UpdateConsultantPayload {
    name?: string;
    store_id?: number;
    phone?: string;
    email?: string;
    is_active?: boolean;
    pix_key?: string | null;
    bank_name?: string | null;
    bank_agency?: string | null;
    bank_account?: string | null;
    bank_account_type?: 'corrente' | 'poupanca' | null;
}

export interface ConsultantFilters {
    store_id?: number;
    dealership_id?: number;
    is_active?: boolean;
    search?: string;
}

export interface ConsultantsListResponse {
    consultants: Consultant[];
    total: number;
    page: number;
    pageSize: number;
}
