import { useQuery } from '@tanstack/react-query';
import auditService from '@/services/api/audit.service';
import type { AuditLogFilters } from '@/types/audit';

export function useAuditLogs(filters: AuditLogFilters = {}) {
    return useQuery({
        queryKey: ['audit-logs', filters],
        queryFn: () => auditService.list(filters),
        staleTime: 1000 * 30, // 30s
        gcTime: 1000 * 60,
    });
}
