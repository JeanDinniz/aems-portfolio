import { useQuery } from '@tanstack/react-query';
import { analyticsService } from '@/services/api/analytics.service';

export const useAnalytics = (startDate?: string, endDate?: string) => {
    return useQuery({
        queryKey: ['analytics', 'overview', startDate, endDate],
        queryFn: () => analyticsService.getOverview({ start_date: startDate, end_date: endDate }),
        staleTime: 1000 * 60 * 2 // 2 minutos
    });
};
