import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, ExternalLink, Edit, XCircle, Zap, Clock, History, Camera, ImageIcon, Loader2, CheckCircle, Check, ChevronDown, Link2, Wrench } from 'lucide-react'
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
import { useFinalizeRules } from '@/hooks/useFinalizeRules'
import { useCanView } from '@/hooks/useMyPermissions'
import { FilmRollSelector } from './FilmRollSelector'
import { ServiceInstallerSelect } from '@/components/features/service-orders/ServiceInstallerSelect'
import { CameraCapture } from '@/components/common/CameraCapture'
import { PhotoDialog } from '@/components/common/PhotoDialog'
import { compressImage } from '@/utils/imageCompression'
import { validateImageFile } from '@/utils/fileValidation'
import { generateId } from '@/utils/generateId'
import { logger } from '@/lib/logger'
import type { Appointment, FilmEntryItem } from '@/types/scheduling.types'
import type { Photo } from '@/types/photo.types'
import type { ServiceItem } from '@/services/api/services.service'
import { useFormDraft } from '@/hooks/useFormDraft'
import { DraftRestoredBanner } from '@/components/common/DraftRestoredBanner'
import { cleanConsultantNotes } from '@/utils/serviceOrderNotes'

// ─── Step type ────────────────────────────────────────────────────────────────

type DrawerStep = 'detail' | 'finalize'

// ─── Rascunho local (localStorage) do step "finalize" ──────────────────────────
// Chave única — 1 rascunho por vez, restaurado só quando `appointmentId` casa
// com o agendamento aberto no momento (evita vazar o rascunho de finalização
// de um agendamento em outro). Nunca inclui fotos (chancelaPhotos/vehiclePhotos).
const FINALIZE_DRAFT_KEY = 'aems-draft:finalize'

interface FinalizeDraftState {
  appointmentId: number | null
  filmRollMap: Record<string, number | undefined>
  scrapMap: Record<string, boolean>
  installerMap: Record<number, number[]>
  selectedEmployeeIds: number[]
}

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
  onOpenSibling?: (id: number) => void
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

const EXECUTION_NOTES_MAX_LENGTH = 2000

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

// ─── Slots de bobina no Finalizar ─────────────────────────────────────────────
// Item de tonalidade única = 1 slot (tonality null, comportamento legado).
// Item com tonalidades por região (applications) = 1 slot POR tonalidade distinta.

interface RollSlot {
  entry: FilmEntryItem
  tonality: string | null
  regions: string[]
}

function rollSlotKey(serviceId: number, tonality: string | null): string {
  return `${serviceId}|${tonality ?? ''}`
}

