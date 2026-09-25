import { useQuery } from '@tanstack/react-query';

import { auditService } from '@/services/api/audit.service';
import type { AuditLogFilters } from '@/types/audit';

/**
 * Auditoria (Owner-only) — paridade com o web `useAuditLogs`.
 *
 * Trilha imutável e volátil: staleTime curto (30s) para refletir ações recentes.
 * `enabled` permite ao consumidor bloquear a query quando o usuário não é Owner.
 */
export function useAuditLogs(filters: AuditLogFilters, enabled = true) {
    return useQuery({
        queryKey: ['audit-logs', filters],
        queryFn: () => auditService.list(filters),
        staleTime: 1000 * 30,
        enabled,
    });
}
