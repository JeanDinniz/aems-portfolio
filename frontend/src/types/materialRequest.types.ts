export interface MaterialRequestFilmItem {
    film_roll_id: number;
    film_type_id: number;
    film_type_name: string;
    tonality: string | null;
    total_meters: number;
    remaining_meters: number;
    supplier: string | null;
    supplier_id: number | null;
    nfe_number: string | null;
    cost: string | null;
    lot_number: string | null;
    receipt_date: string | null;
    status: string;
}

export interface MaterialRequestToolItem {
    id: number;
    name: string;
    quantity: number;
    notes: string | null;
    employee_id: number | null;
    employee_name: string | null;
    cost: string | null;
    nfe_number: string | null;
}

export interface MaterialPurchaseLineItem {
    id: number;
    kind: 'film' | 'tool';
    material_name: string;
    tonality: string | null;
    quantity: string | null;
    supplier: string | null;
    nfe_number: string | null;
    cost: string | null;
    lot_number: string | null;
    notes: string | null;
}

export interface MaterialRequest {
    id: number;
    store_id: number;
    store_name: string | null;
    request_date: string;
    notes: string | null;
    is_galpon: boolean;
    source: string;
    created_by_user_id: number | null;
    created_by_name: string | null;
    film_items: MaterialRequestFilmItem[];
    tool_items: MaterialRequestToolItem[];
    purchase_lines: MaterialPurchaseLineItem[];
    created_at: string;
    updated_at: string | null;
    // Cancelamento
    status: 'active' | 'cancelled';
    cancelled_at: string | null;
    cancellation_reason: string | null;
    // Edição pós-lançamento (rastro para o selo "EDITADO" + Auditoria)
    edited_at: string | null;
    edited_by_user_id: number | null;
    edited_by_name: string | null;
}

export interface MaterialRequestListResponse {
    items: MaterialRequest[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        total_pages: number;
        has_next: boolean;
        has_prev: boolean;
    };
}

// ─── Create payloads ─────────────────────────────────────────────────────────

export interface MaterialRequestFilmLineCreate {
    film_type_id: number;
    tonality?: string | null;
    total_meters: number;
    supplier?: string | null;
    nfe_number?: string | null;
    cost?: number | string | null;
    lot_number?: string | null;
    supplier_id?: number | null;
    receipt_date?: string | null;
}

export interface MaterialRequestToolLineCreate {
    name: string;
    quantity: number;
    notes?: string | null;
    employee_id?: number | null;
    cost?: number | string | null;
    nfe_number?: string | null;
}

export interface MaterialRequestCreate {
    store_id: number;
    request_date: string; // YYYY-MM-DD
    notes?: string | null;
    is_galpon?: boolean;
    film_lines: MaterialRequestFilmLineCreate[];
    tool_lines: MaterialRequestToolLineCreate[];
}

// Linha de película numa edição: com film_roll_id edita a bobina existente,
// sem id cria uma nova. Bobinas ausentes do payload são removidas do pedido.
export interface MaterialRequestFilmLineUpdate extends MaterialRequestFilmLineCreate {
    film_roll_id?: number | null;
}

export interface MaterialRequestUpdate {
    request_date?: string;
    notes?: string | null;
    is_galpon?: boolean;
    film_lines?: MaterialRequestFilmLineUpdate[];
    tool_lines?: MaterialRequestToolLineCreate[];
}

export interface MaterialRequestListParams {
    store_id?: number | null;
    date_from?: string;
    date_to?: string;
    page?: number;
    limit?: number;
}

// ─── Rendimento das bobinas (carros por bobina) ──────────────────────────────

export interface RollYieldEntry {
    roll_id: number;
    receipt_date: string;
    total_meters: number;
    remaining_meters: number;
    status: string; // em_estoque | em_uso | esgotada
    cars: number;
    last_consumption_at: string | null;
}

export interface RollYieldGroup {
    store_id: number;
    store_name: string | null;
    film_type_id: number;
    film_type_name: string;
    tonality: string | null;
    rolls: RollYieldEntry[];
    roll_count: number;
    total_cars: number;
    avg_cars: number;
    avg_cars_per_meter: number;
}

export interface RollYieldResponse {
    items: RollYieldGroup[];
}

export interface RollYieldParams {
    store_id?: number | null;
    film_type_id?: number | null;
    per_material?: number;
}

// ─── Cards de recebimento de ferramentas (Controle de EPIs) ──────────────────

export interface ToolCardItem {
    id: number;
    name: string;
    quantity: number;
    notes: string | null;
    photo_url: string | null;
}

export interface ToolCard {
    request_id: number;
    request_date: string;
    store_id: number;
    store_name: string | null;
    employee_id: number;
    employee_name: string | null;
    items: ToolCardItem[];
    status: 'pendente' | 'recebido';
    received_at: string | null;
    signature_base64: string | null;
}

export interface ToolCardListResponse {
    items: ToolCard[];
}

export interface ToolCardParams {
    status?: 'pendente' | 'recebido';
    store_id?: number | null;
    employee_id?: number | null;
}

export interface ToolReceiptItemPhoto {
    item_id: number;
    photo_url: string;
}

export interface ToolReceiptConfirmPayload {
    request_id: number;
    employee_id: number;
    signature_base64: string;
    notes?: string | null;
    item_photos: ToolReceiptItemPhoto[];
}

// ─── Drill-down: carros por bobina ───────────────────────────────────────────

export interface RollServiceOrderRow {
    service_order_id: number;
    vehicle_plate: string;
    service_date: string | null;
    service_code: string | null;
    service_name: string | null;
    installers: string[];
    meters_consumed: number | null;
}

export interface RollServiceOrdersResponse {
    film_roll_id: number;
    film_type_name: string;
    tonality: string | null;
    receipt_date: string;
    rows: RollServiceOrderRow[];
}
