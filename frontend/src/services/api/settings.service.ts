import apiClient from './client';

export interface RevenueGoalConfig {
  tier_1: number;
  tier_2: number;
  tier_3: number;
}

export const settingsService = {
  getRevenueGoals: (): Promise<RevenueGoalConfig> =>
    apiClient.get<RevenueGoalConfig>('/settings/revenue-goals').then((r) => r.data),

  updateRevenueGoals: (data: RevenueGoalConfig): Promise<RevenueGoalConfig> =>
    apiClient.put<RevenueGoalConfig>('/settings/revenue-goals', data).then((r) => r.data),
};

export default settingsService;
