import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Plus, Link2, Check, Search } from 'lucide-react'
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
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCreateAppointment, useUpdateAppointment, useAppointmentCapacity, useCreateCombinedAppointment, useAddDepartments } from '@/hooks/useScheduling'
import { useVehicleModels } from '@/hooks/useVehicleModels'
import { consultantsService } from '@/services/api/consultants.service'
import { servicesService } from '@/services/api/services.service'
import { inventoryService } from '@/services/api/inventory.service'
import { serviceOrdersService } from '@/services/api/service-orders.service'
import type { FilmType } from '@/services/api/inventory.service'
import { VISIBLE_DEPARTMENT_LABELS, HIDDEN_SCHEDULING_DEPARTMENTS, visibleDepartmentEntries, getTonalityOptions, FILM_REGION_SUGGESTIONS } from '@/constants/scheduling'
import { cn } from '@/lib/utils'
import type { Appointment, CreateAppointmentPayload, FilmApplication, FilmEntryItem } from '@/types/scheduling.types'
import type { Store } from '@/services/api/stores.service'
import { ServiceCodeCombobox } from '@/components/features/service-orders/ServiceCodeCombobox'
import { isValidPlateOrChassi, PLATE_ERROR_MESSAGE } from '@/utils/plate'
import { DismissibleNotice } from '@/components/common/DismissibleNotice'
import { DuplicateAlert } from '@/components/features/service-orders/DuplicateAlert'
import { useDuplicateCheck } from '@/hooks/useDuplicateCheck'
import { useFormDraft } from '@/hooks/useFormDraft'
import { DraftRestoredBanner } from '@/components/common/DraftRestoredBanner'
import { CATALOG_STALE_TIME, CATALOG_GC_TIME, consultantsKey, filmTypesKey } from '@/lib/catalog-queries'

const baseSchema = z.object({
  store_id: z.string().min(1, 'Selecione a loja'),
  department: z.string(),
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
  original_service_order_id: z.number().optional(),
})

/**
 * Constrói o schema completo (objeto base + validação condicional) parametrizado
 * por `isOwner`. Regra "retorno sem O.S. de origem" (mesma do QuickCreateModal):
 * - Não-Owner: origem continua obrigatória (comportamento histórico).
 * - Owner: pode deixar a origem vazia, mas a Observação (`notes`) passa a ser
 *   obrigatória (motivo do lançamento retroativo/sem origem no sistema).
 * O backend espelha esta mesma regra (403/422) — aqui é só UX antecipada.
 */
function buildAppointmentSchema(isOwner: boolean) {
  return baseSchema.superRefine((data, ctx) => {
    if (!data.is_galpon && !data.consultant_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Consultor obrigatório',
        path: ['consultant_id'],
      })
    }
    if (data.courtesy_type === 'retorno' && !data.original_service_order_id) {
      if (!isOwner) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Selecione a O.S. de origem do retorno',
          path: ['original_service_order_id'],
        })
      } else if (!data.notes?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Informe a observação (motivo) ao lançar um retorno sem O.S. de origem.',
          path: ['notes'],
        })
      }
    }
  })
}

type FormData = z.infer<typeof baseSchema>

/** Chave do rascunho local (localStorage) — 1 rascunho por vez, compartilhado
 *  entre criação e edição; o `mode`/`appointmentId` decide se ele é compatível
 *  com o contexto atual antes de ser restaurado. */
const APPOINTMENT_DRAFT_KEY = 'aems-draft:appointment-form'

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

// ─── RegionSuggestInput ───────────────────────────────────────────────────────
// Input de texto livre com sugestões de região em popover estilizado (substitui
// o <datalist> nativo, que renderiza o dropdown preto do navegador).

interface RegionSuggestInputProps {
  value: string
  onChange: (value: string) => void
}

