import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import settingsService, { type RevenueGoalConfig } from '@/services/api/settings.service';

export function useRevenueGoals(enabled = true) {
  return useQuery({
    queryKey: ['settings', 'revenue-goals'],
    queryFn: settingsService.getRevenueGoals,
    staleTime: 1000 * 60 * 5,
    enabled,
  });
}

export function useUpdateRevenueGoals() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: RevenueGoalConfig) => settingsService.updateRevenueGoals(data),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'revenue-goals'], data);
      // Metas alimentam o card do Dashboard — recarrega o overview
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'overview'] });
    },
  });
}
