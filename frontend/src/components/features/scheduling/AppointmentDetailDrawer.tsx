import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, ExternalLink, Edit, XCircle, Zap, Clock, History, Camera, ImageIcon, Loader2, CheckCircle, Check, ChevronDown } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { getApiErrorMessage } from '@/lib/api-error'
import {
  APPOINTMENT_STATUS_CONFIG,
  DEPARTMENT_LABELS,
  DEPARTMENT_BADGE_COLORS,
} from '@/constants/scheduling'
import { servicesService } from '@/services/api/services.service'
import { employeesService } from '@/services/api/employees.service'
import { uploadService } from '@/services/api/upload.service'
import { useAppointmentHistory, useGenerateOS, useFinalizeOS } from '@/hooks/useScheduling'
import { useCanView } from '@/hooks/useMyPermissions'
import { FilmRollSelector } from './FilmRollSelector'
import { CameraCapture } from '@/components/common/CameraCapture'
import { PhotoDialog } from '@/components/common/PhotoDialog'
import { compressImage } from '@/utils/imageCompression'
import { validateImageFile } from '@/utils/fileValidation'
import { generateId } from '@/utils/generateId'
import { logger } from '@/lib/logger'
import type { Appointment, FilmEntryItem } from '@/types/scheduling.types'
import type { Photo } from '@/types/photo.types'
import type { ServiceItem } from '@/services/api/services.service'

// ─── Step type ────────────────────────────────────────────────────────────────

type DrawerStep = 'detail' | 'finalize'

// ─── Props ────────────────────────────────────────────────────────────────────

interface AppointmentDetailDrawerProps {
  appointment: Appointment | null
  open: boolean
  onClose: () => void
  onEdit: (appt: Appointment) => void
  onCancel: (appt: Appointment) => void
  canEdit?: boolean
  canCancel?: boolean
  canGenerateOS?: boolean
}

// ─── Helper components ────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </span>
      <span className="text-sm text-gray-900 dark:text-white">{value}</span>
    </div>
  )
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  return `${day}/${month}/${year}`
}

