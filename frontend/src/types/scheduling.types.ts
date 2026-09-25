import type { Department } from './service-order.types'

export interface GroupSibling {
  id: number
  department: Department
  display_status: AppointmentDisplayStatus
  service_order_id: number | null
}

export type AppointmentDisplayStatus =
  | 'atrasado'
  | 'atencao'
  | 'agendado'
  | 'em_execucao'
  | 'duplicidade'
  | 'finalizado'
  | 'cancelado'

export interface FilmApplication {
  /** Tonalidade da aplicação (ex.: G20) */
  tonality: string
  /** Região do carro (ex.: Portas dianteiras) — texto livre curto */
  region?: string | null
  /** Código visual da bobina desta tonalidade (após o Finalizar) */
  film_roll_code?: string | null
}

export interface FilmEntryItem {
  service_id: number
  service_name?: string | null
  service_code?: string | null
  tonality: string | null
  film_roll_id?: number | null
  film_type_id?: number | null
  /** Código visual da bobina utilizada (vem da O.S. gerada, após o Finalizar) */
  film_roll_code?: string | null
  /**
   * Tonalidades por região no mesmo serviço (ex.: G20 frente / G05 trás).
   * Quando presente, `tonality` é só um resumo de exibição ("G20/G05").
   */
  applications?: FilmApplication[] | null
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
  original_service_order_id: number | null
  film_type_id: number | null
  film_tonality: string | null
  status: 'scheduled' | 'cancelled'
  display_status: AppointmentDisplayStatus
  is_overdue?: boolean
  service_order_id: number | null
  service_order_number: string | null
  service_order_notes: string | null
  completion_photos: string[] | null
  appointment_group_id: string | null
  group_siblings: GroupSibling[] | null
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
  include_terminal?: boolean
}

export interface AppointmentListResponse {
  items: Appointment[]
  pagination: {
    page: number
    limit: number
    total: number
    total_pages: number
    has_next: boolean
    has_prev: boolean
  }
}

export interface TodaySummary {
  atrasado: number
  atencao: number
  agendado: number
  em_execucao: number
  duplicidade: number
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
  original_service_order_id?: number
  film_type_id?: number
  film_tonality?: string
}

export type UpdateAppointmentPayload = Partial<CreateAppointmentPayload>

export interface CombinedDepartmentEntry {
  department: string
  service_ids?: number[]
  film_entries?: FilmEntryItem[]
  film_type_id?: number
}

export interface CombinedAppointmentPayload {
  store_id: number
  delivery_date: string
  delivery_time?: string
  external_os_number?: string
  vehicle_plate: string
  vehicle_model?: string
  vehicle_color?: string
  consultant_id?: number
  notes?: string
  is_galpon?: boolean
  is_courtesy?: boolean
  is_return?: boolean
  original_service_order_id?: number
  departments: CombinedDepartmentEntry[]
}

export interface CombinedAppointmentResponse {
  items: Appointment[]
}

export interface AddDepartmentsPayload {
  departments: CombinedDepartmentEntry[]
}

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

export interface CarrosResumoItem {
  store_id: number
  store_name: string
  count: number
}

export interface CarrosResumoResponse {
  items: CarrosResumoItem[]
  total: number
}

