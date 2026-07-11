import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Plus } from 'lucide-react'
import { TimePicker } from '@/components/ui/time-picker'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth.store'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCreateAppointment, useUpdateAppointment, useAppointmentCapacity } from '@/hooks/useScheduling'
import { useVehicleModels } from '@/hooks/useVehicleModels'
import { consultantsService } from '@/services/api/consultants.service'
import { servicesService } from '@/services/api/services.service'
import { inventoryService } from '@/services/api/inventory.service'
import type { FilmType } from '@/services/api/inventory.service'
import { DEPARTMENT_LABELS, getTonalityOptions } from '@/constants/scheduling'
import { cn } from '@/lib/utils'
import type { Appointment, CreateAppointmentPayload, FilmEntryItem } from '@/types/scheduling.types'
import type { Store } from '@/services/api/stores.service'
import { ServiceCodeCombobox } from '@/components/features/service-orders/ServiceCodeCombobox'
import { isValidPlateOrChassi, PLATE_ERROR_MESSAGE } from '@/utils/plate'
import { DismissibleNotice } from '@/components/common/DismissibleNotice'
import { DuplicateAlert } from '@/components/features/service-orders/DuplicateAlert'
import { useDuplicateCheck } from '@/hooks/useDuplicateCheck'

const DEPARTMENTS = Object.entries(DEPARTMENT_LABELS)

const schema = z
  .object({
    store_id: z.string().min(1, 'Selecione a loja'),
    department: z.string().min(1, 'Selecione o departamento'),
    courtesy_type: z.enum(['normal', 'cortesia', 'retorno']),
    is_galpon: z.boolean(),
    delivery_date: z.string().min(1, 'Informe a previsão de entrega'),
    delivery_time: z.string().min(1, 'Informe o horário de entrega'),
    external_os_number: z.string().optional(),
    vehicle_plate: z.string().min(1, 'Placa obrigatória').refine(isValidPlateOrChassi, PLATE_ERROR_MESSAGE),
    vehicle_model: z.string().min(1, 'Modelo obrigatório'),
    vehicle_color: z.string().min(1, 'Cor obrigatória'),
    consultant_id: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.is_galpon && !data.consultant_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Consultor obrigatório',
        path: ['consultant_id'],
      });
    }
  })

type FormData = z.infer<typeof schema>

interface AppointmentFormProps {
  open: boolean
  onClose: () => void
  appointment?: Appointment | null
  stores: Store[]
}

