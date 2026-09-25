import apiClient from './client'
import type {
    TimeClockMeResponse,
    TimeClockMirrorResponse,
    TimeClockListResponse,
    PunchPayload,
    TimeClockRecord,
    TimeClockAdjustmentPayload,
    TimeClockAnnulPayload,
} from '@/types/timeClock.types'

export const timeClockService = {
    async getMe(): Promise<TimeClockMeResponse> {
        const response = await apiClient.get<TimeClockMeResponse>('/time-clock/me')
        return response.data
    },

    /**
     * Espelho pessoal do funcionário logado.
     * GET /time-clock/me/mirror?period=24h|month
     */
    async getMirror(period: '24h' | 'month'): Promise<TimeClockMirrorResponse> {
        const response = await apiClient.get<TimeClockMirrorResponse>('/time-clock/me/mirror', {
            params: { period },
        })
        return response.data
    },

    /**
     * Exporta PDF do espelho pessoal.
     * GET /time-clock/me/export/pdf?period=24h|month
     */
    async exportMyPdf(period: '24h' | 'month'): Promise<Blob> {
        const response = await apiClient.get<Blob>('/time-clock/me/export/pdf', {
            params: { period },
            responseType: 'blob',
        })
        return response.data
    },

    async punch(payload: PunchPayload): Promise<TimeClockRecord> {
        const response = await apiClient.post<TimeClockRecord>('/time-clock/punch', payload)
        return response.data
    },

    async list(params: {
        store_id?: number
        date?: string
        employee_id?: number
        page?: number
        limit?: number
    }): Promise<TimeClockListResponse> {
        const response = await apiClient.get<TimeClockListResponse>('/time-clock', { params })
        return response.data
    },

    /** PDF administrativo do espelho de ponto (por loja e data). */
    async exportPdf(params: { store_id: number; date: string }): Promise<Blob> {
        const response = await apiClient.get<Blob>('/time-clock/export/pdf', {
            params,
            responseType: 'blob',
        })
        return response.data
    },

    /**
     * Exporta AFD (Arquivo de Fonte de Dados) compatível com o leiaute da
     * Portaria MTP 671/2021 (sem assinatura ICP-Brasil).
     * GET /time-clock/export/afd?store_id&start&end (YYYY-MM-DD)
     */
    async exportAfd(params: { store_id: number; start: string; end: string }): Promise<Blob> {
        const response = await apiClient.get<Blob>('/time-clock/export/afd', {
            params,
            responseType: 'blob',
        })
        return response.data
    },

    /**
     * Exporta AEJ (Arquivo Eletrônico de Jornada) simplificado.
     * GET /time-clock/export/aej?store_id&start&end (YYYY-MM-DD)
     */
    async exportAej(params: { store_id: number; start: string; end: string }): Promise<Blob> {
        const response = await apiClient.get<Blob>('/time-clock/export/aej', {
            params,
            responseType: 'blob',
        })
        return response.data
    },

    /**
     * Lança um ajuste administrativo de ponto.
     * POST /time-clock/adjustments — exige permissão time_clock_mirror can_edit.
     */
    async createAdjustment(payload: TimeClockAdjustmentPayload): Promise<TimeClockRecord> {
        const response = await apiClient.post<TimeClockRecord>('/time-clock/adjustments', payload)
        return response.data
    },

    /**
     * Anula um registro de ponto existente.
     * POST /time-clock/{record_id}/annul — exige permissão time_clock_mirror can_edit.
     */
    async annulRecord(recordId: number, payload: TimeClockAnnulPayload): Promise<TimeClockRecord> {
        const response = await apiClient.post<TimeClockRecord>(
            `/time-clock/${recordId}/annul`,
            payload
        )
        return response.data
    },
}
