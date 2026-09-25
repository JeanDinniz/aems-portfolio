/** Portado 1:1 de frontend/src/types/holiday.types.ts. */
export interface Holiday {
    id: number;
    date: string; // YYYY-MM-DD
    name: string;
    store_id: number | null;
    store_name: string | null;
    created_at: string;
    updated_at: string | null;
}

export interface HolidayListResponse {
    items: Holiday[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        total_pages: number;
        has_next: boolean;
        has_prev: boolean;
    };
}

export interface CreateHolidayPayload {
    date: string; // YYYY-MM-DD
    name: string;
    store_id: number | null;
}

export interface UpdateHolidayPayload {
    date?: string;
    name?: string;
    store_id?: number | null;
    /**
     * Ao mudar de uma loja específica para "todas", o backend exige `clear_store`
     * junto de `store_id: null` (senão o campo é ignorado como "não alterado").
     */
    clear_store?: boolean;
}
