/**
 * Tipos do módulo de EPI — portados 1:1 de
 * `frontend/src/types/epi.types.ts`.
 *
 * O backend `/epi` (feature flag EPI_ENABLED) não é alterado pelo mobile.
 * A `Pagination` reusa o mesmo formato `{items, pagination}` da API.
 */

export interface EpiPagination {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
}

// ── Catálogo de EPIs ──────────────────────────────────────────────
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
    pagination: EpiPagination;
}

export interface CreateEPIPayload {
    name: string;
    dias_validade: number;
    is_active?: boolean;
}

export type UpdateEPIPayload = Partial<CreateEPIPayload>;

// ── Mapeamento cargo -> EPI ───────────────────────────────────────
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
    pagination: EpiPagination;
}

export interface CreateCargoMapPayload {
    cargo: string;
    epi_id: number;
}

// ── Pendências ────────────────────────────────────────────────────
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
