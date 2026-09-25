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

    // Exporta a trilha de auditoria em CSV aplicando os mesmos filtros da
    // listagem. Ignora page/limit (o export usa o teto do backend).
    exportCsv: async (filters: AuditLogFilters = {}): Promise<Blob> => {
        const { page: _page, limit: _limit, ...rest } = filters;
        void _page;
        void _limit;
        const response = await apiClient.get('/audit-logs/export', {
            params: cleanFilters(rest),
            responseType: 'blob',
        });
        return response.data;
    },
};

export default auditService;
