import apiClient from './client';

export interface Dealership {
  id: number;
  name: string;
  brand: string;
  address: string | null;
  store_id: number;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
}

interface DealershipListResponse {
  items: Dealership[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
  };
}

export const dealershipsService = {
  /** Lista todas as concessionárias (para uso em selects de filtro). */
  async list(): Promise<Dealership[]> {
    const response = await apiClient.get<DealershipListResponse>('/dealerships', {
      params: { page: 1, limit: 500, is_active: true },
    });
    return response.data.items ?? [];
  },
};
