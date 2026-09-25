import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { timeClockService } from '@/services/api/timeClock.service'
import { useToast } from '@/hooks/use-toast'
import { getApiErrorMessage, getApiErrorStatus } from '@/lib/api-error'
import type {
    PunchPayload,
    TimeClockAdjustmentPayload,
    TimeClockAnnulPayload,
} from '@/types/timeClock.types'

export function useTimeClockMe() {
    return useQuery({
        queryKey: ['time-clock', 'me'],
        queryFn: () => timeClockService.getMe(),
        staleTime: 1000 * 30, // 30 segundos
        refetchInterval: 30_000,
    })
}

/**
 * Espelho pessoal do funcionário logado.
 * Consome GET /time-clock/me/mirror?period=24h|month
 */
export function useMyMirror(period: '24h' | 'month') {
    return useQuery({
        queryKey: ['time-clock', 'my-mirror', period],
        queryFn: () => timeClockService.getMirror(period),
        staleTime: 1000 * 60, // 1 minuto
    })
}

export function usePunch() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (payload: PunchPayload) => timeClockService.punch(payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['time-clock', 'me'] })
            queryClient.invalidateQueries({ queryKey: ['time-clock', 'list'] })
        },
    })
}

export function useTimeClockList(params: {
    store_id?: number
    date?: string
    employee_id?: number
    page?: number
    limit?: number
}) {
    return useQuery({
        queryKey: ['time-clock', 'list', params],
        queryFn: () => timeClockService.list(params),
        staleTime: 1000 * 60,
    })
}

/**
 * Lança um ajuste administrativo de ponto.
 * Invalida as queries do espelho após o ajuste.
 */
export function useCreateAdjustment() {
    const queryClient = useQueryClient()
    const { toast } = useToast()

    return useMutation({
        mutationFn: (payload: TimeClockAdjustmentPayload) =>
            timeClockService.createAdjustment(payload),
        onSuccess: () => {
            // Invalida lista de registros para refletir o novo ajuste
            queryClient.invalidateQueries({ queryKey: ['time-clock', 'list'] })
            toast({ title: 'Ajuste lançado com sucesso.' })
        },
        onError: (err: Error) => {
            toast({
                title: 'Erro ao lançar ajuste',
                description: getApiErrorMessage(err, 'Tente novamente.'),
                variant: 'destructive',
            })
        },
    })
}

/**
 * Anula um registro de ponto.
 * Trata 409 (já anulado) com mensagem amigável.
 */
export function useAnnulRecord() {
    const queryClient = useQueryClient()
    const { toast } = useToast()

    return useMutation({
        mutationFn: ({ recordId, payload }: { recordId: number; payload: TimeClockAnnulPayload }) =>
            timeClockService.annulRecord(recordId, payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['time-clock', 'list'] })
            toast({ title: 'Registro anulado com sucesso.' })
        },
        onError: (err: Error) => {
            const status = getApiErrorStatus(err)
            const description =
                status === 409
                    ? 'Este registro já foi anulado anteriormente.'
                    : getApiErrorMessage(err, 'Tente novamente.')
            toast({
                title: 'Erro ao anular registro',
                description,
                variant: 'destructive',
            })
        },
    })
}
