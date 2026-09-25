import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { schedulingService } from '@/services/api/scheduling.service'
import { serviceOrdersService } from '@/services/api/service-orders.service'
import { useToast } from '@/hooks/use-toast'
import { getApiErrorMessage } from '@/lib/api-error'
import type {
  AppointmentFilters,
  CreateAppointmentPayload,
  UpdateAppointmentPayload,
  CombinedAppointmentPayload,
  AddDepartmentsPayload,
  CarrosResumoResponse,
} from '@/types/scheduling.types'

export function useAppointments(
  filters: AppointmentFilters = {},
  page = 1,
  limit = 100
) {
  return useQuery({
    queryKey: ['scheduling', filters, page, limit],
    queryFn: () => schedulingService.list(filters, page, limit),
    // O WebSocket (appointment_created/updated/cancelled) invalida em tempo real;
    // 30s evita refetch da lista inteira a cada troca de foco/navegação.
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  })
}

export function useTodaySummary(storeId?: number | null) {
  return useQuery({
    queryKey: ['scheduling-summary', storeId],
    queryFn: () => schedulingService.getTodaySummary(storeId),
    staleTime: 1000 * 60 * 5,
  })
}

export function useCarrosResumo(
  filters: AppointmentFilters = {},
  displayStatuses: string[] = [],
  enabled = true
) {
  return useQuery<CarrosResumoResponse>({
    queryKey: ['scheduling-carros-resumo', filters, displayStatuses],
    queryFn: () => schedulingService.getCarrosResumo(filters, displayStatuses),
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
      // Criar agendamento pode gerar O.S. automaticamente em alguns fluxos
      queryClient.invalidateQueries({ queryKey: ['service-orders'] })
      queryClient.invalidateQueries({ queryKey: ['service-orders', 'conference'] })
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

export function useCreateCombinedAppointment() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: (payload: CombinedAppointmentPayload) =>
      schedulingService.createCombined(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduling'] })
      queryClient.invalidateQueries({ queryKey: ['scheduling-summary'] })
      queryClient.invalidateQueries({ queryKey: ['service-orders'] })
      queryClient.invalidateQueries({ queryKey: ['service-orders', 'conference'] })
      toast({
        title: 'Agendamentos criados',
        description: 'Os agendamentos foram registrados com sucesso.',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao criar agendamentos',
        description: getApiErrorMessage(error),
        variant: 'destructive',
      })
    },
  })
}

export function useAddDepartments() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: AddDepartmentsPayload }) =>
      schedulingService.addDepartments(id, payload),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['scheduling'] })
      queryClient.invalidateQueries({ queryKey: ['scheduling-summary'] })
      queryClient.invalidateQueries({ queryKey: ['service-orders'] })
      queryClient.invalidateQueries({ queryKey: ['service-orders', 'conference'] })
      const count = result.items?.length ?? 0
      toast({
        title: count > 1 ? 'Departamentos adicionados' : 'Departamento adicionado',
        description:
          count > 1
            ? `${count} agendamentos combinados foram criados.`
            : 'O agendamento combinado foi criado.',
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'Erro ao combinar departamentos',
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
      // Editar agendamento pode recriar ou ressincronizar a O.S. vinculada
      queryClient.invalidateQueries({ queryKey: ['service-orders'] })
      queryClient.invalidateQueries({ queryKey: ['service-orders', 'conference'] })
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
      // O.S. gerada aparece nas listagens e pode entrar na conferência
      queryClient.invalidateQueries({ queryKey: ['service-orders'] })
      queryClient.invalidateQueries({ queryKey: ['service-orders', 'conference'] })
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
        // film_roll_id ausente/nulo quando used_scrap: retalho não debita bobina.
        film_roll_assignments: Array<{
          service_id: number
          film_roll_id?: number | null
          tonality?: string
          used_scrap?: boolean
          scrap_source_roll_id?: number | null
        }>
        employee_ids: number[]
        employee_assignments?: Array<{ service_id: number; employee_ids: number[] }>
        // Relato técnico do instalador (opcional, máx. 2000) — visível na Conferência.
        execution_notes?: string | null
      }
    }) => serviceOrdersService.finalize(serviceOrderId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduling'] })
      queryClient.invalidateQueries({ queryKey: ['scheduling-summary'] })
      // Finalizar O.S. consome bobina e altera listagem de O.S.
      queryClient.invalidateQueries({ queryKey: ['service-orders'] })
      queryClient.invalidateQueries({ queryKey: ['service-orders', 'conference'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-rolls'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-critical'] })
      queryClient.invalidateQueries({ queryKey: ['roll-consumptions'] })
      queryClient.invalidateQueries({ queryKey: ['indicators'] })
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
      // Cancelar agendamento cancela a O.S. vinculada
      queryClient.invalidateQueries({ queryKey: ['service-orders'] })
      queryClient.invalidateQueries({ queryKey: ['service-orders', 'conference'] })
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