function RegionSuggestInput({ value, onChange }: RegionSuggestInputProps) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const term = value.trim().toLowerCase()
  const suggestions = term
    ? FILM_REGION_SUGGESTIONS.filter((r) => r.toLowerCase().includes(term))
    : FILM_REGION_SUGGESTIONS
  // Já digitou exatamente uma sugestão → nada a sugerir
  const hasSuggestions = suggestions.length > 0 && !(suggestions.length === 1 && suggestions[0].toLowerCase() === term)

  return (
    <Popover open={open && hasSuggestions} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'Tab') setOpen(false)
          }}
          placeholder="Região (ex.: Portas dianteiras)"
          maxLength={60}
          className="h-8 text-xs"
          aria-label="Região do carro"
          autoComplete="off"
        />
      </PopoverAnchor>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-1 bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333]"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          // Clique de volta no próprio input não fecha (deixa o onFocus cuidar)
          if (e.target === inputRef.current) e.preventDefault()
        }}
      >
        <div className="max-h-48 overflow-y-auto">
          {suggestions.map((region) => (
            <button
              key={region}
              type="button"
              // onMouseDown para vencer o blur do input antes do click
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(region)
                setOpen(false)
              }}
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs text-[#111111] dark:text-white hover:bg-[#F5F5F5] dark:hover:bg-[#2A2A2A] transition-colors text-left"
            >
              {region}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface FilmEntryLocal extends FilmEntryItem {
  service_name: string
  service_code: string | null
  film_roll_id: number | null
  film_type_id?: number
}

interface ServiceSelectionState {
  serviceIds: number[]
  filmEntries: FilmEntryLocal[]
}

const EMPTY_SELECTION: ServiceSelectionState = { serviceIds: [], filmEntries: [] }

/** Shape persistido no rascunho local (localStorage) do AppointmentForm. */
interface AppointmentDraftState {
  mode: 'new' | 'edit'
  appointmentId: number | null
  form: FormData
  serviceSelections: Record<string, ServiceSelectionState>
  isCombined: boolean
  combinedDepts: string[]
}

/**
 * Assinatura do CONTEÚDO do rascunho (sem `mode`/`appointmentId`) para diff
 * contra a baseline da abertura. Só grava quando isto muda — pega qualquer
 * edição do usuário (campos RHF, inclusive os setados via `setValue` sem
 * `shouldDirty`, E o estado não-RHF `serviceSelections`/combinado), sem
 * falso-positivo na EDIÇÃO (que abre com serviços pré-preenchidos). Mais
 * abrangente que `formState.isDirty`, que só latcha em campo registrado.
 */
function serializeAppointmentDraftContent(
  v: Pick<AppointmentDraftState, 'form' | 'serviceSelections' | 'isCombined' | 'combinedDepts'>
): string {
  return JSON.stringify({
    form: v.form,
    serviceSelections: v.serviceSelections,
    isCombined: v.isCombined,
    combinedDepts: v.combinedDepts,
  })
}

// ─── DepartmentServicesSection ────────────────────────────────────────────────
// Subcomponente extraído: encapsula todo o picker de serviços por departamento.
// Mantém a lógica de picker pendente (película) e multi-select (outros depts)
// internamente, emitindo mudanças via onChange.

interface DepartmentServicesSectionProps {
  department: string
  storeBrandId?: number
  storeId?: string
  isCourtesyAppointment: boolean
  value: ServiceSelectionState
  onChange: (v: ServiceSelectionState) => void
  /** Label exibido no topo da seção (modo combinado). Omitir no modo simples. */
  sectionTitle?: string
}

function DepartmentServicesSection({
  department,
  storeBrandId,
  storeId,
  isCourtesyAppointment,
  value,
  onChange,
  sectionTitle,
}: DepartmentServicesSectionProps) {
  const isFilmDept = department === 'film' || department === 'security_film' || department === 'ppf'
  const requiresTonality = department === 'film' || department === 'security_film'

  const [pendingFilmServiceId, setPendingFilmServiceId] = useState<string>('')
  const [pendingFilmTonality, setPendingFilmTonality] = useState<string>('')
  const [pendingFilmTypeId, setPendingFilmTypeId] = useState<string>('')
  const [serviceError, setServiceError] = useState<string | null>(null)

  // Resetar picker quando o departamento muda
  useEffect(() => {
    setPendingFilmServiceId('')
    setPendingFilmTonality('')
    setPendingFilmTypeId('')
    setServiceError(null)
  }, [department])

  const { data: servicesData } = useQuery({
    queryKey: ['services', { department, brand_id: storeBrandId }],
    queryFn: () => servicesService.list({ department, brand_id: storeBrandId, is_active: true }),
    enabled: !!department && !!storeBrandId,
    staleTime: 1000 * 60 * 10,
  })

  const { data: ppfBrandsData } = useQuery({
    // Realinhado para a fábrica compartilhada (lib/catalog-queries.ts): a
    // mesma chave já era usada pelo FilmPicker (ConferencePage/
    // QuickCreateModal) — unifica o cache e permite que o prefetch de hover
    // (lib/prefetch-order-edit.ts) alimente as duas telas.
    queryKey: filmTypesKey('ppf'),
    queryFn: () => inventoryService.listFilmTypes({ department: 'ppf', limit: 100 }),
    enabled: department === 'ppf',
    staleTime: CATALOG_STALE_TIME,
    gcTime: CATALOG_GC_TIME,
  })

  // Tipos de película do departamento (film/security_film) para restringir
  // as tonalidades ofertadas às configuradas em "Tipos de Película".
  // Realinhado para a mesma chave do FilmPicker ('film-types-for-os', dept)
  // — antes era 'film-types-tonality', uma chave própria com a MESMA
  // queryFn/params; unificar não muda o dado, só o cache compartilhado.
  const { data: filmTypesData } = useQuery({
    queryKey: filmTypesKey(department as 'film' | 'security_film'),
    queryFn: () =>
      inventoryService.listFilmTypes({
        department: department as 'film' | 'security_film',
        limit: 100,
      }),
    enabled: requiresTonality,
    staleTime: CATALOG_STALE_TIME,
    gcTime: CATALOG_GC_TIME,
  })

  const ppfBrands: FilmType[] = ppfBrandsData?.items ?? []
  const allServices = servicesData?.items ?? []
  const filmTypesForTonality: FilmType[] = useMemo(() => filmTypesData?.items ?? [], [filmTypesData])

  // União das tonalidades configuradas nos tipos que incluem o serviço.
  // Vazio → getTonalityOptions cai no fallback por departamento (todas).
  const tonalitiesForService = useCallback(
    (serviceId?: number | null): string[] => {
      if (!serviceId) return []
      const set = new Set<string>()
      for (const ft of filmTypesForTonality) {
        if ((ft.services ?? []).some((s) => s.service_id === serviceId)) {
          for (const t of ft.available_tonalities ?? []) set.add(t)
        }
      }
      return Array.from(set)
    },
    [filmTypesForTonality]
  )

  const sortByLabel = (a: { code?: string | null; name: string }, b: { code?: string | null; name: string }) => {
    const la = `${a.code ?? ''} ${a.name}`.trim().toLowerCase()
    const lb = `${b.code ?? ''} ${b.name}`.trim().toLowerCase()
    return la.localeCompare(lb, 'pt-BR')
  }

  const filmServiceOptions = isFilmDept
    ? allServices
        .filter((s) => !value.filmEntries.some((e) => e.service_id === s.id))
        .filter((s) => isCourtesyAppointment || !s.is_courtesy_only)
        .sort(sortByLabel)
    : []

  const availableServices = isFilmDept
    ? []
    : allServices
        .filter((s) => !value.serviceIds.includes(s.id))
        .filter((s) => isCourtesyAppointment || !s.is_courtesy_only)
        .sort(sortByLabel)

  const selectedServices = isFilmDept
    ? []
    : allServices.filter((s) => value.serviceIds.includes(s.id))

  const addService = (idStr: string) => {
    const id = Number(idStr)
    if (!value.serviceIds.includes(id)) {
      onChange({ ...value, serviceIds: [...value.serviceIds, id] })
      setServiceError(null)
    }
  }

  const removeService = (id: number) => {
    onChange({ ...value, serviceIds: value.serviceIds.filter((x) => x !== id) })
  }

  const addFilmEntry = () => {
    if (!pendingFilmServiceId) return
    const svc = allServices.find((s) => s.id === Number(pendingFilmServiceId))
    if (!svc) return
    if (requiresTonality && !pendingFilmTonality) {
      setServiceError('Selecione a tonalidade da película')
      return
    }
    const newEntry: FilmEntryLocal = {
      service_id: svc.id,
      tonality: pendingFilmTonality || null,
      service_name: svc.name,
      service_code: svc.code ?? null,
      film_roll_id: null,
      film_type_id: pendingFilmTypeId ? Number(pendingFilmTypeId) : undefined,
    }
    onChange({ ...value, filmEntries: [...value.filmEntries, newEntry] })
    setPendingFilmServiceId('')
    setPendingFilmTonality('')
    setPendingFilmTypeId('')
    setServiceError(null)
  }

  const removeFilmEntry = (serviceId: number) => {
    onChange({ ...value, filmEntries: value.filmEntries.filter((e) => e.service_id !== serviceId) })
  }

  const updateEntry = useCallback((serviceId: number, patch: Partial<FilmEntryLocal>) => {
    onChange({
      ...value,
      filmEntries: value.filmEntries.map((e) =>
        e.service_id === serviceId ? { ...e, ...patch } : e
      ),
    })
  }, [value, onChange])

  const enableRegions = (entry: FilmEntryLocal) => {
    updateEntry(entry.service_id, {
      applications: [
        { tonality: entry.tonality ?? '', region: '' },
        { tonality: '', region: '' },
      ],
    })
  }

  const updateApplication = (
    entry: FilmEntryLocal,
    index: number,
    patch: Partial<FilmApplication>
  ) => {
    const next = (entry.applications ?? []).map((app, i) =>
      i === index ? { ...app, ...patch } : app
    )
    updateEntry(entry.service_id, { applications: next })
    setServiceError(null)
  }

  const addApplication = (entry: FilmEntryLocal) => {
    updateEntry(entry.service_id, {
      applications: [...(entry.applications ?? []), { tonality: '', region: '' }],
    })
  }

  const removeApplication = (entry: FilmEntryLocal, index: number) => {
    const next = (entry.applications ?? []).filter((_, i) => i !== index)
    if (next.length <= 1) {
      updateEntry(entry.service_id, {
        applications: null,
        tonality: next[0]?.tonality || entry.tonality || null,
      })
      return
    }
    updateEntry(entry.service_id, { applications: next })
  }

  return (
    <div className="rounded-lg border dark:border-zinc-700 p-3 bg-gray-50 dark:bg-zinc-800/30 space-y-3">
      {sectionTitle && (
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
          {sectionTitle}
        </p>
      )}

      {isFilmDept ? (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Películas
          </p>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1 min-w-0">
              <FieldLabel htmlFor={`film_service_pick_${department}`}>Serviço</FieldLabel>
              <ServiceCodeCombobox
                services={filmServiceOptions}
                value={Number(pendingFilmServiceId) || 0}
                onChange={setPendingFilmServiceId}
                placeholder={filmServiceOptions.length === 0 ? 'Nenhum disponível' : 'Selecione o serviço'}
                disabled={filmServiceOptions.length === 0}
              />
            </div>

            <div className="flex gap-2 items-end">
              {(department === 'film' || department === 'security_film') && (
                <div className="flex-1 sm:flex-initial sm:w-28">
                  <FieldLabel htmlFor={`film_tonality_pick_${department}`} required>Tonalidade</FieldLabel>
                  <Select
                    value={pendingFilmTonality}
                    onValueChange={(v) => {
                      setPendingFilmTonality(v)
                      setServiceError(null)
                    }}
                  >
                    <SelectTrigger id={`film_tonality_pick_${department}`}>
                      <SelectValue placeholder="G05..." />
                    </SelectTrigger>
                    <SelectContent>
                      {getTonalityOptions({ serviceCode: filmServiceOptions.find(s => s.id === Number(pendingFilmServiceId))?.code, department, availableTonalities: tonalitiesForService(Number(pendingFilmServiceId)) }).map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {department === 'ppf' && (
                <div className="flex-1 sm:flex-initial sm:w-40">
                  <FieldLabel htmlFor={`film_type_pick_${department}`}>Marca PPF</FieldLabel>
                  <Select value={pendingFilmTypeId} onValueChange={setPendingFilmTypeId}>
                    <SelectTrigger id={`film_type_pick_${department}`}>
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

          {value.filmEntries.length > 0 && (
            <div className="space-y-2 pt-1">
              {value.filmEntries.map((entry, idx) => {
                const hasRegions = !!entry.applications && entry.applications.length > 0
                const tonalityOptions = getTonalityOptions({
                  serviceCode: entry.service_code,
                  department,
                  availableTonalities: tonalitiesForService(entry.service_id),
                })
                return (
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
                      {!hasRegions && entry.tonality && <span className="text-muted-foreground ml-1">— {entry.tonality}</span>}
                      {entry.film_type_id && (() => {
                        const brand = ppfBrands.find(ft => ft.id === entry.film_type_id)
                        return brand ? <span className="text-muted-foreground ml-1">— {brand.name}</span> : null
                      })()}
                    </p>

                    {requiresTonality && hasRegions && (
                      <div className="space-y-1.5">
                        {entry.applications!.map((app, appIdx) => (
                          <div key={appIdx} className="flex items-center gap-1.5">
                            <Select
                              value={app.tonality || ''}
                              onValueChange={(v) => updateApplication(entry, appIdx, { tonality: v })}
                            >
                              <SelectTrigger className="w-24 h-8 text-xs shrink-0" aria-label="Tonalidade da região">
                                <SelectValue placeholder="G05..." />
                              </SelectTrigger>
                              <SelectContent>
                                {tonalityOptions.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <RegionSuggestInput
                              value={app.region ?? ''}
                              onChange={(region) => updateApplication(entry, appIdx, { region })}
                            />
                            <button
                              type="button"
                              onClick={() => removeApplication(entry, appIdx)}
                              className="text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                              aria-label="Remover região"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => addApplication(entry)}
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          tonalidade
                        </Button>
                      </div>
                    )}

                    {requiresTonality && !hasRegions && (
                      <button
                        type="button"
                        onClick={() => enableRegions(entry)}
                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                      >
                        Tonalidades diferentes por região do carro?
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {serviceError && (
            <p className="text-xs text-red-500">{serviceError}</p>
          )}

          {!storeBrandId && (
            <p className="text-xs text-muted-foreground">Selecione a loja para ver os serviços disponíveis.</p>
          )}
        </>
      ) : (
        <>
          <FieldLabel htmlFor={`service_select_${department}`}>Serviços</FieldLabel>

          {!storeId ? (
            <p className="text-xs text-muted-foreground py-1">Selecione a loja primeiro.</p>
          ) : availableServices.length > 0 ? (
            <Select onValueChange={addService} value="">
              <SelectTrigger id={`service_select_${department}`}>
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

          {serviceError && (
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
        </>
      )}
    </div>
  )
}

// ─── AppointmentForm ──────────────────────────────────────────────────────────

export function AppointmentForm({ open, onClose, appointment, stores }: AppointmentFormProps) {
  const isEdit = !!appointment
  const createMutation = useCreateAppointment()
  const createCombinedMutation = useCreateCombinedAppointment()
  const updateMutation = useUpdateAppointment()
  const addDepartmentsMutation = useAddDepartments()

  // Departamento do agendamento em edição (travado no modo combinado).
  const editingDept = appointment && !HIDDEN_SCHEDULING_DEPARTMENTS.includes(appointment.department)
    ? appointment.department
    : ''
  const effectivePermissions = useAuthStore((s) => s.effectivePermissions)
  const isGalponProfile = effectivePermissions?.is_galpon_profile === true
  const hideGalponOption = effectivePermissions?.hide_galpon_option === true
  const galponLocked = isGalponProfile && !isEdit

  // Regra "retorno sem O.S. de origem": Owner pode agendar retorno sem origem
  // (observação vira obrigatória); demais perfis seguem exigindo a origem.
  const isOwnerFn = useAuthStore((s) => s.isOwner)
  const isOwner = isOwnerFn()
  const appointmentSchema = useMemo(() => buildAppointmentSchema(isOwner), [isOwner])

  // Departamentos disponíveis respeitando a restrição do perfil de acesso.
  // Em edição, mantém o departamento atual mesmo que fora da lista permitida.
  const departmentEntries = useMemo(() => {
    const entries = visibleDepartmentEntries(effectivePermissions?.scheduling_departments)
    if (isEdit && editingDept && !entries.some(([v]) => v === editingDept)) {
      return [...entries, [editingDept, VISIBLE_DEPARTMENT_LABELS[editingDept] ?? editingDept] as [string, string]]
    }
    return entries
  }, [effectivePermissions?.scheduling_departments, isEdit, editingDept])

  // Quando o perfil restringe a exatamente um departamento, já pré-seleciona
  // no modo normal (criação).
  const soleAllowedDepartment =
    (effectivePermissions?.scheduling_departments?.length === 1
      ? effectivePermissions.scheduling_departments[0]
      : '')

  // Modo combinado: só na criação
  const [isCombined, setIsCombined] = useState(false)
  // Departamentos selecionados no modo combinado
  const [combinedDepts, setCombinedDepts] = useState<string[]>([])

  // Estado de serviços POR departamento: Record<department, ServiceSelectionState>
  const [serviceSelections, setServiceSelections] = useState<Record<string, ServiceSelectionState>>({})

  // Erro de validação de serviços (modo normal)
  const [serviceError, setServiceError] = useState<string | null>(null)

  // ─── Sugestão de O.S. de origem (campo Retorno) ───────────────────────────
  type ReturnOriginSuggestion = {
    id: number
    order_number: string | null
    external_os_number: string | null
    service_date: string | null
    services: string[]
  }
  const [originSuggestion, setOriginSuggestion] = useState<ReturnOriginSuggestion | null>(null)
  const [originLoadingPlate, setOriginLoadingPlate] = useState<string | null>(null)
  const [originConfirmed, setOriginConfirmed] = useState(false)
  const [originChanging, setOriginChanging] = useState(false)
  const [originInputValue, setOriginInputValue] = useState('')

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(appointmentSchema),
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
      original_service_order_id: undefined,
    },
  })

  const selectedStoreId = watch('store_id')
  const selectedDepartment = watch('department')
  const isGalpon = watch('is_galpon')
  const courtesyType = watch('courtesy_type')
  // Snapshot completo do form — usado só para compor o rascunho local (autosave).
  // `watch()` sem argumento devolve um objeto NOVO a cada render; serializar dá
  // uma dependência estável para o memo abaixo, senão o autosave re-agendaria o
  // debounce a cada render (virando "400ms após o último render" em vez de "após
  // a última mudança") e sob renders frequentes o rascunho nunca persistiria.
  const formSnapshot = watch()
  const serializedFormSnapshot = JSON.stringify(formSnapshot)
  // Assinatura do conteúdo "limpo" da abertura — o gate do rascunho grava só
  // quando o conteúdo atual diverge desta baseline. Definida em `populateForm`
  // (base) e em `onRestore` (rascunho restaurado vira a nova baseline).
  const draftBaselineRef = useRef<string | null>(null)

  const isFilmDept =
    selectedDepartment === 'film' ||
    selectedDepartment === 'security_film' ||
    selectedDepartment === 'ppf'

  const isCourtesyAppointment = courtesyType === 'cortesia'

  // Helper para ler/escrever o slice do departamento atual
  const getCurrentSelection = (): ServiceSelectionState =>
    serviceSelections[selectedDepartment] ?? EMPTY_SELECTION

  const setCurrentSelection = (v: ServiceSelectionState) => {
    setServiceSelections((prev) => ({ ...prev, [selectedDepartment]: v }))
  }

  const getCombinedSelection = (dept: string): ServiceSelectionState =>
    serviceSelections[dept] ?? EMPTY_SELECTION

  const setCombinedSelection = (dept: string) => (v: ServiceSelectionState) => {
    setServiceSelections((prev) => ({ ...prev, [dept]: v }))
  }

  // Fetch consultants filtered by store — chave realinhada para a mesma
  // fábrica de useConsultants (ConferencePage/EditServiceOrderPage): antes
  // usava um filtro sem `is_active` e sem page/pageSize no array da
  // queryKey, o que a deixava fora da mesma entrada de cache. Unificar
  // permite que o prefetch de hover (lib/prefetch-order-edit.ts) alimente as
  // 3 telas com uma única chamada.
  const consultantsFilters = selectedStoreId ? { store_id: Number(selectedStoreId), is_active: true } : undefined
  const { data: consultantsData } = useQuery({
    queryKey: consultantsKey(consultantsFilters, 1, 100),
    queryFn: () => consultantsService.list(consultantsFilters!, 1, 100),
    enabled: !!selectedStoreId,
    staleTime: CATALOG_STALE_TIME,
    gcTime: CATALOG_GC_TIME,
  })

  // Resolve brand_id from selected store
  const selectedStoreBrandId = selectedStoreId
    ? stores.find((s) => s.id === Number(selectedStoreId))?.brand_id
    : undefined

  // Fetch vehicle models filtered by store brand
  const { data: vehicleModelsData } = useVehicleModels({
    brand_id: selectedStoreBrandId,
    active_only: true,
  })

  const consultants = consultantsData?.consultants ?? []
  const vehicleModels = vehicleModelsData ?? []

  const deliveryDate = watch('delivery_date')
  const watchedPlate = watch('vehicle_plate')

  // Departamento efetivo para restringir a O.S. de origem do retorno. No modo
  // combinado usa o primeiro departamento (mesma simplificação do duplicateCheck).
  const returnOriginDept = isCombined ? (combinedDepts[0] ?? '') : selectedDepartment

  // Busca sugestão de O.S. de origem quando courtesy_type='retorno' e placa é válida
  useEffect(() => {
    const plate = (watchedPlate ?? '').toUpperCase().trim()
    const isReturn = courtesyType === 'retorno'
    if (!isReturn || !plate || !isValidPlateOrChassi(plate)) {
      setOriginSuggestion(null)
      setOriginConfirmed(false)
      setOriginChanging(false)
      setOriginInputValue('')
      setValue('original_service_order_id', undefined)
      return
    }
    if (originConfirmed) return // já confirmado — não sobrescrever com nova busca
    setOriginLoadingPlate(plate)
    const storeId = selectedStoreId ? Number(selectedStoreId) : undefined
    serviceOrdersService
      .suggestReturnOrigin(plate, undefined, storeId, returnOriginDept || undefined)
      .then((suggestion) => {
        setOriginSuggestion(suggestion)
        setOriginLoadingPlate(null)
      })
      .catch(() => {
        setOriginSuggestion(null)
        setOriginLoadingPlate(null)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courtesyType, watchedPlate, selectedStoreId, returnOriginDept])

  // Trocar a loja muda a MARCA-base da O.S. de origem: um vínculo já confirmado para
  // a marca anterior deixa de valer e seria descartado silenciosamente no backend.
  // Reseta o estado para forçar nova busca/confirmação (paridade com o mobile).
  const prevStoreRef = useRef(selectedStoreId)
  useEffect(() => {
    // Só reseta numa troca genuína entre duas lojas reais. A 1ª hidratação
    // (''→loja), inclusive a de edição que repõe o vínculo existente, apenas
    // registra a loja — senão apagaria o original_service_order_id restaurado.
    if (!prevStoreRef.current || prevStoreRef.current === selectedStoreId) {
      prevStoreRef.current = selectedStoreId
      return
    }
    prevStoreRef.current = selectedStoreId
    setOriginSuggestion(null)
    setOriginConfirmed(false)
    setOriginChanging(false)
    setOriginInputValue('')
    setValue('original_service_order_id', undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreId])

  // Trocar o DEPARTAMENTO invalida um vínculo de origem já confirmado (a busca é
  // estrita por departamento). Reseta o estado para forçar nova busca/confirmação.
  const prevReturnDeptRef = useRef(returnOriginDept)
  useEffect(() => {
    // 1ª hidratação (''→depto), inclusive a de edição, apenas registra o depto —
    // senão apagaria o original_service_order_id restaurado.
    if (!prevReturnDeptRef.current || prevReturnDeptRef.current === returnOriginDept) {
      prevReturnDeptRef.current = returnOriginDept
      return
    }
    prevReturnDeptRef.current = returnOriginDept
    setOriginSuggestion(null)
    setOriginConfirmed(false)
    setOriginChanging(false)
    setOriginInputValue('')
    setValue('original_service_order_id', undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnOriginDept])

  // useDuplicateCheck: no modo combinado, usa o primeiro departamento selecionado.
  // Simplificação aceitável — evita múltiplas queries simultâneas com resultados conflitantes.
  const duplicateCheckDept = isCombined ? (combinedDepts[0] ?? '') : selectedDepartment
  const duplicateCheckSelection = isCombined
    ? getCombinedSelection(duplicateCheckDept)
    : getCurrentSelection()
  const duplicateFilmEntries = duplicateCheckSelection.filmEntries
  const duplicateServiceIds: number[] =
    (duplicateCheckDept === 'film' || duplicateCheckDept === 'security_film' || duplicateCheckDept === 'ppf')
      ? duplicateFilmEntries.map((e) => e.service_id).filter((id) => id > 0)
      : duplicateCheckSelection.serviceIds

  const { data: duplicateData } = useDuplicateCheck({
    plate: (watchedPlate ?? '').toUpperCase().trim(),
    service_date: deliveryDate ?? '',
    department: duplicateCheckDept ?? '',
    service_ids: duplicateServiceIds,
    is_return: courtesyType === 'retorno',
    // Ao editar, ignora o próprio agendamento e a O.S. já gerada por ele — senão o
    // registro em edição acusaria a si mesmo como duplicidade.
    exclude_appointment_id: appointment?.id ?? null,
    exclude_service_order_id: appointment?.service_order_id ?? null,
  })

  // Capacity check
  const { data: capacityCount } = useAppointmentCapacity(
    selectedStoreId ? Number(selectedStoreId) : null,
    deliveryDate
  )

  // Popula o form com os dados-base do contexto atual (edição vs. criação) —
  // extraído para função reutilizável: o efeito de abertura chama uma vez, e
  // o botão "Descartar" do banner de rascunho chama de novo para devolver o
  // form ao estado-base (não ao vazio absoluto: em edição, volta aos dados
  // salvos do agendamento).
  const populateForm = () => {
    let baseForm: FormData
    let baseSelections: Record<string, ServiceSelectionState> = {}
    if (appointment) {
      baseForm = {
        store_id: String(appointment.store_id),
        department: HIDDEN_SCHEDULING_DEPARTMENTS.includes(appointment.department) ? '' : appointment.department,
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
        original_service_order_id: appointment.original_service_order_id ?? undefined,
      }
      reset(baseForm)
      // Pre-populate slice do departamento do agendamento
      const dept = HIDDEN_SCHEDULING_DEPARTMENTS.includes(appointment.department) ? '' : appointment.department
      if (dept) {
        baseSelections = {
          [dept]: {
            serviceIds: appointment.service_ids ?? [],
            filmEntries: (appointment.film_entries ?? []).map((fe) => ({
              ...fe,
              service_name: fe.service_name ?? '',
              service_code: fe.service_code ?? null,
              film_roll_id: fe.film_roll_id ?? null,
              film_type_id: fe.film_type_id ?? undefined,
            })),
          },
        }
      }
      setServiceSelections(baseSelections)
    } else {
      const today = new Date().toISOString().split('T')[0]
      baseForm = {
        store_id: stores.length === 1 ? String(stores[0].id) : '',
        department: soleAllowedDepartment,
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
        original_service_order_id: undefined,
      }
      reset(baseForm)
      setServiceSelections({})
    }
    setIsCombined(false)
    setCombinedDepts([])
    setServiceError(null)
    // Reset origin states whenever the dialog is opened/closed
    setOriginSuggestion(null)
    setOriginConfirmed(false)
    setOriginChanging(false)
    setOriginInputValue('')
    // Baseline p/ o gate do rascunho: estado "limpo" da abertura (criar = vazio;
    // editar = dados salvos do agendamento). O autosave só grava quando o
    // conteúdo diverge disto — captura edições reais sem regravar a base.
    draftBaselineRef.current = serializeAppointmentDraftContent({
      form: baseForm,
      serviceSelections: baseSelections,
      isCombined: false,
      combinedDepts: [],
    })
  }

  useEffect(() => {
    if (!open) return
    populateForm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ─── Rascunho local (localStorage) ────────────────────────────────────────
  // 1 rascunho por vez, compartilhado entre criação e edição — só é restaurado
  // quando o `mode`/`appointmentId` casa com o contexto atual (evita vazar o
  // rascunho de um agendamento em outro). Roda DEPOIS do efeito acima: quando
  // o rascunho é compatível, ele sobrescreve os valores base recém-aplicados.
  const appointmentDraftValue = useMemo<AppointmentDraftState>(() => ({
    mode: isEdit ? 'edit' : 'new',
    appointmentId: appointment?.id ?? null,
    form: formSnapshot,
    serviceSelections,
    isCombined,
    combinedDepts,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [isEdit, appointment?.id, serializedFormSnapshot, serviceSelections, isCombined, combinedDepts])

  const { discard: discardAppointmentDraft, restored: appointmentDraftRestored } = useFormDraft<AppointmentDraftState>({
    key: APPOINTMENT_DRAFT_KEY,
    enabled: open,
    value: appointmentDraftValue,
    onRestore: (draft) => {
      const compatible = isEdit
        ? draft.mode === 'edit' && draft.appointmentId === (appointment?.id ?? null)
        : draft.mode === 'new'
      if (!compatible) return false
      reset(draft.form)
      setServiceSelections(draft.serviceSelections)
      setIsCombined(draft.isCombined)
      setCombinedDepts(draft.combinedDepts)
      // O rascunho restaurado passa a ser a baseline: só re-grava se o usuário
      // editar por cima dele.
      draftBaselineRef.current = serializeAppointmentDraftContent(draft)
      return true
    },
    // Só persiste quando o conteúdo diverge da baseline da abertura — pega
    // qualquer edição real do usuário (campos RHF setados via register OU via
    // setValue sem shouldDirty, e o estado não-RHF de serviços/combinado), sem
    // regravar a base intocada nem reexibir o banner num form apenas aberto.
    shouldPersist: (v) =>
      draftBaselineRef.current !== null &&
      serializeAppointmentDraftContent(v) !== draftBaselineRef.current,
  })

  // Mapear film_entries para o payload (inclui applications)
  const buildFilmEntriesPayload = (entries: FilmEntryLocal[]) =>
    entries.map(({ service_id, tonality, film_roll_id, film_type_id, applications }) => ({
      service_id,
      tonality,
      film_roll_id: film_roll_id ?? undefined,
      film_type_id: film_type_id ?? undefined,
      applications:
        applications && applications.length > 0
          ? applications.map(({ tonality: appTonality, region }) => ({
              tonality: appTonality,
              region: region?.trim() || undefined,
            }))
          : undefined,
    }))

  // Validar serviços de um departamento
  const validateDeptSelection = (dept: string, sel: ServiceSelectionState): string | null => {
    const isDeptFilm = dept === 'film' || dept === 'security_film' || dept === 'ppf'
    const hasSvcs = isDeptFilm ? sel.filmEntries.length > 0 : sel.serviceIds.length > 0
    if (!hasSvcs) {
      const label = VISIBLE_DEPARTMENT_LABELS[dept] ?? dept
      return `Adicione ao menos um serviço para o departamento "${label}"`
    }
    const deptRequiresTonality = dept === 'film' || dept === 'security_film'
    if (
      deptRequiresTonality &&
      sel.filmEntries.some((e) =>
        e.applications && e.applications.length > 0
          ? e.applications.some((app) => !app.tonality)
          : !e.tonality
      )
    ) {
      const label = VISIBLE_DEPARTMENT_LABELS[dept] ?? dept
      return `Informe a tonalidade de todas as películas em "${label}" (incluindo cada região adicionada)`
    }
    return null
  }

  const onSubmit = (data: FormData) => {
    setServiceError(null)

    if (isCombined && !isEdit) {
      // Modo combinado com ≥2 departamentos: usa createCombined
      if (combinedDepts.length < 1) {
        setServiceError('Selecione ao menos um departamento')
        return
      }
      for (const dept of combinedDepts) {
        const sel = getCombinedSelection(dept)
        const err = validateDeptSelection(dept, sel)
        if (err) { setServiceError(err); return }
      }

      const departments = combinedDepts.map((dept) => {
        const sel = getCombinedSelection(dept)
        const isDeptFilm = dept === 'film' || dept === 'security_film' || dept === 'ppf'
        return {
          department: dept,
          service_ids: isDeptFilm ? sel.filmEntries.map((e) => e.service_id) : sel.serviceIds,
          film_entries: isDeptFilm && sel.filmEntries.length > 0
            ? buildFilmEntriesPayload(sel.filmEntries)
            : undefined,
        }
      })

      createCombinedMutation.mutate(
        {
          store_id: Number(data.store_id),
          delivery_date: data.delivery_date,
          delivery_time: data.delivery_time || undefined,
          vehicle_plate: data.vehicle_plate.toUpperCase(),
          external_os_number: data.external_os_number || undefined,
          vehicle_model: data.vehicle_model || undefined,
          vehicle_color: data.vehicle_color || undefined,
          consultant_id: data.consultant_id ? Number(data.consultant_id) : undefined,
          notes: data.notes || undefined,
          is_galpon: data.is_galpon,
          is_courtesy: data.courtesy_type === 'cortesia',
          is_return: data.courtesy_type === 'retorno',
          original_service_order_id: data.courtesy_type === 'retorno' ? data.original_service_order_id : undefined,
          departments,
        },
        { onSuccess: () => { discardAppointmentDraft(); onClose() } }
      )
      return
    }

    // Modo combinado na EDIÇÃO: atualiza o atual + cria irmãos para os novos deptos
    if (isCombined && isEdit && appointment) {
      const newDepts = combinedDepts.filter((d) => d !== editingDept)

      // Valida o departamento atual (editado) e os novos
      const curSel = getCombinedSelection(editingDept)
      const curErr = validateDeptSelection(editingDept, curSel)
      if (curErr) { setServiceError(curErr); return }
      for (const dept of newDepts) {
        const err = validateDeptSelection(dept, getCombinedSelection(dept))
        if (err) { setServiceError(err); return }
      }

      const isCurFilm =
        editingDept === 'film' || editingDept === 'security_film' || editingDept === 'ppf'

      const updatePayload: CreateAppointmentPayload = {
        store_id: Number(data.store_id),
        department: editingDept,
        delivery_date: data.delivery_date,
        delivery_time: data.delivery_time || undefined,
        vehicle_plate: data.vehicle_plate.toUpperCase(),
        external_os_number: data.external_os_number || undefined,
        vehicle_model: data.vehicle_model || undefined,
        vehicle_color: data.vehicle_color || undefined,
        consultant_id: data.consultant_id ? Number(data.consultant_id) : undefined,
        service_ids: isCurFilm
          ? curSel.filmEntries.map((e) => e.service_id)
          : curSel.serviceIds.length > 0 ? curSel.serviceIds : undefined,
        film_entries: isCurFilm && curSel.filmEntries.length > 0
          ? buildFilmEntriesPayload(curSel.filmEntries)
          : undefined,
        notes: data.notes || undefined,
        is_galpon: data.is_galpon,
        is_courtesy: data.courtesy_type === 'cortesia',
        is_return: data.courtesy_type === 'retorno',
        original_service_order_id: data.courtesy_type === 'retorno' ? data.original_service_order_id : undefined,
      }

      // 1) Atualiza o atual; 2) cria os irmãos (herdam os dados já atualizados)
      const createSiblings = () => {
        if (newDepts.length === 0) { discardAppointmentDraft(); onClose(); return }
        const departments = newDepts.map((dept) => {
          const sel = getCombinedSelection(dept)
          const isDeptFilm = dept === 'film' || dept === 'security_film' || dept === 'ppf'
          return {
            department: dept,
            service_ids: isDeptFilm ? sel.filmEntries.map((e) => e.service_id) : sel.serviceIds,
            film_entries: isDeptFilm && sel.filmEntries.length > 0
              ? buildFilmEntriesPayload(sel.filmEntries)
              : undefined,
          }
        })
        addDepartmentsMutation.mutate(
          { id: appointment.id, payload: { departments } },
          { onSuccess: () => { discardAppointmentDraft(); onClose() } }
        )
      }

      updateMutation.mutate(
        { id: appointment.id, payload: updatePayload },
        { onSuccess: createSiblings }
      )
      return
    }

    // Modo normal (1 departamento)
    if (!data.department) {
      setServiceError('Selecione o departamento')
      return
    }
    const sel = getCurrentSelection()
    const err = validateDeptSelection(data.department, sel)
    if (err) { setServiceError(err); return }

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
        ? sel.filmEntries.map((e) => e.service_id)
        : sel.serviceIds.length > 0 ? sel.serviceIds : undefined,
      film_entries: isFilmDept && sel.filmEntries.length > 0
        ? buildFilmEntriesPayload(sel.filmEntries)
        : undefined,
      notes: data.notes || undefined,
      is_galpon: data.is_galpon,
      is_courtesy: data.courtesy_type === 'cortesia',
      is_return: data.courtesy_type === 'retorno',
      original_service_order_id: data.courtesy_type === 'retorno' ? data.original_service_order_id : undefined,
    }

    if (isEdit && appointment) {
      updateMutation.mutate({ id: appointment.id, payload }, { onSuccess: () => { discardAppointmentDraft(); onClose() } })
    } else {
      createMutation.mutate(payload, { onSuccess: () => { discardAppointmentDraft(); onClose() } })
    }
  }

  const isSaving =
    createMutation.isPending ||
    updateMutation.isPending ||
    createCombinedMutation.isPending ||
    addDepartmentsMutation.isPending

  // Nº de departamentos novos (edição combinada)
  const newCombinedDepts = isEdit ? combinedDepts.filter((d) => d !== editingDept) : combinedDepts

  // Texto preview do modo combinado
  const combinedPreview = !isCombined
    ? null
    : isEdit
    ? newCombinedDepts.length > 0
      ? `O departamento atual será atualizado e serão criados ${newCombinedDepts.length} agendamento(s) combinado(s): ${newCombinedDepts.map((d) => VISIBLE_DEPARTMENT_LABELS[d] ?? d).join(' + ')} — mesmo carro ${watch('vehicle_plate') || '(placa não informada)'}`
      : null
    : combinedDepts.length >= 2
    ? `Serão criados ${combinedDepts.length} agendamentos: ${combinedDepts.map((d) => `1 de ${VISIBLE_DEPARTMENT_LABELS[d] ?? d}`).join(' + ')} — mesmo carro ${watch('vehicle_plate') || '(placa não informada)'}`
    : null

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

            {appointmentDraftRestored && (
              <DraftRestoredBanner onDiscard={() => { discardAppointmentDraft(); populateForm() }} />
            )}

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

            {/* Seletor de O.S. de origem — exibido apenas quando courtesy_type === 'retorno' */}
            {courtesyType === 'retorno' && (
              <div className="rounded-md border border-[#D1D1D1] dark:border-[#333333] px-3 py-2.5 space-y-2">
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  O.S. de origem
                </p>

                {/* Owner pode agendar retorno sem O.S. de origem — observação vira obrigatória */}
                {isOwner && (
                  <p className="text-xs text-muted-foreground">
                    Como Proprietário, você pode lançar sem O.S. de origem — informe o motivo na Observação.
                  </p>
                )}

                {/* Estado: carregando */}
                {originLoadingPlate && !originConfirmed && (
                  <p className="text-xs text-muted-foreground">Buscando O.S. original...</p>
                )}

                {/* Estado: sugestão disponível e não confirmada */}
                {!originLoadingPlate && originSuggestion && !originConfirmed && !originChanging && (
                  <div className="space-y-1.5">
                    <div className="rounded-md bg-white dark:bg-[#1A1A1A] border border-[#D1D1D1] dark:border-[#333333] px-3 py-2 text-sm">
                      <p className="font-medium text-[#111111] dark:text-white">
                        {originSuggestion.order_number ?? `#${originSuggestion.id}`}
                        {originSuggestion.external_os_number && (
                          <span className="ml-1.5 text-muted-foreground font-normal">
                            ({originSuggestion.external_os_number})
                          </span>
                        )}
                      </p>
                      {originSuggestion.service_date && (
                        <p className="text-xs text-muted-foreground">
                          {new Date(originSuggestion.service_date + 'T12:00:00').toLocaleDateString('pt-BR')}
                        </p>
                      )}
                      {originSuggestion.services.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {originSuggestion.services.join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setValue('original_service_order_id', originSuggestion.id)
                          setOriginConfirmed(true)
                        }}
                        className="flex items-center gap-1 rounded-md bg-[#F5A800] px-3 py-1 text-xs font-semibold text-[#111111] hover:bg-[#e09800] transition-colors"
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOriginChanging(true)
                          setOriginInputValue('')
                        }}
                        className="rounded-md border border-[#D1D1D1] dark:border-[#333333] px-3 py-1 text-xs font-semibold text-[#444444] dark:text-zinc-300 hover:bg-[#F5F5F5] dark:hover:bg-[#2A2A2A] transition-colors"
                      >
                        Trocar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOriginSuggestion(null)
                          setValue('original_service_order_id', undefined)
                        }}
                        className="rounded-md border border-[#D1D1D1] dark:border-[#333333] px-3 py-1 text-xs font-semibold text-[#444444] dark:text-zinc-300 hover:bg-[#F5F5F5] dark:hover:bg-[#2A2A2A] transition-colors"
                      >
                        Limpar
                      </button>
                    </div>
                  </div>
                )}

                {/* Estado: confirmado */}
                {originConfirmed && originSuggestion && (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-600 shrink-0" />
                      <span className="font-medium text-[#111111] dark:text-white">
                        {originSuggestion.order_number ?? `#${originSuggestion.id}`}
                      </span>
                      {originSuggestion.external_os_number && (
                        <span className="text-xs text-muted-foreground">({originSuggestion.external_os_number})</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setOriginConfirmed(false)
                        setOriginSuggestion(null)
                        setValue('original_service_order_id', undefined)
                      }}
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                      aria-label="Limpar O.S. de origem"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {/* Estado: trocar — input manual por placa/chassi */}
                {originChanging && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Informe a placa/chassi da O.S. de origem:</p>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        placeholder="Placa/chassi da O.S. de origem"
                        value={originInputValue}
                        onChange={(e) => setOriginInputValue(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                        className="h-8 text-sm font-mono tracking-widest uppercase"
                        maxLength={17}
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const searchPlate = originInputValue.trim() || (watchedPlate ?? '').toUpperCase().trim()
                          if (!searchPlate) return
                          try {
                            const storeId = selectedStoreId ? Number(selectedStoreId) : undefined
                            const suggestion = await serviceOrdersService.suggestReturnOrigin(searchPlate, undefined, storeId, returnOriginDept || undefined)
                            if (suggestion) {
                              setOriginSuggestion(suggestion)
                              setValue('original_service_order_id', suggestion.id)
                              setOriginConfirmed(true)
                              setOriginChanging(false)
                            } else {
                              setOriginSuggestion(null)
                            }
                          } catch {
                            setOriginSuggestion(null)
                          }
                        }}
                        className="flex items-center gap-1 rounded-md bg-[#F5A800] px-3 py-1 text-xs font-semibold text-[#111111] hover:bg-[#e09800] transition-colors whitespace-nowrap"
                      >
                        <Search className="h-3 w-3" /> Buscar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOriginChanging(false)
                          setOriginInputValue('')
                        }}
                        className="rounded-md border border-[#D1D1D1] dark:border-[#333333] px-2 py-1 text-xs text-muted-foreground hover:bg-[#F5F5F5] dark:hover:bg-[#2A2A2A] transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {originInputValue.trim() && !originLoadingPlate && originSuggestion === null && !originConfirmed && (
                      <p className="text-xs text-muted-foreground">Nenhuma O.S. encontrada para essa placa/chassi.</p>
                    )}
                  </div>
                )}

                {/* Estado: sem sugestão e não está carregando */}
                {!originLoadingPlate && !originSuggestion && !originConfirmed && !originChanging && (
                  <p className="text-xs text-muted-foreground">
                    {isValidPlateOrChassi((watchedPlate ?? '').toUpperCase().trim())
                      ? 'Nenhuma O.S. anterior encontrada para esta placa.'
                      : 'Informe a placa para buscar a O.S. original.'}
                  </p>
                )}

                <FieldError message={errors.original_service_order_id?.message} />
              </div>
            )}

            {/* Toggle multi-departamento — na criação combina do zero; na edição
                adiciona departamentos-irmãos ao agendamento atual. */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={isCombined}
                onClick={() => {
                  const next = !isCombined
                  setIsCombined(next)
                  if (!next) {
                    // Volta para modo simples
                    if (isEdit) {
                      // Mantém o departamento atual e seus serviços já carregados
                      setCombinedDepts([])
                      setValue('department', editingDept)
                    } else {
                      setCombinedDepts([])
                      setServiceSelections({})
                    }
                  } else {
                    // Entra no modo combinado: pré-selecionar o departamento do form
                    // (na edição, o departamento atual fica travado)
                    const preDept = isEdit ? editingDept : watch('department')
                    if (preDept) setCombinedDepts([preDept])
                    setValue('department', 'combined')
                  }
                  setServiceError(null)
                }}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
                  isCombined ? 'bg-amber-400' : 'bg-gray-200 dark:bg-zinc-600'
                )}
              >
                <span
                  className={cn(
                    'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform duration-200',
                    isCombined ? 'translate-x-4' : 'translate-x-0'
                  )}
                />
              </button>
              <span className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
                <Link2 className="h-3.5 w-3.5 text-amber-500" />
                {isEdit ? 'Combinar com outros departamentos' : 'Combinado (múltiplos departamentos)'}
              </span>
            </div>

            {/* Seleção de departamento */}
            {isCombined ? (
              /* Modo combinado: chips multi-seleção */
              <div>
                <FieldLabel htmlFor="combined-depts" required>Departamentos</FieldLabel>
                <div className="flex flex-wrap gap-1.5" id="combined-depts">
                  {departmentEntries.map(([value, label]) => {
                    const selected = combinedDepts.includes(value)
                    // Na edição o departamento atual fica travado (é o que está sendo editado)
                    const locked = isEdit && value === editingDept
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={locked}
                        onClick={() => {
                          if (locked) return
                          setCombinedDepts((prev) =>
                            selected ? prev.filter((d) => d !== value) : [...prev, value]
                          )
                          if (!selected) {
                            // Inicializar slice vazio ao selecionar um departamento novo
                            setServiceSelections((prev) => ({
                              ...prev,
                              [value]: prev[value] ?? EMPTY_SELECTION,
                            }))
                          }
                          setServiceError(null)
                        }}
                        className={cn(
                          'px-3 py-1.5 rounded-md text-sm font-medium border transition-colors',
                          selected
                            ? 'bg-amber-400 text-black border-amber-400'
                            : 'bg-white dark:bg-zinc-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-zinc-600 hover:border-amber-400',
                          locked && 'cursor-not-allowed opacity-90'
                        )}
                        aria-pressed={selected}
                        title={locked ? 'Departamento atual (não pode ser removido)' : undefined}
                      >
                        {label}{locked ? ' • atual' : ''}
                      </button>
                    )
                  })}
                </div>
                {isEdit && (
                  <p className="text-xs text-muted-foreground mt-1">
                    O departamento atual será atualizado; os demais serão criados como agendamentos
                    combinados (mesmo carro, mesma data).
                  </p>
                )}
                {combinedDepts.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">Selecione ao menos um departamento.</p>
                )}
              </div>
            ) : (
              /* Modo normal: toggle único */
              <div>
                <FieldLabel htmlFor="department" required>Departamento</FieldLabel>
                <Controller
                  name="department"
                  control={control}
                  render={({ field }) => (
                    <div className="flex flex-wrap gap-1.5">
                      {departmentEntries.map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            if (value !== field.value) {
                              // Limpar seleção ao trocar departamento
                              setServiceSelections({})
                              setServiceError(null)
                            }
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
                {!isCombined && <FieldError message={errors.department?.message} />}
              </div>
            )}

            {/* Row 3: Data + Horário + N. OS Concessionária */}
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

            {/* Row 4: Placa + Modelo + Cor */}
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
                      {/* Rede de segurança anti-flicker: se o valor atual (edição) ainda não
                          está na lista carregada, mostra o nome já conhecido do agendamento
                          em vez do trigger ficar em branco. */}
                      {field.value && field.value !== 'none' && !consultants.some((c) => String(c.id) === field.value) && (
                        <SelectItem value={field.value}>
                          {appointment?.consultant_name ?? `Consultor #${field.value}`}
                        </SelectItem>
                      )}
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

            {/* Seções de serviços */}
            {isCombined ? (
              /* Modo combinado: uma seção por departamento selecionado */
              combinedDepts.length > 0 ? (
                <div className="space-y-3">
                  {combinedDepts.map((dept) => (
                    <DepartmentServicesSection
                      key={dept}
                      department={dept}
                      storeBrandId={selectedStoreBrandId}
                      storeId={selectedStoreId}
                      isCourtesyAppointment={isCourtesyAppointment}
                      value={getCombinedSelection(dept)}
                      onChange={setCombinedSelection(dept)}
                      sectionTitle={VISIBLE_DEPARTMENT_LABELS[dept] ?? dept}
                    />
                  ))}
                </div>
              ) : null
            ) : (
              /* Modo normal: seção única */
              selectedDepartment && selectedDepartment !== 'combined' ? (
                <DepartmentServicesSection
                  department={selectedDepartment}
                  storeBrandId={selectedStoreBrandId}
                  storeId={selectedStoreId}
                  isCourtesyAppointment={isCourtesyAppointment}
                  value={getCurrentSelection()}
                  onChange={setCurrentSelection}
                />
              ) : null
            )}

            {/* Preview do modo combinado */}
            {combinedPreview && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                {combinedPreview}
              </div>
            )}

            {/* Erro de validação de serviços */}
            {serviceError && (
              <p className="text-xs text-red-500">{serviceError}</p>
            )}

            {/* Observações */}
            <div>
              <FieldLabel
                htmlFor="notes"
                required={courtesyType === 'retorno' && isOwner && !watch('original_service_order_id')}
              >
                Observações
              </FieldLabel>
              <Textarea
                id="notes"
                rows={3}
                placeholder="Informações adicionais..."
                className={cn(
                  'resize-none border border-gray-300 dark:border-zinc-600',
                  errors.notes && 'border-destructive'
                )}
                {...register('notes')}
              />
              <FieldError message={errors.notes?.message} />
            </div>

          </div>

          <DialogFooter className="px-5 py-3 border-t flex-shrink-0 gap-2">
            <Button type="button" variant="outline" onClick={() => { discardAppointmentDraft(); onClose() }} disabled={isSaving} size="sm">
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSaving}
              size="sm"
              style={{ backgroundColor: '#F5A800', color: '#000' }}
              className="hover:opacity-90 font-semibold"
            >
              {isSaving
                ? 'Salvando...'
                : isEdit
                ? isCombined && newCombinedDepts.length > 0
                  ? `Salvar e Combinar (+${newCombinedDepts.length})`
                  : 'Salvar Alterações'
                : isCombined && combinedDepts.length >= 2
                ? `Criar ${combinedDepts.length} Agendamentos`
                : 'Criar Agendamento'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