function buildRollSlots(entries: FilmEntryItem[]): RollSlot[] {
  return entries.flatMap((fe): RollSlot[] => {
    const apps = fe.applications ?? []
    if (apps.length === 0) return [{ entry: fe, tonality: null, regions: [] }]
    const byTonality = new Map<string, string[]>()
    for (const app of apps) {
      if (!app.tonality) continue
      const regions = byTonality.get(app.tonality) ?? []
      if (app.region) regions.push(app.region)
      byTonality.set(app.tonality, regions)
    }
    return [...byTonality.entries()].map(([tonality, regions]) => ({
      entry: fe,
      tonality,
      regions,
    }))
  })
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
  onOpenSibling,
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
  const [isGenerating, setIsGenerating] = useState(false)

  // Tela 4 — Finalize OS
  const [chancelaPhotos, setChancelaPhotos] = useState<(Photo | undefined)[]>(EMPTY_CHANCELA_PHOTOS)
  // Chave composta `${service_id}|${tonality}` — itens multi-tonalidade têm
  // um slot de bobina por tonalidade; legados usam tonality vazia
  const [filmRollMap, setFilmRollMap] = useState<Record<string, number | undefined>>({})
  const [scrapMap, setScrapMap] = useState<Record<string, boolean>>({})
  // installerMap: service_id → employee_ids (para depts film/security_film/ppf;
  // mais de um instalador no mesmo serviço divide a produção igualmente)
  const [installerMap, setInstallerMap] = useState<Record<number, number[]>>({})
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([])
  const [employeesPopoverOpen, setEmployeesPopoverOpen] = useState(false)
  const [isFinalizing, setIsFinalizing] = useState(false)
  // Relato técnico do instalador na finalização — visível na Conferência.
  const [executionNotes, setExecutionNotes] = useState('')

  const generateOS = useGenerateOS()
  const finalizeOS = useFinalizeOS()

  // ── Reset on appointment change or close ─────────────────────────────────
  useEffect(() => {
    setStep('detail')
    setVehiclePhotos((prev) => {
      prev.forEach((p) => p && URL.revokeObjectURL(p.preview))
      return EMPTY_VEHICLE_PHOTOS.slice()
    })
    setChancelaPhotos((prev) => {
      prev.forEach((p) => p && URL.revokeObjectURL(p.preview))
      return EMPTY_CHANCELA_PHOTOS.slice()
    })
    setFilmRollMap({})
    setScrapMap({})
    setInstallerMap({})
    setSelectedEmployeeIds([])
    setExecutionNotes('')
    setViewPhotoUrl(null)
  }, [appointment?.id, open])

  // ─── Rascunho local (localStorage) do step finalize ──────────────────────
  // Habilitado só ao entrar no step "finalize" — o efeito acima já zerou os
  // maps ao abrir/trocar de agendamento; quando o rascunho é compatível
  // (mesmo appointmentId), ele hidrata os maps por cima do estado zerado.
  const finalizeDraftValue = useMemo<FinalizeDraftState>(() => ({
    appointmentId: appointment?.id ?? null,
    filmRollMap,
    scrapMap,
    installerMap,
    selectedEmployeeIds,
  }), [appointment?.id, filmRollMap, scrapMap, installerMap, selectedEmployeeIds])

  const { discard: discardFinalizeDraft, restored: finalizeDraftRestored } = useFormDraft<FinalizeDraftState>({
    key: FINALIZE_DRAFT_KEY,
    enabled: open && step === 'finalize',
    value: finalizeDraftValue,
    onRestore: (draft) => {
      if (draft.appointmentId !== (appointment?.id ?? null)) return false
      setFilmRollMap(draft.filmRollMap)
      setScrapMap(draft.scrapMap)
      setInstallerMap(draft.installerMap)
      setSelectedEmployeeIds(draft.selectedEmployeeIds)
      return true
    },
    // Só persiste quando há seleção REAL — checa o valor, não só a presença da
    // chave: togglar retalho ou limpar bobina/instalador deixa `{chave: false}`
    // / `{chave: []}` / `{chave: undefined}` residual, que não deve gravar um
    // rascunho semanticamente vazio (senão o banner reaparece num finalize limpo).
    shouldPersist: (v) =>
      Object.values(v.filmRollMap).some((r) => r != null) ||
      Object.values(v.scrapMap).some(Boolean) ||
      Object.values(v.installerMap).some((ids) => ids.length > 0) ||
      v.selectedEmployeeIds.length > 0,
  })

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
  // Owner pode finalizar sem foto da chancela e sem bobina (limpeza de backlog).
  // Regras centralizadas em useFinalizeRules (paridade com o FinalizeOSModal).
  // Backend também isenta o Owner; instalador segue obrigatório para todos.
  const { isOwner, requiredPhotos: requiredChancela, isRollRequired } = useFinalizeRules()
  const filmEntries = appointment?.film_entries ?? []
  const rollSlots = useMemo(() => buildRollSlots(filmEntries), [filmEntries])

  const { data: allServicesData } = useQuery({
    queryKey: ['services', 'all-for-drawer'],
    // limit 1000 = teto do endpoint; catálogo completo (com 500 já ficavam serviços de fora)
    queryFn: () => servicesService.list({ limit: 1000 }),
    staleTime: 1000 * 60 * 10,
    enabled: serviceIds.length > 0 || isFilmDept,
  })

  const allServiceMap = useMemo<Record<number, ServiceItem>>(() => {
    const map: Record<number, ServiceItem> = {}
    for (const s of allServicesData?.items ?? []) map[s.id] = s
    return map
  }, [allServicesData])

  // Bobina obrigatória só para Película comum. PPF e Película de Segurança têm bobina opcional.
  // Serviço fora do mapa (catálogo ainda carregando etc.) herda o departamento da O.S. —
  // na dúvida, EXIGE a bobina em vez de liberar.
  // Categoria efetiva do item: a do serviço (catálogo) e, na dúvida, a da O.S.
  const effectiveCategory = (fe: FilmEntryItem) =>
    allServiceMap[fe.service_id]?.department ?? dept
  const isRollRequiredEntry = (fe: FilmEntryItem) =>
    isRollRequired(effectiveCategory(fe))

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
  // isActive: sem O.S. vinculada — mostra formulário de fotos + botão Gerar O.S.
  const isActive = appointment.status === 'scheduled' && !appointment.service_order_id
  // isEditable: pode abrir o formulário de edição — permitido enquanto a O.S. não está
  // finalizada/cancelada (o backend aceita edição mesmo com O.S. gerada em andamento)
  const isEditable =
    appointment.display_status !== 'finalizado' &&
    appointment.display_status !== 'cancelado'
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
          payload: { photos: photoUrls, notes: appointment.notes?.trim() || undefined },
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

  // Bobina obrigatória: falta quando o slot exige bobina e nem filme nem
  // retalho (scrap) foram selecionados. Compartilhado entre a validação do
  // handler e o `disabled` do botão para não divergir (recalcula a cada render).
  const hasMissingRequiredRoll = rollSlots
    .filter((slot) => isRollRequiredEntry(slot.entry))
    .some((slot) => {
      const key = rollSlotKey(slot.entry.service_id, slot.tonality)
      return !filmRollMap[key] && !scrapMap[key]
    })

  // ── Finalize OS handler ───────────────────────────────────────────────────
  const handleSubmitFinalize = async () => {
    if (!appointment.service_order_id) return
    const filledChancela = chancelaPhotos.filter(Boolean) as Photo[]
    if (filledChancela.length < requiredChancela) {
      toast({ variant: 'destructive', title: 'Foto obrigatoria', description: 'Adicione pelo menos 1 foto da chancela.' })
      return
    }
    if (hasMissingRequiredRoll) {
      toast({ variant: 'destructive', title: 'Bobina obrigatoria', description: 'Selecione uma bobina para cada película (e cada tonalidade).' })
      return
    }
    // Validação de instalador: para film/security_film/ppf cada serviço precisa
    // de um instalador. P1 (auditoria): departamentos NÃO-película não exigem
    // funcionário para finalizar — igual ao FinalizeOSModal e ao backend
    // (finalize_service_order). Antes o drawer travava a finalização de estética
    // sem funcionário, divergindo do caminho da tela de O.S.
    if (isFilmDept) {
      const filmDeptEntries = filmEntries.length > 0
        ? filmEntries
        : (appointment.service_ids ?? []).map((id) => ({ service_id: id }))
      const missingInstaller = filmDeptEntries.some(
        (fe) => (installerMap[fe.service_id]?.length ?? 0) === 0
      )
      if (missingInstaller) {
        toast({ variant: 'destructive', title: 'Instalador obrigatório', description: 'Selecione um instalador para cada serviço.' })
        return
      }
    }
    setIsFinalizing(true)
    try {
      const uploaded = await uploadService.uploadPhotos(filledChancela)
      const photoUrls = uploaded.map((u) => u.url)
      const assignments = rollSlots
        .map((slot) => {
          const key = rollSlotKey(slot.entry.service_id, slot.tonality)
          return {
            slot,
            rollId: filmRollMap[key],
            isScrap: scrapMap[key] ?? false
          }
        })
        .filter(({ rollId, isScrap }) => rollId !== undefined || isScrap)
        .map(({ slot, rollId, isScrap }) => ({
          service_id: slot.entry.service_id,
          used_scrap: isScrap,
          ...(isScrap ? {} : { film_roll_id: rollId! }),
          ...(slot.tonality ? { tonality: slot.tonality } : {}),
        }))

      // Para film/security_film/ppf: employee_assignments por serviço
      // Para demais depts: employee_ids (multi-select geral)
      const employeeAssignments = isFilmDept
        ? Object.entries(installerMap)
            .filter(([, employeeIds]) => employeeIds.length > 0)
            .map(([serviceId, employeeIds]) => ({
              service_id: Number(serviceId),
              employee_ids: employeeIds,
            }))
        : undefined

      finalizeOS.mutate(
        {
          serviceOrderId: appointment.service_order_id,
          payload: {
            completion_photos: photoUrls,
            film_roll_assignments: assignments,
            employee_ids: isFilmDept ? [] : selectedEmployeeIds,
            ...(employeeAssignments ? { employee_assignments: employeeAssignments } : {}),
            // Vazio = omitir (preserva relato já gravado, ex.: pelo editor da Conferência)
            ...(executionNotes.trim() ? { execution_notes: executionNotes.trim() } : {}),
          },
        },
        {
          onSuccess: () => {
            discardFinalizeDraft()
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
  // Briefing do consultor (copiado para a O.S. ao gerar) — exibido read-only
  // acima do relato técnico do instalador, na finalização.
  const consultantBriefing = cleanConsultantNotes(appointment.notes || appointment.service_order_notes)

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
                            const hasApplications = !!fe.applications && fe.applications.length > 0
                            const label = hasApplications
                              ? baseLabel
                              : `${baseLabel}${fe.tonality ? ` — ${fe.tonality}` : ''}`
                            return (
                              <span
                                key={fe.service_id}
                                className="inline-flex flex-col items-start text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-md px-2 py-0.5 border border-blue-200 dark:border-blue-800"
                              >
                                <span>{label}</span>
                                {/* Tonalidades por região — destaque para o instalador */}
                                {hasApplications &&
                                  fe.applications!.map((app, appIdx) => (
                                    <span key={appIdx} className="font-semibold">
                                      {app.tonality}
                                      {app.region ? ` — ${app.region}` : ''}
                                      {app.film_roll_code && (
                                        <span className="font-mono font-normal text-[11px] opacity-80 ml-1">
                                          ({app.film_roll_code})
                                        </span>
                                      )}
                                    </span>
                                  ))}
                                {/* Bobina utilizada (atribuída no Finalizar da O.S.) */}
                                {!hasApplications && fe.film_roll_code && (
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

                {/* Observações — SOMENTE LEITURA. A alteração é feita exclusivamente
                    pelo botão "Editar" (abre o AppointmentForm). Fallback para as
                    observações da O.S. (incluem as digitadas ao Gerar O.S.) */}
                {(appointment.notes || appointment.service_order_notes) && (
                  <div className="rounded-lg border dark:border-zinc-700 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                      Observações
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

                {/* Agendamentos vinculados (mesmo grupo combinado) */}
                {(appointment.group_siblings?.length ?? 0) > 0 && (
                  <div className="rounded-lg border dark:border-zinc-700 p-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Link2 className="h-3.5 w-3.5 text-violet-500" />
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                        Agendamentos vinculados (mesmo carro)
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      {appointment.group_siblings!.map((sibling) => {
                        const siblingDeptLabel = DEPARTMENT_LABELS[sibling.department] ?? sibling.department
                        const siblingDeptBadge = DEPARTMENT_BADGE_COLORS[sibling.department] ?? 'bg-gray-100 text-gray-700'
                        const siblingStatusConfig = APPOINTMENT_STATUS_CONFIG[sibling.display_status]
                        return (
                          <button
                            key={sibling.id}
                            type="button"
                            onClick={() => onOpenSibling?.(sibling.id)}
                            className="w-full flex items-center justify-between gap-2 rounded-md border dark:border-zinc-600 px-2.5 py-2 bg-white dark:bg-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-700/50 transition-colors text-left group"
                            aria-label={`Abrir agendamento de ${siblingDeptLabel}`}
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={cn(
                                  'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                                  siblingDeptBadge
                                )}
                              >
                                {siblingDeptLabel}
                              </span>
                              <span
                                className="text-[10px] font-semibold rounded-full px-2 py-0.5"
                                style={{
                                  backgroundColor: `${siblingStatusConfig.color}20`,
                                  color: siblingStatusConfig.color,
                                }}
                              >
                                {siblingStatusConfig.label}
                              </span>
                              {sibling.service_order_id && (
                                <span className="text-[10px] text-muted-foreground">
                                  O.S. #{sibling.service_order_id}
                                </span>
                              )}
                            </div>
                            <ExternalLink className="h-3 w-3 text-muted-foreground group-hover:text-gray-700 dark:group-hover:text-gray-300 shrink-0 transition-colors" />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
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

                {/* Tela 3: in progress (OS gerada, em execucao / atrasado) */}
                {isInProgress && (
                  <>
                    <Button
                      className="w-full font-semibold bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => setStep('finalize')}
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Finalizar
                    </Button>
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
                          className="self-start flex items-center gap-1.5 text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-700 dark:hover:bg-red-900/20"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Cancelar
                        </Button>
                      )}
                    </div>
                  </>
                )}

                {/* Tela com OS gerada mas não em execução nem terminal (ex.: duplicidade) */}
                {isLinkedToOS && !isInProgress && !isActive && isEditable && (
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
                {finalizeDraftRestored && (
                  <DraftRestoredBanner
                    onDiscard={() => { discardFinalizeDraft(); setFilmRollMap({}); setScrapMap({}); setInstallerMap({}); setSelectedEmployeeIds([]) }}
                  />
                )}
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

                {isOwner && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                    Como proprietário, foto da chancela e bobina são opcionais nesta finalização.
                  </div>
                )}
                {/* Chancela photos */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Foto da chancela {!isOwner && <span className="text-destructive">*</span>}
                    </Label>
                    {isOwner ? (
                      <span className="text-xs font-medium text-muted-foreground">opcional</span>
                    ) : (
                      <span
                        className={cn(
                          'text-xs font-medium',
                          chancelaFilledCount >= 1 ? 'text-green-600' : 'text-muted-foreground'
                        )}
                      >
                        {chancelaFilledCount}/1 minimo
                      </span>
                    )}
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
                    {rollSlots.map((slot) => {
                      const key = rollSlotKey(slot.entry.service_id, slot.tonality)
                      const baseLabel = buildServiceLabel(
                        slot.tonality ? { ...slot.entry, tonality: slot.tonality } : slot.entry,
                        allServiceMap
                      )
                      const label = slot.regions.length > 0
                        ? `${baseLabel} (${slot.regions.join(', ')})`
                        : baseLabel
                      return (
                        <FilmRollSelector
                          key={key}
                          storeId={appointment.store_id}
                          isGalpon={appointment.is_galpon}
                          department={dept}
                          serviceId={slot.entry.service_id}
                          tonality={slot.tonality ?? slot.entry.tonality}
                          serviceName={label}
                          filmTypeId={slot.entry.film_type_id ?? appointment.film_type_id ?? undefined}
                          value={filmRollMap[key]}
                          onChange={(rollId) =>
                            setFilmRollMap((prev) => ({ ...prev, [key]: rollId }))
                          }
                          usedScrap={scrapMap[key] ?? false}
                          onUsedScrapChange={(v) =>
                            setScrapMap((prev) => ({ ...prev, [key]: v }))
                          }
                          allowNoRoll={effectiveCategory(slot.entry) !== 'film'}
                          showLabel={true}
                        />
                      )
                    })}
                  </div>
                )}

                {/* Employee selector — por serviço para film/security_film/ppf; multi-select para demais */}
                {isFilmDept ? (
                  <div className="space-y-3">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Instaladores <span className="text-destructive">*</span>
                    </Label>
                    {(filmEntries.length > 0
                      ? filmEntries
                      : (appointment.service_ids ?? []).map((id) => ({ service_id: id, service_name: null, service_code: null, tonality: null, film_type_id: null }))
                    ).map((fe) => (
                      <ServiceInstallerSelect
                        key={fe.service_id}
                        label={buildServiceLabel(fe as FilmEntryItem, allServiceMap)}
                        employees={filteredEmployees}
                        value={installerMap[fe.service_id] ?? []}
                        onChange={(ids) =>
                          setInstallerMap((prev) => ({ ...prev, [fe.service_id]: ids }))
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Funcionários <span className="text-destructive">*</span>
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
                              ? 'Selecionar funcionário...'
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
                )}

                {/* Relato técnico do instalador (opcional) */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Wrench className="h-3.5 w-3.5" aria-hidden />
                    Relato técnico (opcional)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Registre avarias prévias, dificuldades na aplicação ou qualquer ocorrência da execução. Visível para a conferência.
                  </p>
                  {consultantBriefing && (
                    <div className="space-y-1">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                        Briefing do Consultor
                      </span>
                      <div className="max-h-24 overflow-y-auto rounded-md border border-[#D1D1D1] bg-muted/40 px-3 py-2 text-sm text-muted-foreground whitespace-pre-wrap dark:border-[#333333]">
                        {consultantBriefing}
                      </div>
                    </div>
                  )}
                  <Textarea
                    value={executionNotes}
                    onChange={(e) => setExecutionNotes(e.target.value.slice(0, EXECUTION_NOTES_MAX_LENGTH))}
                    rows={3}
                    maxLength={EXECUTION_NOTES_MAX_LENGTH}
                    placeholder="Ex.: risco pré-existente na porta traseira esquerda; borracha do vidro ressecada."
                    className="resize-none text-sm"
                  />
                  <div className="text-right text-[11px] text-muted-foreground">
                    {executionNotes.length}/{EXECUTION_NOTES_MAX_LENGTH}
                  </div>
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
                  chancelaFilledCount < requiredChancela ||
                  // P1 (auditoria): instalador obrigatório só para película; estética
                  // não exige funcionário (paridade com FinalizeOSModal/backend).
                  (isFilmDept &&
                    (filmEntries.length > 0 ? filmEntries : (appointment.service_ids ?? []).map((id) => ({ service_id: id }))).some((fe) => (installerMap[fe.service_id]?.length ?? 0) === 0)) ||
                  hasMissingRequiredRoll
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
                onClick={() => { discardFinalizeDraft(); setStep('detail') }}
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
