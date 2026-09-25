// ── Biblioteca de Documentos (HML-237) ───────────────────────────────────────

export type LibraryCategory = 'operacional' | 'apresentacoes'

export interface LibraryDocument {
    id: number
    category: LibraryCategory
    title: string
    description: string | null
    file_url: string
    file_name: string
    file_type: string | null
    file_size: number | null
    uploaded_by_id: number | null
    uploaded_by_name: string | null
    display_order: number
    is_active: boolean
    created_at: string
    updated_at: string | null
}

export interface LibraryDocumentListResponse {
    items: LibraryDocument[]
    pagination: {
        page: number
        limit: number
        total: number
        total_pages: number
        has_next: boolean
        has_prev: boolean
    }
}

export interface LibraryDocumentCreatePayload {
    category: LibraryCategory
    title: string
    description?: string | null
    file_url: string
    file_name: string
    file_type?: string | null
    file_size?: number | null
    display_order?: number
}

export interface LibraryDocumentUpdatePayload {
    category?: LibraryCategory
    title?: string
    description?: string | null
    file_url?: string
    file_name?: string
    file_type?: string | null
    file_size?: number | null
    display_order?: number
    is_active?: boolean
}

export interface LibraryDocumentFilters {
    page?: number
    limit?: number
    category?: LibraryCategory
    is_active?: boolean
    search?: string
}

// ── Certificados de Garantia (HML-236) ───────────────────────────────────────

export interface Certificate {
    id: number
    created_at: string
    created_by_id: number | null
    created_by_name: string | null
    brand_code: string
    brand_name: string | null
    store_id: number | null
    store_name: string | null
    store_address: string | null
    plate: string | null
    customer_name: string | null
    model: string | null
    color: string | null
    invoice_number: string | null
    chassi: string | null
    service_name: string
    warranty_months: number
    issue_date: string
    // Campos adicionados (HML-236)
    service_order_id: number | null
    os_number: string | null
    signed_photo_url: string | null
    valid_until: string
    warranty_status: 'vigente' | 'vencida'
}

export interface CertificateCreatePayload {
    brand_code: string
    brand_name?: string
    store_id?: number
    service_order_id?: number | null
    os_number?: string | null
    plate?: string
    customer_name?: string
    model?: string
    color?: string
    invoice_number?: string
    chassi?: string
    service_name?: string
    warranty_months?: number
    issue_date?: string
    signed_photo_url?: string | null
}

export interface CertificateUpdatePayload {
    brand_code?: string
    brand_name?: string
    store_id?: number | null
    service_order_id?: number | null
    os_number?: string | null
    plate?: string | null
    customer_name?: string | null
    model?: string | null
    color?: string | null
    invoice_number?: string | null
    chassi?: string | null
    service_name?: string
    warranty_months?: number
    issue_date?: string
    signed_photo_url?: string | null
}

export interface CertificateListResponse {
    items: Certificate[]
    pagination: {
        page: number
        limit: number
        total: number
        total_pages: number
        has_next: boolean
        has_prev: boolean
    }
}

export interface CertificateFilters {
    page?: number
    limit?: number
    store_id?: number
    brand_code?: string
    search?: string
}
