import { useQuery } from '@tanstack/react-query';
import { serviceOrdersService } from '@/services/api/service-orders.service';

export interface ConferenceSummaryFilters {
    store_ids?: number[];
    date_from?: string;
    date_to?: string;
    plate?: string;
    worker_id?: number;
    include_cancelled?: boolean;
    is_courtesy?: boolean;
}

export interface ConferenceSummaryItem {
    department: string;
    total: number;
    verified: number;
    waiting: number;
    wrong: number;
    cancelled: number;
    percent_verified: number;
}

export function useConferenceSummary(filters: ConferenceSummaryFilters, enabled = true) {
    return useQuery({
        queryKey: ['service-orders', 'conference', 'summary', filters],
        queryFn: () => serviceOrdersService.getConferenceSummary(filters),
        staleTime: 30_000,
        enabled,
    });
}
