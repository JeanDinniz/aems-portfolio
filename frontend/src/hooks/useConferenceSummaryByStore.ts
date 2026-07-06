import { useQuery } from '@tanstack/react-query';
import { serviceOrdersService } from '@/services/api/service-orders.service';
import type { ConferenceSummaryFilters } from './useConferenceSummary';

export interface ConferenceSummaryByStoreItem {
    store_id: number;
    store_name: string;
    total: number;
    verified: number;
    waiting: number;
    wrong: number;
    cancelled: number;
    percent_verified: number;
}

export function useConferenceSummaryByStore(filters: ConferenceSummaryFilters, enabled = true) {
    return useQuery({
        queryKey: ['service-orders', 'conference', 'summary', 'by-store', filters],
        queryFn: () => serviceOrdersService.getConferenceSummaryByStore(filters),
        staleTime: 30_000,
        enabled,
    });
}
