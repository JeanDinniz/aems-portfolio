export interface Dealership {
    id: number;
    name: string;
    brand: string;
    store_id: number;
    store_name?: string;
    is_active: boolean;
    created_at: string;
    updated_at?: string;
}

export interface DealershipFilters {
    store_id?: number;
    is_active?: boolean;
}
