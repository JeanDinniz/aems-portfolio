import { apiClient } from './client';
import type { AuditLogFilters, PaginatedAuditLogs } from '@/types/audit';

/**
 * Auditoria (Owner-only) — portado de frontend/src/services/api/audit.service.ts.
 *
 * READ-ONLY: o backend `/audit-logs` só oferece leitura (trilha imutável). O
 * `cleanFilters` remove chaves vazias antes de enviar como query params.
 */
function cleanFilters(filters: AuditLogFilters): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== undefined && v !== '' && v !== null)
    );
}

export const auditService = {
    list: async (filters: AuditLogFilters = {}): Promise<PaginatedAuditLogs> =>
        apiClient.get('/audit-logs', { params: cleanFilters(filters) }).then((r) => r.data),
};

export default auditService;
