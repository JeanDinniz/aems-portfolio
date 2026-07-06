import apiClient from './client'
import type {
  Appointment,
  AppointmentFilters,
  AppointmentHistoryResponse,
  AppointmentListResponse,
  TodaySummary,
  SchedulingStoreSummary,
  CreateAppointmentPayload,
  UpdateAppointmentPayload,
} from '@/types/scheduling.types'

export const schedulingService = {
  async list(
    filters: AppointmentFilters = {},
    page = 1,
    limit = 50
  ): Promise<AppointmentListResponse> {
    const params: Record<string, unknown> = { page, limit }
    if (filters.store_id) params.store_id = filters.store_id
    if (filters.department) params.department = filters.department
    if (filters.service_category) params.category = filters.service_category
    if (filters.date_from) params.date_from = filters.date_from
    if (filters.date_to) params.date_to = filters.date_to
    if (filters.search) params.search = filters.search
    if (filters.include_cancelled) params.include_cancelled = true
    if (filters.include_terminal) params.include_terminal = true
    const { data } = await apiClient.get('/scheduling', { params })
    return data
  },

  async getById(id: number): Promise<Appointment> {
    const { data } = await apiClient.get(`/scheduling/${id}`)
    return data
  },

  async getTodaySummary(storeId?: number | null): Promise<TodaySummary> {
    const params = storeId ? { store_id: storeId } : {}
    const { data } = await apiClient.get('/scheduling/summary/today', { params })
    return data
  },

  async getCapacity(storeId: number, deliveryDate: string): Promise<number> {
    const { data } = await apiClient.get('/scheduling/capacity', {
      params: { store_id: storeId, delivery_date: deliveryDate },
    })
    return data.count
  },

  async create(payload: CreateAppointmentPayload): Promise<Appointment> {
    const { data } = await apiClient.post('/scheduling', payload)
    return data
  },

  async update(id: number, payload: UpdateAppointmentPayload): Promise<Appointment> {
    const { data } = await apiClient.patch(`/scheduling/${id}`, payload)
    return data
  },

  async cancel(id: number, reason?: string): Promise<Appointment> {
    const { data } = await apiClient.delete(`/scheduling/${id}`, {
      data: { cancellation_reason: reason ?? null },
    })
    return data
  },

  async getHistory(id: number): Promise<AppointmentHistoryResponse> {
    const { data } = await apiClient.get(`/scheduling/${id}/history`)
    return data
  },

  async generateOS(
    id: number,
    payload: {
      photos: string[]
      notes?: string
    }
  ): Promise<{ service_order_id: number; order_number: string }> {
    const { data } = await apiClient.post(`/scheduling/${id}/generate-os`, payload)
    return data
  },

  async getStoreSummary(filters: {
    date_from?: string
    date_to?: string
    department?: string
  } = {}): Promise<SchedulingStoreSummary[]> {
    const params: Record<string, unknown> = {}
    if (filters.date_from) params.date_from = filters.date_from
    if (filters.date_to) params.date_to = filters.date_to
    if (filters.department) params.department = filters.department
    const { data } = await apiClient.get('/scheduling/summary/stores', { params })
    return data
  },
}