function FieldLabel({ htmlFor, required, children }: { htmlFor: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-xs text-red-500 mt-0.5">{message}</p>
}

interface FilmEntryLocal extends FilmEntryItem {
  service_name: string
  service_code: string | null
  film_roll_id: number | null
  film_type_id?: number
}

export function AppointmentForm({ open, onClose, appointment, stores }: AppointmentFormProps) {
  const isEdit = !!appointment
  const createMutation = useCreateAppointment()
  const updateMutation = useUpdateAppointment()
  const effectivePermissions = useAuthStore((s) => s.effectivePermissions)
  const isGalponProfile = effectivePermissions?.is_galpon_profile === true
  const hideGalponOption = effectivePermissions?.hide_galpon_option === true
  // Perfil galpão só fica travado na CRIAÇÃO. Na edição (com permissão de editar) ele PODE
  // desmarcar o Galpão para enviar o carro à programação da loja (some da visão do galpão).
  const galponLocked = isGalponProfile && !isEdit

  const [selectedServiceIds, setSelectedServiceIds] = useState<number[]>([])
  const [filmEntries, setFilmEntries] = useState<FilmEntryLocal[]>([])
  const [pendingFilmServiceId, setPendingFilmServiceId] = useState<string>('')
  const [pendingFilmTonality, setPendingFilmTonality] = useState<string>('')
  const [pendingFilmTypeId, setPendingFilmTypeId] = useState<string>('')
  const [serviceError, setServiceError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      store_id: '',
      department: '',
      courtesy_type: 'normal',
      is_galpon: false,
      delivery_date: '',
      delivery_time: '',
      external_os_number: '',
      vehicle_plate: '',
      vehicle_model: '',
      vehicle_color: '',
      consultant_id: '',
      notes: '',
    },
  })

  const selectedStoreId = watch('store_id')
  const selectedDepartment = watch('department')
  const isGalpon = watch('is_galpon')
  const courtesyType = watch('courtesy_type')

  const isFilmDept =
    selectedDepartment === 'film' ||
    selectedDepartment === 'security_film' ||
    selectedDepartment === 'ppf'

  // Tonalidade é obrigatória por película nesses departamentos (PPF usa marca)
  const requiresTonality =
    selectedDepartment === 'film' || selectedDepartment === 'security_film'

  // Fetch consultants filtered by store
  const { data: consultantsData } = useQuery({
    queryKey: ['consultants', { store_id: selectedStoreId ? Number(selectedStoreId) : undefined }],
    queryFn: () => consultantsService.list({ store_id: Number(selectedStoreId), is_active: true }, 1, 100),
    enabled: !!selectedStoreId,
    staleTime: 1000 * 60 * 5,
  })

  // Resolve brand_id from selected store
  const selectedStoreBrandId = selectedStoreId
    ? stores.find((s) => s.id === Number(selectedStoreId))?.brand_id
    : undefined

  // Fetch services filtered by department + store brand
  const { data: servicesData } = useQuery({
    queryKey: ['services', { department: selectedDepartment, brand_id: selectedStoreBrandId }],
    queryFn: () => servicesService.list({ department: selectedDepartment, brand_id: selectedStoreBrandId, is_active: true }),
    enabled: !!selectedDepartment && !!selectedStoreBrandId,
    staleTime: 1000 * 60 * 10,
  })

  // Fetch vehicle models filtered by store brand
  const { data: vehicleModelsData } = useVehicleModels({
    brand_id: selectedStoreBrandId,
    active_only: true,
  })

  // Marcas PPF (apenas para dept ppf)
  const { data: ppfBrandsData } = useQuery({
    queryKey: ['film-types-ppf'],
    queryFn: () => inventoryService.listFilmTypes({ department: 'ppf', limit: 100 }),
    enabled: selectedDepartment === 'ppf',
    staleTime: 1000 * 60 * 5,
  })
  const ppfBrands: FilmType[] = ppfBrandsData?.items ?? []

  const consultants = consultantsData?.consultants ?? []
  const allServices = servicesData?.items ?? []
  const vehicleModels = vehicleModelsData ?? []

  // For film/ppf: all services are potential film services
  // For other depts: use selectedServiceIds
  const sortByLabel = (a: { code?: string | null; name: string }, b: { code?: string | null; name: string }) => {
    const la = `${a.code ?? ''} ${a.name}`.trim().toLowerCase()
    const lb = `${b.code ?? ''} ${b.name}`.trim().toLowerCase()
    return la.localeCompare(lb, 'pt-BR')
  }

  const isCourtesyAppointment = courtesyType === 'cortesia'

  const filmServiceOptions = isFilmDept
    ? allServices
        .filter((s) => !filmEntries.some((e) => e.service_id === s.id))
        .filter((s) => isCourtesyAppointment || !s.is_courtesy_only)
        .sort(sortByLabel)
    : []
  const availableServices = isFilmDept
    ? []
    : allServices
        .filter((s) => !selectedServiceIds.includes(s.id))
        .filter((s) => isCourtesyAppointment || !s.is_courtesy_only)
        .sort(sortByLabel)
  const selectedServices = isFilmDept
    ? []
    : allServices.filter((s) => selectedServiceIds.includes(s.id))

  const deliveryDate = watch('delivery_date')
  const watchedPlate = watch('vehicle_plate')

  // Reúne todos os service_ids selecionados (película ou catálogo)
  const duplicateServiceIds: number[] = isFilmDept
    ? filmEntries.map((e) => e.service_id).filter((id) => id > 0)
    : selectedServiceIds

  const { data: duplicateData } = useDuplicateCheck({
    plate: (watchedPlate ?? '').toUpperCase().trim(),
    service_date: deliveryDate ?? '',
    department: selectedDepartment ?? '',
    service_ids: duplicateServiceIds,
    is_return: courtesyType === 'retorno',
  })

  // Capacity check
  const { data: capacityCount } = useAppointmentCapacity(
    selectedStoreId ? Number(selectedStoreId) : null,
    deliveryDate
  )

  // Populate form when editing
  useEffect(() => {
    if (!open) return
    if (appointment) {
      reset({
        store_id: String(appointment.store_id),
        department: appointment.department,
        courtesy_type: appointment.is_courtesy ? 'cortesia' : appointment.is_return ? 'retorno' : 'normal',
        is_galpon: appointment.is_galpon ?? false,
        delivery_date: appointment.delivery_date,
        delivery_time: appointment.delivery_time ?? '',
        external_os_number: appointment.external_os_number ?? '',
        vehicle_plate: appointment.vehicle_plate,
        vehicle_model: appointment.vehicle_model ?? '',
        vehicle_color: appointment.vehicle_color ?? '',
        consultant_id: appointment.consultant_id ? String(appointment.consultant_id) : '',
        notes: appointment.notes ?? '',
      })
      setSelectedServiceIds(appointment.service_ids ?? [])
      // Pre-populate film entries
      if (appointment.film_entries && appointment.film_entries.length > 0) {
        setFilmEntries(
          appointment.film_entries.map((fe) => ({
            ...fe,
            service_name: fe.service_name ?? '',
            service_code: fe.service_code ?? null,
            film_roll_id: fe.film_roll_id ?? null,
            film_type_id: fe.film_type_id ?? undefined,
          }))
        )
      } else {
        setFilmEntries([])
      }
    } else {
      const today = new Date().toISOString().split('T')[0]
      reset({
        store_id: stores.length === 1 ? String(stores[0].id) : '',
        department: '',
        courtesy_type: 'normal',
        is_galpon: isGalponProfile,
        delivery_date: today,
        delivery_time: '',
        external_os_number: '',
        vehicle_plate: '',
        vehicle_model: '',
        vehicle_color: '',
        consultant_id: '',
        notes: '',
      })
      setSelectedServiceIds([])
      setFilmEntries([])
    }
    setPendingFilmServiceId('')
    setPendingFilmTonality('')
    setPendingFilmTypeId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const addService = (idStr: string) => {
    const id = Number(idStr)
    if (!selectedServiceIds.includes(id)) {
      setSelectedServiceIds((prev) => [...prev, id])
      setServiceError(null)
    }
  }

  const removeService = (id: number) => {
    setSelectedServiceIds((prev) => prev.filter((x) => x !== id))
  }

  const addFilmEntry = () => {
    if (!pendingFilmServiceId) return
    const svc = allServices.find((s) => s.id === Number(pendingFilmServiceId))
    if (!svc) return
    if (requiresTonality && !pendingFilmTonality) {
      setServiceError('Selecione a tonalidade da película')
      return
    }
    setFilmEntries((prev) => [
      ...prev,
      {
        service_id: svc.id,
        tonality: pendingFilmTonality || null,
        service_name: svc.name,
        service_code: svc.code ?? null,
        film_roll_id: null,
        film_type_id: pendingFilmTypeId ? Number(pendingFilmTypeId) : undefined,
      },
    ])
    setPendingFilmServiceId('')
    setPendingFilmTonality('')
    setPendingFilmTypeId('')
    setServiceError(null)
  }

  const removeFilmEntry = (serviceId: number) => {
    setFilmEntries((prev) => prev.filter((e) => e.service_id !== serviceId))
  }

  const onSubmit = (data: FormData) => {
    const hasServices = isFilmDept ? filmEntries.length > 0 : selectedServiceIds.length > 0
    if (!hasServices) {
      setServiceError('Adicione ao menos um serviço para continuar')
      return
    }
    if (requiresTonality && filmEntries.some((e) => !e.tonality)) {
      setServiceError(
        'Informe a tonalidade de todas as películas (remova a película sem tonalidade e adicione novamente)'
      )
      return
    }
    setServiceError(null)

    const payload: CreateAppointmentPayload = {
      store_id: Number(data.store_id),
      department: data.department,
      delivery_date: data.delivery_date,
      delivery_time: data.delivery_time || undefined,
      vehicle_plate: data.vehicle_plate.toUpperCase(),
      external_os_number: data.external_os_number || undefined,
      vehicle_model: data.vehicle_model || undefined,
      vehicle_color: data.vehicle_color || undefined,
      consultant_id: data.consultant_id ? Number(data.consultant_id) : undefined,
      service_ids: isFilmDept
        ? filmEntries.map((e) => e.service_id)
        : selectedServiceIds.length > 0 ? selectedServiceIds : undefined,
      film_entries: isFilmDept && filmEntries.length > 0
        ? filmEntries.map(({ service_id, tonality, film_roll_id, film_type_id }) => ({
            service_id,
            tonality,
            film_roll_id: film_roll_id ?? undefined,
            film_type_id: film_type_id ?? undefined,
          }))
        : undefined,
      notes: data.notes || undefined,
      is_galpon: data.is_galpon,
      is_courtesy: data.courtesy_type === 'cortesia',
      is_return: data.courtesy_type === 'retorno',
    }

    if (isEdit && appointment) {
      updateMutation.mutate({ id: appointment.id, payload }, { onSuccess: onClose })
    } else {
      createMutation.mutate(payload, { onSuccess: onClose })
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-xl w-full max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-4 pb-3 border-b flex-shrink-0">
          <DialogTitle>{isEdit ? 'Editar Agendamento' : 'Novo Agendamento'}</DialogTitle>
          <DialogDescription className="sr-only">
            {isEdit ? 'Edite os dados do agendamento.' : 'Preencha os dados para criar um novo agendamento.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

            <DismissibleNotice storageKey="aems_notice_plate_chassi_appointment_v1" title="Novos padrões de placa e chassi">
              O campo Placa/Chassi agora aceita apenas placa (ABC1234 ou ABC1D23) ou o chassi gravado no vidro
              (8 caracteres, com letras e números). O chassi completo de 17 caracteres não é mais aceito.
            </DismissibleNotice>

            {/* Row 1: Loja + Cortesia/Retorno + Galpão */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <FieldLabel htmlFor="store_id" required>Loja</FieldLabel>
                <Controller
                  name="store_id"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v)
                        setValue('consultant_id', '')
                      }}
                    >
                      <SelectTrigger id="store_id">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {stores.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError message={errors.store_id?.message} />
              </div>

              <div>
                <FieldLabel htmlFor="courtesy_type">Cortesia/Retorno</FieldLabel>
                <div className="flex items-center gap-2">
                  <Controller
                    name="courtesy_type"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="courtesy_type" className="flex-1">
                          <SelectValue placeholder="Normal" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="normal">Normal</SelectItem>
                          <SelectItem value="cortesia">Cortesia</SelectItem>
                          <SelectItem value="retorno">Retorno</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {!hideGalponOption && (
                    <label htmlFor="appointment-is-galpon" className={`flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap select-none ${galponLocked ? 'cursor-default opacity-70' : 'cursor-pointer'}`}>
                      <Controller
                        name="is_galpon"
                        control={control}
                        render={({ field }) => (
                          <input
                            id="appointment-is-galpon"
                            type="checkbox"
                            checked={field.value}
                            onChange={(e) => !galponLocked && field.onChange(e.target.checked)}
                            disabled={galponLocked}
                            className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400 cursor-pointer disabled:cursor-default"
                          />
                        )}
                      />
                      Galpão
                    </label>
                  )}
                </div>
                {isGalpon && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    Veículo aparecerá no galpão.
                  </p>
                )}
              </div>
            </div>

            {/* Row 2: Departamento — toggle buttons */}
            <div>
              <FieldLabel htmlFor="department" required>Departamento</FieldLabel>
              <Controller
                name="department"
                control={control}
                render={({ field }) => (
                  <div className="flex flex-wrap gap-1.5">
                    {DEPARTMENTS.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          if (value !== field.value) setSelectedServiceIds([])
                          field.onChange(value)
                        }}
                        className={cn(
                          'px-3 py-1.5 rounded-md text-sm font-medium border transition-colors',
                          field.value === value
                            ? 'bg-amber-400 text-black border-amber-400'
                            : 'bg-white dark:bg-zinc-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-zinc-600 hover:border-amber-400'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              />
              <FieldError message={errors.department?.message} />
            </div>

            {/* Row 3: Data + Horário + N. OS Concessionária.
                Mobile: Previsão + Horário lado a lado; Nº OS em linha própria. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <FieldLabel htmlFor="delivery_date" required>Previsão de entrega</FieldLabel>
                <Input id="delivery_date" type="date" {...register('delivery_date')} />
                <FieldError message={errors.delivery_date?.message} />
              </div>
              <div>
                <FieldLabel htmlFor="delivery_time" required>Horário de entrega</FieldLabel>
                <TimePicker
                  id="delivery_time"
                  value={watch('delivery_time')}
                  onChange={(v) => setValue('delivery_time', v, { shouldValidate: true, shouldDirty: true })}
                />
                <FieldError message={errors.delivery_time?.message} />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <FieldLabel htmlFor="external_os_number">N. OS Concessionária</FieldLabel>
                <Input id="external_os_number" placeholder="Ex: OS-2024-001" {...register('external_os_number')} />
              </div>
            </div>

            {/* Row 4: Placa + Modelo + Cor.
                Mobile: Placa destacada em linha própria; Modelo + Cor lado a lado. */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <FieldLabel htmlFor="vehicle_plate" required>Placa / Chassi</FieldLabel>
                <Input
                  id="vehicle_plate"
                  placeholder="ABC1D23 OU CHASSI"
                  className="uppercase font-mono tracking-wider"
                  {...register('vehicle_plate', {
                    onChange: (e) => { e.target.value = e.target.value.toUpperCase() },
                  })}
                />
                <FieldError message={errors.vehicle_plate?.message} />
              </div>

              <div>
                <FieldLabel htmlFor="vehicle_model" required>Modelo</FieldLabel>
                {vehicleModels.length > 0 ? (
                  <Controller
                    name="vehicle_model"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value || ''} onValueChange={field.onChange}>
                        <SelectTrigger id="vehicle_model">
                          <SelectValue placeholder="Selecione o modelo" />
                        </SelectTrigger>
                        <SelectContent>
                          {vehicleModels.map((m) => (
                            <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                ) : (
                  <Input id="vehicle_model" placeholder="Ex: Corolla" {...register('vehicle_model')} />
                )}
                <FieldError message={errors.vehicle_model?.message} />
              </div>

              <div>
                <FieldLabel htmlFor="vehicle_color" required>Cor</FieldLabel>
                <Input id="vehicle_color" placeholder="Ex: Prata" {...register('vehicle_color')} />
                <FieldError message={errors.vehicle_color?.message} />
              </div>
            </div>

            {/* Capacity warning */}
            {capacityCount !== undefined && capacityCount > 0 && (
              <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-700 px-3 py-2 text-xs text-yellow-800 dark:text-yellow-300">
                {capacityCount} veículo{capacityCount > 1 ? 's' : ''} já agendado
                {capacityCount > 1 ? 's' : ''} para esta data nesta loja.
              </div>
            )}

            {/* Alerta de duplicidade (não bloqueante) */}
            <DuplicateAlert result={duplicateData} />

            {/* Consultor */}
            <div>
              <FieldLabel htmlFor="consultant_id" required={!isGalpon}>Consultor</FieldLabel>
              <Controller
                name="consultant_id"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value || 'none'}
                    onValueChange={(v) => field.onChange(v === 'none' ? '' : v)}
                    disabled={!selectedStoreId}
                  >
                    <SelectTrigger id="consultant_id">
                      <SelectValue placeholder="Selecione o consultor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem consultor</SelectItem>
                      {consultants.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {!selectedStoreId && (
                <p className="text-xs text-muted-foreground mt-1">Selecione a loja primeiro.</p>
              )}
              <FieldError message={errors.consultant_id?.message} />
            </div>

            {/* Seção PELÍCULAS (apenas para film/ppf) — picker igual ao lançamento de O.S. */}
            {isFilmDept && (
              <div className="rounded-lg border dark:border-zinc-700 p-3 bg-gray-50 dark:bg-zinc-800/30 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Películas
                </p>

                {/* Picker: serviço + tonalidade + botão Adicionar.
                    Mobile: serviço em linha própria; tonalidade + Adicionar embaixo. */}
                <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                  <div className="flex-1 min-w-0">
                    <FieldLabel htmlFor="film_service_pick">Serviço</FieldLabel>
                    <ServiceCodeCombobox
                      services={filmServiceOptions}
                      value={Number(pendingFilmServiceId) || 0}
                      onChange={setPendingFilmServiceId}
                      placeholder={filmServiceOptions.length === 0 ? 'Nenhum disponível' : 'Selecione o serviço'}
                      disabled={filmServiceOptions.length === 0}
                    />
                  </div>

                  <div className="flex gap-2 items-end">
                    {(selectedDepartment === 'film' || selectedDepartment === 'security_film') && (
                      <div className="flex-1 sm:flex-initial sm:w-28">
                        <FieldLabel htmlFor="film_tonality_pick" required>Tonalidade</FieldLabel>
                        <Select
                          value={pendingFilmTonality}
                          onValueChange={(v) => {
                            setPendingFilmTonality(v)
                            setServiceError(null)
                          }}
                        >
                          <SelectTrigger id="film_tonality_pick">
                            <SelectValue placeholder="G05..." />
                          </SelectTrigger>
                          <SelectContent>
                            {getTonalityOptions({ serviceCode: filmServiceOptions.find(s => s.id === Number(pendingFilmServiceId))?.code, department: selectedDepartment }).map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {selectedDepartment === 'ppf' && (
                      <div className="flex-1 sm:flex-initial sm:w-40">
                        <FieldLabel htmlFor="film_type_pick">Marca PPF</FieldLabel>
                        <Select value={pendingFilmTypeId} onValueChange={setPendingFilmTypeId}>
                          <SelectTrigger id="film_type_pick">
                            <SelectValue placeholder="Selecionar..." />
                          </SelectTrigger>
                          <SelectContent>
                            {ppfBrands.map((ft) => (
                              <SelectItem key={ft.id} value={String(ft.id)}>{ft.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <Button
                      type="button"
                      size="sm"
                      onClick={addFilmEntry}
                      disabled={!pendingFilmServiceId || (requiresTonality && !pendingFilmTonality)}
                      className="flex items-center gap-1"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Adicionar
                    </Button>
                  </div>
                </div>

                {/* Entradas adicionadas */}
                {filmEntries.length > 0 && (
                  <div className="space-y-2 pt-1">
                    {filmEntries.map((entry, idx) => (
                      <div
                        key={entry.service_id}
                        className="rounded-md border dark:border-zinc-600 p-2.5 bg-white dark:bg-zinc-800 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                            FILME {idx + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFilmEntry(entry.service_id)}
                            className="text-muted-foreground hover:text-red-500 transition-colors"
                            aria-label="Remover película"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="text-sm text-gray-900 dark:text-white">
                          {entry.service_code ? `${entry.service_code} - ${entry.service_name || `Serviço #${entry.service_id}`}` : (entry.service_name || `Serviço #${entry.service_id}`)}
                          {entry.tonality && <span className="text-muted-foreground ml-1">— {entry.tonality}</span>}
                          {entry.film_type_id && (() => {
                            const brand = ppfBrands.find(ft => ft.id === entry.film_type_id)
                            return brand ? <span className="text-muted-foreground ml-1">— {brand.name}</span> : null
                          })()}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {serviceError && isFilmDept && (
                  <p className="text-xs text-red-500">{serviceError}</p>
                )}

                {!selectedStoreBrandId && (
                  <p className="text-xs text-muted-foreground">Selecione a loja para ver os serviços disponíveis.</p>
                )}
              </div>
            )}

            {/* Serviços do catálogo (não exibido para film/ppf — usa o picker acima) */}
            {selectedDepartment && !isFilmDept && (
              <div className="rounded-lg border dark:border-zinc-700 p-3 bg-gray-50 dark:bg-zinc-800/30 space-y-2">
                <FieldLabel htmlFor="service_select">Serviços</FieldLabel>

                {!selectedStoreId ? (
                  <p className="text-xs text-muted-foreground py-1">Selecione a loja primeiro.</p>
                ) : availableServices.length > 0 ? (
                  <Select onValueChange={addService} value="">
                    <SelectTrigger id="service_select">
                      <SelectValue placeholder="Adicionar serviço do catálogo..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableServices.map((svc) => (
                        <SelectItem key={svc.id} value={String(svc.id)}>
                          {svc.code ? `[${svc.code}] ` : ''}{svc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  selectedServices.length === 0 && (
                    <p className="text-xs text-muted-foreground py-1">
                      Nenhum serviço cadastrado para este departamento nesta loja.
                    </p>
                  )
                )}

                {serviceError && !isFilmDept && (
                  <p className="text-xs text-red-500">{serviceError}</p>
                )}

                {selectedServices.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {selectedServices.map((svc) => (
                      <span
                        key={svc.id}
                        className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-md px-2 py-0.5 border border-blue-200 dark:border-blue-800"
                      >
                        {svc.code ? `${svc.code} - ${svc.name}` : svc.name}
                        <button
                          type="button"
                          onClick={() => removeService(svc.id)}
                          className="ml-0.5 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                          aria-label={`Remover ${svc.name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Observações */}
            <div>
              <FieldLabel htmlFor="notes">Observações</FieldLabel>
              <Textarea
                id="notes"
                rows={3}
                placeholder="Informações adicionais..."
                className="resize-none border border-gray-300 dark:border-zinc-600"
                {...register('notes')}
              />
            </div>

          </div>

          <DialogFooter className="px-5 py-3 border-t flex-shrink-0 gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving} size="sm">
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSaving}
              size="sm"
              style={{ backgroundColor: '#F5A800', color: '#000' }}
              className="hover:opacity-90 font-semibold"
            >
              {isSaving ? 'Salvando...' : isEdit ? 'Salvar Alterações' : 'Criar Agendamento'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
