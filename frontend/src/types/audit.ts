export const AUDIT_ACTIONS = [
    'login',
    'logout',
    'password_reset',
    'create',
    'update',
    'delete',
    'activate',
    'deactivate',
    'status_change',
    'verify',
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
