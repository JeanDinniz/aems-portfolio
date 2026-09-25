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
    clear_store?: boolean;
}
