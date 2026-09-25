export type PunchType = 'in' | 'out'

/** Fonte do registro: batida do funcionário ou ajuste administrativo */
export type TimeClockSource = 'employee' | 'admin_adjustment'

export interface TimeClockRecord {
    id: number
    employee_id: number
    employee_name: string
    store_id: number
    store_name: string
    type: PunchType
    recorded_at: string
    recorded_date: string
    /** Horário reportado pelo cliente (pode diferir do servidor) */
    client_reported_at: string | null
    /** Fonte do registro */
    source: TimeClockSource
    /** Motivo do ajuste administrativo (apenas para source='admin_adjustment') */
    adjustment_reason: string | null
    /** ID do registro que esta entrada anula (apenas para anulações) */
    annuls_record_id: number | null
    latitude: number | null
    longitude: number | null
    accuracy_m: number | null
    distance_m: number | null
    is_within_radius: boolean | null
    photo_url: string | null
}

/** Espelho pessoal do funcionário (GET /time-clock/me/mirror) */
export interface TimeClockMirrorResponse {
    period: '24h' | 'month'
    employee_id: number
    employee_name: string
    store_name: string
    start: string
    end: string
    items: TimeClockRecord[]
}

/** Payload para criar um ajuste administrativo */
export interface TimeClockAdjustmentPayload {
    employee_id: number
    type: PunchType
    /** ISO com fuso horário */
    recorded_at: string
    reason: string
}

/** Payload para anular um registro */
export interface TimeClockAnnulPayload {
    reason: string
}

export interface TimeClockMeResponse {
    employee_id: number | null
    employee_name: string
    store_name: string
    work_start_time: string // 'HH:MM:SS'
    work_end_time: string
    last_type: PunchType | null
    today: TimeClockRecord[]
    recent: TimeClockRecord[]
}

export interface TimeClockListResponse {
    items: TimeClockRecord[]
    pagination: {
        page: number
        limit: number
        total: number
        total_pages: number
        has_next: boolean
        has_prev: boolean
    }
}

export interface PunchPayload {
    type: PunchType
    photo_url: string
    latitude: number
    longitude: number
    accuracy_m?: number
}
