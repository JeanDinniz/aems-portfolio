import type { Department } from './service-order.types'

export type AppointmentDisplayStatus =
  | 'atrasado'
  | 'atencao'
  | 'agendado'
  | 'em_execucao'
  | 'finalizado'
  | 'cancelado'

export interface FilmEntryItem {
  service_id: number
  tonality: string | null
  film_roll_id?: number | null
  film_type_id?: number | null
}

export interface Appointment {
  id: number
  store_id: number
  store_name: string
  department: Department
  delivery_date: string    // ISO date YYYY-MM-DD — previsão de entrega / data do serviço
  delivery_time: string | null  // HH:MM (24h) ou null para registros antigos
  external_os_number: string | null
  vehicle_plate: string
  vehicle_model: string | null
  vehicle_color: string | null
  consultant_id: number | null
  consultant_name: string | null
  service_ids: number[] | null
  service_names: string[]
  film_entries: FilmEntryItem[] | null
  notes: string | null
  is_galpon: boolean
  is_courtesy: boolean
  is_return: boolean
  film_type_id: number | null
  film_tonality: string | null
  status: 'scheduled' | 'cancelled'
  display_status: AppointmentDisplayStatus
  service_order_id: number | null
  service_order_number: string | null
  created_at: string
  updated_at: string
}

export interface AppointmentFilters {
  search?: string
  store_id?: number | null
  department?: string
  service_category?: string
  date_from?: string
  date_to?: string
  include_cancelled?: boolean
}

export interface AppointmentListResponse {
  items: Appointment[]
  pagination: { total: number; page: number; limit: number; pages: number }
}

export interface TodaySummary {
  atrasado: number
  atencao: number
  agendado: number
  em_execucao: number
  finalizado: number
  cancelado: number
}

export interface CreateAppointmentPayload {
  store_id: number
  department: string
  delivery_date: string
  delivery_time?: string   // HH:MM — obrigatório ao criar via form, mas opcional aqui por conta do Partial
  external_os_number?: string
  vehicle_plate: string
  vehicle_model?: string
  vehicle_color?: string
  consultant_id?: number
  service_ids?: number[]
  film_entries?: FilmEntryItem[]
  notes?: string
  is_galpon?: boolean
  is_courtesy?: boolean
  is_return?: boolean
  film_type_id?: number
  film_tonality?: string
}

export type UpdateAppointmentPayload = Partial<CreateAppointmentPayload>

export interface AppointmentHistoryEntry {
  id: number
  action: string
  user_id: number | null
  user_name: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  created_at: string
}

export interface AppointmentHistoryResponse {
  items: AppointmentHistoryEntry[]
}

export interface SchedulingStoreSummary {
  store_id: number
  store_name: string
  atrasado: number
  atencao: number
  agendado: number
  em_execucao: number
  finalizado: number
  cancelado: number
  total: number
}