function formatDateTime(isoStr: string): string {
  const d = new Date(isoStr)
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const ACTION_LABELS: Record<string, string> = {
  create: 'Criado',
  update: 'Editado',
  cancel: 'Cancelado',
  generate_os: 'O.S. Gerada',
  finalize_os: 'O.S. Finalizada',
}

const FIELD_LABELS: Record<string, string> = {
  store_id: 'Loja',
  department: 'Departamento',
  delivery_date: 'Data do Serviço',
  delivery_time: 'Horário',
  external_os_number: 'Nº OS Externa',
  vehicle_plate: 'Placa',
  vehicle_model: 'Modelo',
  vehicle_color: 'Cor',
  consultant_id: 'Consultor',
  consultant_name: 'Nome do Consultor',
  is_galpon: 'Galpão',
  is_courtesy: 'Cortesia',
  is_return: 'Retorno',
  service_ids: 'Serviços',
  film_entries: 'Películas',
  notes: 'Observações',
  status: 'Status',
}

function renderChanges(
  oldVal: Record<string, unknown> | null,
  newVal: Record<string, unknown> | null
): string {
  if (!oldVal || !newVal) return ''
  const keys = Object.keys(newVal)
  return keys
    .filter((k) => String(oldVal[k]) !== String(newVal[k]))
    .map((k) => FIELD_LABELS[k] ?? k.replace(/_/g, ' '))
    .join(', ')
}

function buildServiceLabel(
  fe: FilmEntryItem,
  map: Record<number, ServiceItem>
): string {
  const parts: string[] = []
  if (fe.service_name) {
    if (fe.service_code) parts.push(`[${fe.service_code}]`)
    parts.push(fe.service_name)
  } else {
    const svc = map[fe.service_id]
    if (svc) {
      if (svc.code) parts.push(`[${svc.code}]`)
      parts.push(svc.name)
    } else {
      parts.push(`Serviço #${fe.service_id}`)
    }
  }
  if (fe.tonality) parts.push(fe.tonality)
  return parts.join(' ')
}

// ─── PhotoSlot ────────────────────────────────────────────────────────────────

interface PhotoSlotProps {
  photo: Photo | undefined
  index: number
  onCapture: (index: number, file: File) => void
  onRemove: (index: number) => void
}

function PhotoSlot({ photo, index, onCapture, onRemove }: PhotoSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [showOptions, setShowOptions] = useState(false)
  const [showCamera, setShowCamera] = useState(false)

  const handleFile = useCallback(
    (file: File) => {
      const validation = validateImageFile(file)
      if (!validation.valid) {
        toast({ variant: 'destructive', title: 'Arquivo invalido', description: validation.error })
        return
      }
      onCapture(index, file)
    },
    [index, onCapture]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (inputRef.current) inputRef.current.value = ''
      if (!file) return
      handleFile(file)
    },
    [handleFile]
  )

  return (
    <div className="relative aspect-square rounded-lg overflow-hidden border-2 border-dashed border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800/40">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleChange}
      />
      {showCamera && (
        <CameraCapture
          onCapture={(file) => { setShowCamera(false); handleFile(file) }}
          onCancel={() => setShowCamera(false)}
        />
      )}
      {photo ? (
        <>
          <img
            src={photo.preview}
            alt={`Foto ${index + 1}`}
            className="w-full h-full object-cover"
          />
          <button
            type="button"
            onClick={() => onRemove(index)}
            aria-label="Remover foto"
            className="absolute top-1 right-1 bg-black/60 hover:bg-destructive text-white rounded-full p-0.5 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
          <span className="absolute bottom-1 left-1 text-[10px] font-medium text-white bg-black/50 rounded px-1">
            {index + 1}
          </span>
        </>
      ) : (
        <Popover open={showOptions} onOpenChange={setShowOptions}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-[#F5A800] transition-colors"
              aria-label={`Adicionar foto ${index + 1}`}
            >
              <Camera className="h-5 w-5" />
              <span className="text-[10px] font-medium">{index + 1}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-36 p-1.5" side="bottom" align="start">
            <button
              type="button"
              onClick={() => { setShowOptions(false); setShowCamera(true) }}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm hover:bg-accent transition-colors"
            >
              <Camera className="h-4 w-4" /> Câmera
            </button>
            <button
              type="button"
              onClick={() => { setShowOptions(false); inputRef.current?.click() }}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm hover:bg-accent transition-colors"
            >
              <ImageIcon className="h-4 w-4" /> Galeria
            </button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

// ─── Main Drawer ──────────────────────────────────────────────────────────────

const EMPTY_VEHICLE_PHOTOS: (Photo | undefined)[] = [undefined, undefined, undefined, undefined]
const EMPTY_CHANCELA_PHOTOS: (Photo | undefined)[] = [undefined, undefined]

export function AppointmentDetailDrawer({
  appointment,
  open,
  onClose,
  onEdit,
  onCancel,
  canEdit = true,
  canCancel = true,
  canGenerateOS = true,
}: AppointmentDetailDrawerProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  // "Ver OS" abre a O.S. na tela de Conferência — exige permissão do módulo
  const canViewConference = useCanView('conference')

  // Step state
  const [step, setStep] = useState<DrawerStep>('detail')

  // Lightbox das fotos da finalização (chancela/chassi)
  const [viewPhotoUrl, setViewPhotoUrl] = useState<string | null>(null)

  // Tela 2 — Generate OS
  const [vehiclePhotos, setVehiclePhotos] = useState<(Photo | undefined)[]>(EMPTY_VEHICLE_PHOTOS)
  const [notes, setNotes] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)

  // Tela 4 — Finalize OS
  const [chancelaPhotos, setChancelaPhotos] = useState<(Photo | undefined)[]>(EMPTY_CHANCELA_PHOTOS)
  const [filmRollMap, setFilmRollMap] = useState<Record<number, number | undefined>>({})
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([])
  const [employeesPopoverOpen, setEmployeesPopoverOpen] = useState(false)
  const [isFinalizing, setIsFinalizing] = useState(false)

  const generateOS = useGenerateOS()
  const finalizeOS = useFinalizeOS()

  // ── Reset on appointment change or close ─────────────────────────────────
  useEffect(() => {
    setStep('detail')
    setVehiclePhotos((prev) => {
      prev.forEach((p) => p && URL.revokeObjectURL(p.preview))
      return EMPTY_VEHICLE_PHOTOS.slice()
    })
    setNotes(appointment?.notes ?? '')
    setChancelaPhotos((prev) => {
      prev.forEach((p) => p && URL.revokeObjectURL(p.preview))
      return EMPTY_CHANCELA_PHOTOS.slice()
    })
    setFilmRollMap({})
    setSelectedEmployeeIds([])
    setViewPhotoUrl(null)
  }, [appointment?.id, open])

  // ── Keyboard / scroll lock ────────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Com o lightbox aberto, Esc fecha só o lightbox (tratado pelo Dialog)
      if (e.key === 'Escape' && open && !viewPhotoUrl) onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose, viewPhotoUrl])

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // ── Data queries ──────────────────────────────────────────────────────────
  const serviceIds = appointment?.service_ids ?? []
  const dept = appointment?.department ?? ''
  const isFilmDept = dept === 'film' || dept === 'security_film' || dept === 'ppf'
  const filmEntries = appointment?.film_entries ?? []

  const { data: allServicesData } = useQuery({
    queryKey: ['services', 'all-for-drawer'],
    queryFn: () => servicesService.list({ limit: 500 }),
    staleTime: 1000 * 60 * 10,
    enabled: serviceIds.length > 0 || isFilmDept,
  })

  const allServiceMap = useMemo<Record<number, ServiceItem>>(() => {
    const map: Record<number, ServiceItem> = {}
    for (const s of allServicesData?.items ?? []) map[s.id] = s
    return map
  }, [allServicesData])

  // Bobina obrigatória só para Película comum. PPF e Película de Segurança têm bobina opcional.
  const isPpfEntry = (fe: FilmEntryItem) => allServiceMap[fe.service_id]?.department === 'ppf'

  const { data: historyData } = useAppointmentHistory(appointment?.id ?? null)

  const { data: employees } = useQuery({
    queryKey: ['employees-for-finalize', appointment?.store_id],
    queryFn: () => employeesService.listByStore(appointment!.store_id),
    enabled: step === 'finalize' && !!appointment?.store_id,
    staleTime: 1000 * 60 * 5,
  })

  const filteredEmployees = isFilmDept
    ? (employees ?? []).filter(e => e.position === 'Instalador de Película')
    : (employees ?? [])

  const selectedServices = (allServicesData?.items ?? []).filter((s) =>
    serviceIds.includes(s.id)
  )

  // ── Photo capture handlers (must be before any early return) ────────────
  const handleCaptureVehicle = useCallback(async (index: number, file: File) => {
    try {
      const compressed = await compressImage(file, { maxWidth: 1920, maxHeight: 1080, quality: 0.85 })
      const preview = URL.createObjectURL(compressed)
      const photo: Photo = { id: generateId(), preview, compressed, uploaded: false, uploadProgress: 0 }
      setVehiclePhotos((prev) => {
        const next = [...prev]
        next[index] = photo
        return next
      })
    } catch (err) {
      logger.error('Erro ao comprimir imagem:', err)
      toast({ variant: 'destructive', title: 'Erro ao processar imagem', description: 'Tente novamente com outra foto.' })
    }
  }, [])

  const handleRemoveVehicle = useCallback((index: number) => {
    setVehiclePhotos((prev) => {
      const next = [...prev]
      if (next[index]) URL.revokeObjectURL(next[index]!.preview)
      next[index] = undefined
      return next
    })
  }, [])

  const handleCaptureChancela = useCallback(async (index: number, file: File) => {
    try {
      const compressed = await compressImage(file, { maxWidth: 1920, maxHeight: 1080, quality: 0.85 })
      const preview = URL.createObjectURL(compressed)
      const photo: Photo = { id: generateId(), preview, compressed, uploaded: false, uploadProgress: 0 }
      setChancelaPhotos((prev) => {
        const next = [...prev]
        next[index] = photo
        return next
      })
    } catch (err) {
      logger.error('Erro ao comprimir imagem chancela:', err)
      toast({ variant: 'destructive', title: 'Erro ao processar imagem', description: 'Tente novamente com outra foto.' })
    }
  }, [])

  const handleRemoveChancela = useCallback((index: number) => {
    setChancelaPhotos((prev) => {
      const next = [...prev]
      if (next[index]) URL.revokeObjectURL(next[index]!.preview)
      next[index] = undefined
      return next
    })
  }, [])

  // ── Early return after all hooks ──────────────────────────────────────────
  if (!appointment) return null

  const config = APPOINTMENT_STATUS_CONFIG[appointment.display_status]
  const deptLabel = DEPARTMENT_LABELS[appointment.department] ?? appointment.department
  const deptBadge = DEPARTMENT_BADGE_COLORS[appointment.department] ?? ''
  const isActive = appointment.status === 'scheduled' && !appointment.service_order_id
  const isInProgress = !!appointment.service_order_id &&
    (appointment.display_status === 'em_execucao' || appointment.display_status === 'atrasado')
  const isLinkedToOS = !!appointment.service_order_id
  const isCancelled = appointment.display_status === 'cancelado'
  const hasServices = (appointment.film_entries?.length ?? 0) > 0 || (appointment.service_ids?.length ?? 0) > 0

  // ── Generate OS handler ───────────────────────────────────────────────────
  const handleSubmitGenerateOS = async () => {
    const filledPhotos = vehiclePhotos.filter(Boolean) as Photo[]
    if (filledPhotos.length < 1) return
    setIsGenerating(true)
    try {
      const uploaded = await uploadService.uploadPhotos(filledPhotos)
      const photoUrls = uploaded.map((u) => u.url)
      generateOS.mutate(
        {
          id: appointment.id,
          payload: { photos: photoUrls, notes: notes.trim() || undefined },
        },
        {
          onSuccess: () => {
            onClose()
          },
          onSettled: () => setIsGenerating(false),
        }
      )
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro no upload', description: getApiErrorMessage(err as Error, 'Falha ao enviar fotos.') })
      setIsGenerating(false)
    }
  }

  // ── Finalize OS handler ───────────────────────────────────────────────────
  const handleSubmitFinalize = async () => {
    if (!appointment.service_order_id) return
    const filledChancela = chancelaPhotos.filter(Boolean) as Photo[]
    if (filledChancela.length < 1) {
      toast({ variant: 'destructive', title: 'Foto obrigatoria', description: 'Adicione pelo menos 1 foto da chancela.' })
      return
    }
    if (appointment.department === 'film' && filmEntries.filter((fe) => !isPpfEntry(fe)).some((fe) => !filmRollMap[fe.service_id])) {
      toast({ variant: 'destructive', title: 'Bobina obrigatoria', description: 'Selecione uma bobina para cada película.' })
      return
    }
    if (selectedEmployeeIds.length === 0) {
      toast({ variant: 'destructive', title: 'Funcionário obrigatorio', description: 'Selecione pelo menos um funcionário para finalizar.' })
      return
    }
    setIsFinalizing(true)
    try {
      const uploaded = await uploadService.uploadPhotos(filledChancela)
      const photoUrls = uploaded.map((u) => u.url)
      const assignments = Object.entries(filmRollMap)
        .filter(([, rollId]) => rollId !== undefined)
        .map(([serviceId, rollId]) => ({ service_id: Number(serviceId), film_roll_id: rollId! }))
      finalizeOS.mutate(
        {
          serviceOrderId: appointment.service_order_id,
          payload: {
            completion_photos: photoUrls,
            film_roll_assignments: assignments,
            employee_ids: selectedEmployeeIds,
          },
        },
        {
          onSuccess: () => {
            onClose()
          },
          onSettled: () => setIsFinalizing(false),
        }
      )
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro no upload', description: getApiErrorMessage(err as Error, 'Falha ao enviar fotos.') })
      setIsFinalizing(false)
    }
  }

  // ── Derived counts ────────────────────────────────────────────────────────
  const vehicleFilledCount = vehiclePhotos.filter(Boolean).length
  const chancelaFilledCount = chancelaPhotos.filter(Boolean).length

  // ── Render ────────────────────────────────────────────────────────────────
  return createPortal(
    <>
      {/* Overlay */}
      <div
        ref={overlayRef}
        className={cn(
          'fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        className={cn(
          'fixed right-0 top-0 h-dvh z-[201] w-full max-w-md bg-white dark:bg-zinc-900 shadow-2xl',
          'flex flex-col transition-transform duration-300 ease-in-out'
        )}
        style={{ transform: open ? 'translateX(0)' : 'translateX(100%)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Detalhes do agendamento"
      >
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b dark:border-zinc-700 flex-shrink-0"
          style={{ borderLeftColor: config.color, borderLeftWidth: 4 }}
        >
          <div className="flex items-center gap-2">
            <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', deptBadge)}>
              {deptLabel}
            </span>
            <span
              className="text-xs font-semibold rounded-full px-2 py-0.5"
              style={{ backgroundColor: `${config.color}20`, color: config.color }}
            >
              {config.label}
            </span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7" aria-label="Fechar">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* ── Step: detail ─────────────────────────────────────────────────── */}
        {step === 'detail' && (
          <>
            <div className="flex-1 overflow-y-auto">
              <div className="px-4 py-4 space-y-4">
                {/* Vehicle info */}
                <div className="space-y-3">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-xl font-bold text-gray-900 dark:text-white tracking-wider">
                      {appointment.vehicle_plate}
                    </span>
                    {appointment.vehicle_model && (
                      <span className="text-sm text-gray-600 dark:text-gray-300">
                        {appointment.vehicle_model}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Row label="Cor" value={appointment.vehicle_color} />
                    <Row label="Loja" value={appointment.store_name} />
                    <Row
                      label="Data do servico"
                      value={appointment.delivery_time
                        ? `${formatDate(appointment.delivery_date)} às ${appointment.delivery_time}`
                        : formatDate(appointment.delivery_date)
                      }
                    />
                    <Row label="OS Concessionaria" value={appointment.external_os_number} />
                    <Row label="Consultor" value={appointment.consultant_name} />
                    {/* Badges na linha do consultor, alinhados à direita */}
                    {(appointment.is_galpon || appointment.is_courtesy || appointment.is_return) && (
                      <div className="flex flex-wrap items-end justify-end content-end gap-1.5">
                        {appointment.is_galpon && (
                          <span className="inline-flex items-center text-xs bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 rounded-md px-2 py-0.5 border border-orange-200 dark:border-orange-700">
                            Galpao
                          </span>
                        )}
                        {appointment.is_courtesy && (
                          <span className="inline-flex items-center text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 rounded-md px-2 py-0.5 border border-purple-200 dark:border-purple-700">
                            Cortesia
                          </span>
                        )}
                        {appointment.is_return && (
                          <span className="inline-flex items-center text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-md px-2 py-0.5 border border-blue-200 dark:border-blue-700">
                            Retorno
                          </span>
                        )}
                      </div>
                    )}
                    {!appointment.film_entries?.length && appointment.film_tonality && (
                      <Row label="Tonalidade" value={appointment.film_tonality} />
                    )}
                  </div>
                </div>

                {/* Películas — film/ppf dept: prioriza film_entries, fallback p/ service_ids */}
                {isFilmDept && (filmEntries.length > 0 || selectedServices.length > 0) && (
                  <div className="rounded-lg border dark:border-zinc-700 p-3 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      Películas
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {filmEntries.length > 0
                        ? filmEntries.map((fe) => {
                            const svc = (allServicesData?.items ?? []).find((s) => s.id === fe.service_id)
                            const baseLabel = fe.service_name
                              ? `${fe.service_code ? `[${fe.service_code}] ` : ''}${fe.service_name}`
                              : (svc ? `${svc.code ? `[${svc.code}] ` : ''}${svc.name}` : `Serviço #${fe.service_id}`)
                            const label = `${baseLabel}${fe.tonality ? ` — ${fe.tonality}` : ''}`
                            return (
                              <span
                                key={fe.service_id}
                                className="inline-flex flex-col items-start text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-md px-2 py-0.5 border border-blue-200 dark:border-blue-800"
                              >
                                <span>{label}</span>
                                {/* Bobina utilizada (atribuída no Finalizar da O.S.) */}
                                {fe.film_roll_code && (
                                  <span className="font-mono text-[11px] opacity-80">
                                    {fe.film_roll_code}
                                  </span>
                                )}
                              </span>
                            )
                          })
                        : selectedServices.map((svc) => (
                            <span
                              key={svc.id}
                              className="inline-flex items-center text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-md px-2 py-0.5 border border-blue-200 dark:border-blue-800"
                            >
                              {svc.code ? `[${svc.code}] ` : ''}{svc.name}
                              {appointment.film_tonality ? ` — ${appointment.film_tonality}` : ''}
                            </span>
                          ))}
                    </div>
                  </div>
                )}

                {/* Serviços — apenas para departamentos não-film */}
                {!isFilmDept && selectedServices.length > 0 && (
                  <div className="rounded-lg border dark:border-zinc-700 p-3 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      Serviços
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedServices.map((svc) => (
                        <span
                          key={svc.id}
                          className="inline-flex items-center text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-md px-2 py-0.5 border border-blue-200 dark:border-blue-800"
                        >
                          {svc.code ? `[${svc.code}] ` : ''}{svc.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Aviso de serviços ausentes */}
                {isActive && !hasServices && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-3 py-2.5">
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      Este agendamento não possui serviços configurados. Edite o agendamento para adicionar os serviços antes de gerar a O.S.
                    </p>
                  </div>
                )}

                {/* Vehicle photos — only shown on isActive (Tela 2) */}
                {isActive && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Fotos do Veiculo <span className="text-destructive">*</span>
                      </Label>
                      <span
                        className={cn(
                          'text-xs font-medium',
                          vehicleFilledCount >= 1 ? 'text-green-600' : 'text-muted-foreground'
                        )}
                      >
                        {vehicleFilledCount}/1 minimo
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {vehiclePhotos.map((photo, i) => (
                        <PhotoSlot
                          key={i}
                          photo={photo}
                          index={i}
                          onCapture={handleCaptureVehicle}
                          onRemove={handleRemoveVehicle}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes field — only on isActive (Tela 2) */}
                {isActive && (
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="drawer-notes"
                      className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      Observacoes
                    </Label>
                    <Textarea
                      id="drawer-notes"
                      placeholder="Observacoes adicionais para a O.S. (opcional)"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      className="resize-none text-sm border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 focus-visible:ring-[#F5A800]"
                    />
                  </div>
                )}

                {/* Saved notes (displayed when not active) — fallback para as
                    observações da O.S. (incluem as digitadas ao Gerar O.S.) */}
                {!isActive && (appointment.notes || appointment.service_order_notes) && (
                  <div className="rounded-lg border dark:border-zinc-700 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                      Observacoes
                    </p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                      {appointment.notes || appointment.service_order_notes}
                    </p>
                  </div>
                )}

                {/* Fotos da finalização da O.S. (chancela/chassi) */}
                {!!appointment.completion_photos?.length && (
                  <div className="rounded-lg border dark:border-zinc-700 p-3 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      Fotos da Finalizacao
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {appointment.completion_photos.map((url, i) => (
                        <button
                          key={url}
                          type="button"
                          onClick={() => setViewPhotoUrl(url)}
                          className="aspect-square rounded-md overflow-hidden border dark:border-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5A800]"
                          aria-label={`Ampliar foto da finalizacao ${i + 1}`}
                        >
                          <img
                            src={url}
                            alt={`Foto da finalizacao ${i + 1}`}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* History */}
                <div className="rounded-lg border dark:border-zinc-700 p-3 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <History className="h-3.5 w-3.5 text-gray-400" />
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      Historico
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <Clock className="h-3 w-3 flex-shrink-0" />
                    <span>Criado em {formatDateTime(appointment.created_at)}</span>
                  </div>
                  {historyData && historyData.items.length > 0 && (
                    <div className="space-y-1.5 mt-1">
                      {historyData.items.map((entry) => {
                        const changes = renderChanges(entry.old_value, entry.new_value)
                        return (
                          <div
                            key={entry.id}
                            className="flex flex-col gap-0.5 pl-4 border-l-2 border-gray-200 dark:border-zinc-600"
                          >
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="font-semibold text-gray-700 dark:text-gray-300">
                                {ACTION_LABELS[entry.action] ?? entry.action}
                              </span>
                              {entry.user_name && (
                                <span className="text-gray-500 dark:text-gray-400">
                                  por {entry.user_name}
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-gray-400 dark:text-gray-500">
                              {formatDateTime(entry.created_at)}
                              {changes ? ` — ${changes}` : ''}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Footer: detail step ─────────────────────────────────────── */}
            {!isCancelled && (
              <div className="flex-shrink-0 border-t dark:border-zinc-700 px-4 pt-3 flex flex-col gap-2" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}>
                {/* Tela 2: active (agendado, no OS) */}
                {isActive && (
                  <>
                    {canGenerateOS && (
                      <Button
                        className="w-full font-semibold"
                        style={{ backgroundColor: '#F5A800', color: '#000' }}
                        onClick={handleSubmitGenerateOS}
                        disabled={isGenerating || vehicleFilledCount < 1 || !hasServices}
                      >
                        {isGenerating ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Gerando...
                          </>
                        ) : (
                          <>
                            <Zap className="h-4 w-4 mr-2" />
                            Gerar O.S.
                          </>
                        )}
                      </Button>
                    )}
                    <div className="flex gap-2">
                      {canEdit && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onEdit(appointment)}
                          className="flex items-center gap-1.5"
                        >
                          <Edit className="h-3.5 w-3.5" />
                          Editar
                        </Button>
                      )}
                      {canCancel && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onCancel(appointment)}
                          className="flex items-center gap-1.5 text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-700 dark:hover:bg-red-900/20"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Cancelar
                        </Button>
                      )}
                    </div>
                  </>
                )}

                {/* Tela 3: in progress (OS gerada, em execucao) */}
                {isInProgress && (
                  <>
                    <Button
                      className="w-full font-semibold bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => setStep('finalize')}
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Finalizar
                    </Button>
                    {canCancel && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onCancel(appointment)}
                        className="self-start flex items-center gap-1.5 text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-700 dark:hover:bg-red-900/20"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Cancelar
                      </Button>
                    )}
                  </>
                )}

                {/* Linked but not in progress (e.g. completed) — abre a O.S. na
                    Conferência; sem permissão do módulo, o botão não aparece */}
                {isLinkedToOS && !isInProgress && !isActive && appointment.service_order_id
                  && canViewConference && (
                  <Link
                    to={`/conference?os=${appointment.service_order_id}`}
                    onClick={onClose}
                  >
                    <Button
                      size="sm"
                      className="flex items-center gap-1.5"
                      style={{ backgroundColor: '#F5A800', color: '#000' }}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Ver OS
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Step: finalize (Tela 4) ──────────────────────────────────────── */}
        {step === 'finalize' && (
          <>
            <div className="flex-1 overflow-y-auto">
              <div className="px-4 py-4 space-y-4">
                {/* Vehicle summary */}
                <div className="space-y-3">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-xl font-bold text-gray-900 dark:text-white tracking-wider">
                      {appointment.vehicle_plate}
                    </span>
                    {appointment.vehicle_model && (
                      <span className="text-sm text-gray-600 dark:text-gray-300">
                        {appointment.vehicle_model}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Row label="Cor" value={appointment.vehicle_color} />
                    <Row label="Loja" value={appointment.store_name} />
                    <Row
                      label="Data do servico"
                      value={appointment.delivery_time
                        ? `${formatDate(appointment.delivery_date)} às ${appointment.delivery_time}`
                        : formatDate(appointment.delivery_date)
                      }
                    />
                    <Row label="OS Concessionaria" value={appointment.external_os_number} />
                    {appointment.consultant_name && (
                      <Row label="Consultor" value={appointment.consultant_name} />
                    )}
                  </div>
                </div>

                {/* Chancela photos */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Foto da chancela <span className="text-destructive">*</span>
                    </Label>
                    <span
                      className={cn(
                        'text-xs font-medium',
                        chancelaFilledCount >= 1 ? 'text-green-600' : 'text-muted-foreground'
                      )}
                    >
                      {chancelaFilledCount}/1 minimo
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {chancelaPhotos.map((photo, i) => (
                      <PhotoSlot
                        key={i}
                        photo={photo}
                        index={i}
                        onCapture={handleCaptureChancela}
                        onRemove={handleRemoveChancela}
                      />
                    ))}
                  </div>
                </div>

                {/* Film roll selectors — only for film/ppf depts with entries */}
                {isFilmDept && filmEntries.length > 0 && (
                  <div className="space-y-3">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Bobinas
                    </Label>
                    {filmEntries.map((fe) => (
                      <FilmRollSelector
                        key={fe.service_id}
                        storeId={appointment.store_id}
                        isGalpon={appointment.is_galpon}
                        department={dept}
                        serviceId={fe.service_id}
                        tonality={fe.tonality}
                        serviceName={buildServiceLabel(fe, allServiceMap)}
                        filmTypeId={fe.film_type_id ?? appointment.film_type_id ?? undefined}
                        value={filmRollMap[fe.service_id]}
                        onChange={(rollId) =>
                          setFilmRollMap((prev) => ({ ...prev, [fe.service_id]: rollId }))
                        }
                        required={appointment.department === 'film' && !isPpfEntry(fe)}
                        showLabel={true}
                      />
                    ))}
                  </div>
                )}

                {/* Employee selector */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Funcionarios <span className="text-destructive">*</span>
                  </Label>
                  <Popover open={employeesPopoverOpen} onOpenChange={setEmployeesPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={employeesPopoverOpen}
                        className="w-full justify-between font-normal"
                      >
                        <span className="truncate">
                          {selectedEmployeeIds.length === 0
                            ? 'Selecionar funcionario...'
                            : `${selectedEmployeeIds.length} funcionário(s) selecionado(s)`}
                        </span>
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-1" align="start">
                      <div className="max-h-48 overflow-y-auto space-y-0.5">
                        {filteredEmployees.length === 0 ? (
                          <p className="px-2 py-1.5 text-sm text-muted-foreground">Nenhum funcionário disponível</p>
                        ) : (
                          filteredEmployees.map((emp) => {
                            const isSelected = selectedEmployeeIds.includes(emp.id)
                            return (
                              <button
                                key={emp.id}
                                type="button"
                                onClick={() =>
                                  setSelectedEmployeeIds((prev) =>
                                    isSelected ? prev.filter((id) => id !== emp.id) : [...prev, emp.id]
                                  )
                                }
                                className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 cursor-pointer hover:bg-accent select-none text-left transition-colors"
                              >
                                <div className={cn(
                                  'w-4 h-4 rounded-sm border-2 flex items-center justify-center shrink-0',
                                  isSelected ? 'border-[#F5A800] bg-[#F5A800]' : 'border-[#D1D1D1] dark:border-[#555555]'
                                )}>
                                  {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                                </div>
                                <span className="text-sm">{emp.name}{emp.last_name ? ` ${emp.last_name}` : ''}</span>
                              </button>
                            )
                          })
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>

            {/* ── Footer: finalize step ───────────────────────────────────── */}
            <div className="flex-shrink-0 border-t dark:border-zinc-700 px-4 pt-3 flex flex-col gap-2" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}>
              <Button
                className="w-full font-semibold bg-green-600 hover:bg-green-700 text-white"
                onClick={handleSubmitFinalize}
                disabled={
                  isFinalizing ||
                  chancelaFilledCount < 1 ||
                  selectedEmployeeIds.length === 0 ||
                  (appointment.department === 'film' && filmEntries.filter((fe) => !isPpfEntry(fe)).some((fe) => !filmRollMap[fe.service_id]))
                }
              >
                {isFinalizing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Finalizando...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Confirmar e Finalizar
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep('detail')}
                className="self-start"
              >
                Cancelar
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Lightbox das fotos da finalização */}
      {viewPhotoUrl && (
        <PhotoDialog url={viewPhotoUrl} open={!!viewPhotoUrl} onClose={() => setViewPhotoUrl(null)} />
      )}
    </>,
    document.body
  )
}
