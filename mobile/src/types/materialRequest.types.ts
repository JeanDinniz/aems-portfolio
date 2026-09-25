/**
 * Tipos do módulo "Pedidos de Material" (rota web /pedidos → mobile /pedidos).
 *
 * Portado 1:1 de frontend/src/types/materialRequest.types.ts. Modelo de negócio:
 * pedido por loja/data (sem status); películas viram bobinas (FilmRoll) no
 * Estoque; ferramentas/insumos são texto livre (MaterialRequestTool). Linhas de
 * compra histórica (planilha) vêm em `purchase_lines` (somente leitura).
 *
 * No mobile expomos a parte usada pelo app: lista, detalhe, criação, edição (só
 * data/obs/galpão/ferramentas), exclusão, export Excel e os "cards de recebimento
 * de ferramentas" (tool-cards) — estes aparecem no Controle de EPIs (aba
 * Recebimentos). A entidade de "rendimento das bobinas" fica de fora.
 */

export interface MaterialRequestFilmItem {
    film_roll_id: number;
    film_type_id: number;
    film_type_name: string;
    tonality: string | null;
    total_meters: number;
    remaining_meters: number;
    supplier: string | null;
    nfe_number: string | null;
    cost: string | null;
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

// ─── Payloads de criação ──────────────────────────────────────────────────────

export interface MaterialRequestFilmLineCreate {
    film_type_id: number;
    tonality?: string | null;
    total_meters: number;
    nfe_number?: string | null;
    cost?: number | string | null;
    lot_number?: string | null;
    supplier_id?: number | null;
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

/** Película NÃO é editável no update (ajustar bobinas pela tela de Estoque). */
export interface MaterialRequestUpdate {
    request_date?: string;
    notes?: string | null;
    is_galpon?: boolean;
    tool_lines?: MaterialRequestToolLineCreate[];
}

export interface MaterialRequestListParams {
    store_id?: number | null;
    date_from?: string;
    date_to?: string;
    page?: number;
    limit?: number;
}

// ─── Cards de recebimento de ferramentas (Controle de EPIs) ─────────────────────
// Um card é DERIVADO no backend: cada (pedido × funcionário) entre as ferramentas
// com funcionário vinculado. Pendente até o funcionário confirmar o recebimento
// assinando; recebido depois.

export interface ToolCardItem {
    id: number;
    name: string;
    quantity: number;
    notes: string | null;
    /** Foto do item registrada no recebimento (URL do upload). Null enquanto pendente. */
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
    /** Assinatura (Data URL PNG) coletada no recebimento. Null enquanto pendente. */
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

export interface ToolReceiptConfirmPayload {
    request_id: number;
    employee_id: number;
    signature_base64: string;
    /** Exatamente 1 foto por item do card (item_id ↔ URL do upload). */
    item_photos: { item_id: number; photo_url: string }[];
    notes?: string | null;
}
