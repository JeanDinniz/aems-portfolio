export const AUDIT_ACTIONS = [
    'login',
    'login_failed',
    'logout',
    'password_change',
    'password_change_failed',
    'password_reset',
    'create',
    'update',
    'delete',
    'activate',
    'deactivate',
    'cancel',
    'status_change',
    'verify',
    'unverify',
    'generate_os',
    'finalize_os',
    'consume',
    'exhaust',
    'release',
    'restore',
    'transfer',
    // Legacy actions from users module
    'user_created',
    'user_updated',
    'user_deleted',
    'user_activated',
    'user_deactivated',
    'role_changed',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_RESOURCE_TYPES = [
    'auth',
    'user',
    'employee',
    'consultant',
    'service_order',
    'store',
    'access_profile',
    'film_type',
    'film_roll',
    'appointment',
    'service',
    'brand',
    'vehicle_model',
    'supplier',
] as const;

export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

export interface AuditLog {
    id: number;
    action: string;
    resource_type: string;
    resource_id: number | null;
    old_value: Record<string, unknown> | null;
    new_value: Record<string, unknown> | null;
    ip_address: string | null;
    user_agent: string | null;
    created_at: string;
    user_id: number | null;
    user_name: string | null;
    /**
     * Detalhes identificadores do recurso afetado, resolvidos pelo backend.
     * Para bobinas (film_roll): { film_type_name, tonality, receipt_date, created_at }.
     * Null quando o tipo de recurso não é suportado ou o recurso não existe mais.
     */
    resource_detail?: Record<string, unknown> | null;
}

export interface AuditLogFilters {
    action?: string;
    resource_type?: string;
    resource_id?: number;
    user_id?: number;
    user_name?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    limit?: number;
}

export interface PaginatedAuditLogs {
    items: AuditLog[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        total_pages: number;
        has_next: boolean;
        has_prev: boolean;
    };
}
