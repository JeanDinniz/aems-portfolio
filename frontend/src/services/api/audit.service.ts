import apiClient from './client';
import type { AuditLogFilters, PaginatedAuditLogs } from '@/types/audit';

function cleanFilters(filters: AuditLogFilters): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== undefined && v !== '' && v !== null)
    );
}

const auditService = {
    list: async (filters: AuditLogFilters = {}): Promise<PaginatedAuditLogs> =>
        apiClient.get('/audit-logs', { params: cleanFilters(filters) }).then((r) => r.data),
};

export default auditService;
