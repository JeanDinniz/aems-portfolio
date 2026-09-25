import type { Department } from './service-order.types'

export type AppointmentDisplayStatus =
  | 'atrasado'
  | 'atencao'
  | 'agendado'
  | 'em_execucao'
  | 'duplicidade'
  | 'finalizado'
  | 'cancelado'

/**
 * Irmão de um agendamento combinado (mesmo carro, outro departamento).
 * Espelha `GroupSiblingInfo` do backend (app/modules/scheduling/schemas.py).
 */
export interface GroupSibling {
  id: number
  department: Department
  display_status: AppointmentDisplayStatus
  service_order_id: number | null
}

/**
 * Aplicação de película numa região do veículo (ex.: G05 no para-brisa).
 * Espelha `FilmApplicationItem` do backend (app/core/schemas.py). Quando um
 * `FilmEntryItem` tem `applications`, cada item é uma tonalidade numa região;
 * a `tonality` de nível entry passa a ser o legado/espelho.
 */
export interface FilmApplication {
  tonality: string
  region?: string | null
  /** Bobina vinculada (preenchida na finalização; usada só p/ exibição). */
  film_roll_id?: number | null
  film_roll_code?: string | null
}

export interface FilmEntryItem {
  service_id: number
  tonality: string | null
  film_roll_id?: number | null
  film_type_id?: number | null
  /** Tonalidades por região do veículo (opcional). */
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
  film_type_id: number | null
  film_tonality: string | null
  status: 'scheduled' | 'cancelled'
  display_status: AppointmentDisplayStatus
  service_order_id: number | null
  service_order_number: string | null
  /** Agendamento combinado: id do grupo (mesmo carro, N departamentos). */
  appointment_group_id?: string | null
  /** Agendamentos irmãos do mesmo grupo combinado (exclui o próprio). */
  group_siblings?: GroupSibling[] | null
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
  // M1 (auditoria): traz também os FINALIZADOS do backend (que os oculta por
  // padrão). Sem isso a busca não encontra carro finalizado — paridade com o web.
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
  film_type_id?: number
  film_tonality?: string
}

export type UpdateAppointmentPayload = Partial<CreateAppointmentPayload>

/**
 * Serviços de um departamento dentro de um agendamento combinado.
 * Espelha `CombinedDepartmentEntry` do backend.
 */
export interface CombinedDepartmentEntry {
  department: string
  service_ids?: number[]
  film_entries?: FilmEntryItem[]
  film_type_id?: number
}

/**
 * Payload do agendamento combinado: um carro, N departamentos → N agendamentos
 * vinculados por `appointment_group_id`. Espelha `CombinedAppointmentCreate`.
 */
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
  departments: CombinedDepartmentEntry[]
}

/** Agendamentos criados pelo fluxo combinado (1 por departamento). */
export interface CombinedAppointmentResponse {
  items: Appointment[]
}

/**
 * Adiciona departamentos-irmãos a um agendamento existente (combinar na edição).
 * Espelha `AddDepartmentsRequest` do backend.
 */
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

export interface SchedulingStoreSummary {
  store_id: number
  store_name: string
  atrasado: number
  atencao: number
  agendado: number
  em_execucao: number
  duplicidade: number
  finalizado: number
  cancelado: number
  total: number
}
