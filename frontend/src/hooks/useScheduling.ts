import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { schedulingService } from '@/services/api/scheduling.service'
import { serviceOrdersService } from '@/services/api/service-orders.service'
import { useToast } from '@/hooks/use-toast'
import { getApiErrorMessage } from '@/lib/api-error'
import type {
  AppointmentFilters,
  CreateAppointmentPayload,
  UpdateAppointmentPayload,
  SchedulingStoreSummary,
} from '@/types/scheduling.types'

export function useAppointments(
  filters: AppointmentFilters = {},
  page = 1,
  limit = 100
) {
  return useQuery({
    queryKey: ['scheduling', filters, page, limit],
    queryFn: () => schedulingService.list(filters, page, limit),
    staleTime: 0,
    gcTime: 1000 * 60 * 2,
  })
}

export function useTodaySummary(storeId?: number | null) {
  return useQuery({
    queryKey: ['scheduling-summary', storeId],
    queryFn: () => schedulingService.getTodaySummary(storeId),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 2,
  })
}

export function useSchedulingStoreSummary(
  filters: { date_from?: string; date_to?: string; department?: string } = {},
  enabled = true
) {
  return useQuery<SchedulingStoreSummary[]>({
    queryKey: ['scheduling-store-summary', filters],
    queryFn: () => schedulingService.getStoreSummary(filters),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 2,
    enabled,
  })
}

export function useAppointmentCapacity(
  storeId: number | null,
  deliveryDate: string
) {
  return useQuery({
    queryKey: ['scheduling-capacity', storeId, deliveryDate],
    queryFn: () => schedulingService.getCapacity(storeId!, deliveryDate),
    enabled: !!storeId && !!deliveryDate,
    staleTime: 1000 * 60 * 1,
  })
}

export function useCreateAppointment() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (payload: CreateAppointmentPayload) =>
      schedulingService.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduling'] })
      queryClient.invalidateQueries({ queryKey: ['scheduling-summary'] })
      toast({
        title: 'Agendamento criado',
        description: 'O agendamento foi registrado com sucesso.',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao criar agendamento',
        description: getApiErrorMessage(error),
        variant: 'destructive',
      })
    },
  })
}

export function useUpdateAppointment() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateAppointmentPayload }) =>
      schedulingService.update(id, payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['scheduling'] })
      queryClient.invalidateQueries({ queryKey: ['scheduling-history', variables.id] })
      toast({
        title: 'Agendamento atualizado',
        description: 'As alteracoes foram salvas.',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao atualizar agendamento',
        description: getApiErrorMessage(error),
        variant: 'destructive',
      })
    },
  })
}

export function useAppointmentHistory(id: number | null) {
  return useQuery({
    queryKey: ['scheduling-history', id],
    queryFn: () => schedulingService.getHistory(id!),
    enabled: !!id,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 2,
    retry: false,
  })
}

export function useGenerateOS() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number
      payload: {
        photos: string[]
        notes?: string
      }
    }) => schedulingService.generateOS(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduling'] })
      queryClient.invalidateQueries({ queryKey: ['scheduling-summary'] })
      toast({
        title: 'O.S. gerada com sucesso',
        description: 'A ordem de serviço foi criada e vinculada ao agendamento.',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao gerar O.S.',
        description: getApiErrorMessage(error),
        variant: 'destructive',
      })
    },
  })
}

export function useFinalizeOS() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: ({
      serviceOrderId,
      payload,
    }: {
      serviceOrderId: number
      payload: {
        completion_photos: string[]
        film_roll_assignments: Array<{ service_id: number; film_roll_id: number }>
        employee_ids: number[]
      }
    }) => serviceOrdersService.finalize(serviceOrderId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduling'] })
      queryClient.invalidateQueries({ queryKey: ['scheduling-summary'] })
      toast({
        title: 'O.S. finalizada com sucesso',
        description: 'A ordem de servico foi concluida.',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao finalizar O.S.',
        description: getApiErrorMessage(error),
        variant: 'destructive',
      })
    },
  })
}

export function useCancelAppointment() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      schedulingService.cancel(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduling'] })
      queryClient.invalidateQueries({ queryKey: ['scheduling-summary'] })
      toast({
        title: 'Agendamento cancelado',
        description: 'O agendamento foi cancelado.',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao cancelar agendamento',
        description: getApiErrorMessage(error),
        variant: 'destructive',
      })
    },
  })
}
