export interface Pagination {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
}

export interface EPI {
    id: number;
    name: string;
    dias_validade: number;
    is_active: boolean;
    created_at: string;
    updated_at: string | null;
}

export interface EPIListResponse {
    items: EPI[];
    pagination: Pagination;
}

export interface CreateEPIPayload {
    name: string;
    dias_validade: number;
    is_active?: boolean;
}

export type UpdateEPIPayload = Partial<CreateEPIPayload>;

export interface CargoEPI {
    id: number;
    cargo: string;
    epi_id: number;
    epi_name: string;
    is_active: boolean;
    created_at: string;
    updated_at: string | null;
}

export interface CargoEPIListResponse {
    items: CargoEPI[];
    pagination: Pagination;
}

export interface CreateCargoMapPayload {
    cargo: string;
    epi_id: number;
}

export interface EntregaEPIListItem {
    id: number;
    employee_id: number;
    employee_name: string;
    epi_id: number;
    epi_name: string;
    data_entrega: string;
    data_vencimento: string;
    status: string;
    delivered_by_id: number | null;
    observacao: string | null;
    created_at: string;
}

export interface EntregaEPIListResponse {
    items: EntregaEPIListItem[];
    pagination: Pagination;
}

export interface EntregaEPI extends EntregaEPIListItem {
    assinatura_base64: string;
}

export interface CreateDeliveryPayload {
    employee_id: number;
    epi_id: number;
    assinatura_base64: string;
    data_entrega?: string;
    observacao?: string | null;
}

export type PendenciaEstado = 'PENDENTE' | 'VENCIDO' | 'EM_DIA';

export interface PendenciaItem {
    employee_id: number;
    employee_name: string;
    store_id: number;
    store_name: string | null;
    cargo: string;
    epi_id: number;
    epi_name: string;
    dias_validade: number;
    estado: PendenciaEstado;
    ultima_entrega_id: number | null;
    data_entrega: string | null;
    data_vencimento: string | null;
    dias_restantes: number | null;
}

export interface PendenciasResponse {
    items: PendenciaItem[];
    total: number;
}
