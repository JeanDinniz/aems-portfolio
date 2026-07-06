import apiClient from './client';

export interface AnalyticsOverview {
    total_orders: number;
    completed_orders: number;
    pending_orders: number;
    in_progress_orders: number;
    cancelled_orders: number;
    total_revenue: number;
    average_order_value: number;
    orders_by_status: Array<{ status: string; count: number }>;
    revenue_by_month: Array<{ month: string; revenue: number }>;
    orders_by_location?: Array<{ location_name: string; count: number }>;
}

export const analyticsService = {
    getOverview: async (params?: { start_date?: string; end_date?: string }) => {
        const queryParams = new URLSearchParams();
        if (params?.start_date) queryParams.append('start_date', params.start_date);
        if (params?.end_date) queryParams.append('end_date', params.end_date);

        const response = await apiClient.get<AnalyticsOverview>(
            `/analytics/overview?${queryParams.toString()}`
        );
        return response.data;
    }
};
