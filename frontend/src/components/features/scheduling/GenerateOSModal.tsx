import { useState, useRef, useCallback, useMemo } from 'react'
import { Camera, ImageIcon, X, Loader2, ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useQuery } from '@tanstack/react-query'
import { useGenerateOS } from '@/hooks/useScheduling'
import { uploadService } from '@/services/api/upload.service'
import { servicesService } from '@/services/api/services.service'
import type { ServiceItem } from '@/services/api/services.service'
import { compressImage } from '@/utils/imageCompression'
import { validateImageFile } from '@/utils/fileValidation'
import { generateId } from '@/utils/generateId'
import { logger } from '@/lib/logger'
import { DEPARTMENT_LABELS } from '@/constants/scheduling'
import type { Photo } from '@/types/photo.types'
import type { Appointment } from '@/types/scheduling.types'
import { CameraCapture } from '@/components/common/CameraCapture'

const MIN_PHOTOS = 1

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  return `${day}/${month}/${year}`
}

// ─── Single photo slot ────────────────────────────────────────────────────────

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

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (inputRef.current) inputRef.current.value = ''
      if (!file) return
      const validation = validateImageFile(file)
      if (!validation.valid) {
        toast({ variant: 'destructive', title: 'Arquivo inválido', description: validation.error })
        return
      }
      onCapture(index, file)
    },
    [index, onCapture]
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
          onCapture={(file) => { setShowCamera(false); onCapture(index, file) }}
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
      ) : showOptions ? (
        <div className="absolute inset-0 z-10 bg-black/75 flex flex-col items-center justify-center gap-2 rounded-lg p-2">
          <button
            type="button"
            onClick={() => { setShowOptions(false); setShowCamera(true) }}
            className="flex items-center gap-1.5 w-full justify-center px-2 py-1.5 rounded-md bg-white/20 hover:bg-white/30 text-white text-xs font-medium"
          >
            <Camera className="h-3.5 w-3.5" /> Câmera
          </button>
          <button
            type="button"
            onClick={() => { setShowOptions(false); inputRef.current?.click() }}
            className="flex items-center gap-1.5 w-full justify-center px-2 py-1.5 rounded-md bg-white/20 hover:bg-white/30 text-white text-xs font-medium"
          >
            <ImageIcon className="h-3.5 w-3.5" /> Galeria
          </button>
          <button
            type="button"
            onClick={() => setShowOptions(false)}
            className="text-white/60 text-[10px] mt-0.5"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowOptions(true)}
          className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-[#F5A800] hover:border-[#F5A800] transition-colors"
          aria-label={`Adicionar foto ${index + 1}`}
        >
          <Camera className="h-5 w-5" />
          <span className="text-[10px] font-medium">{index + 1}</span>
        </button>
      )}
    </div>
  )
}

function buildServiceLabel(
  serviceId: number,
  tonality: string | null,
  map: Record<number, ServiceItem>
): string {
  const svc = map[serviceId]
  if (!svc) return `Serv. #${serviceId}`
  const parts: string[] = []
  if (svc.code) parts.push(svc.code)
  parts.push(svc.name)
  if (tonality) parts.push(tonality)
  return parts.join(' - ')
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

interface GenerateOSModalProps {
  open: boolean
  appointment: Appointment | null
  onClose: () => void
  onSuccess: (serviceOrderId: number, orderNumber: string) => void
}

export function GenerateOSModal({
  open,
  appointment,
  onClose,
  onSuccess,
}: GenerateOSModalProps) {
  const [photos, setPhotos] = useState<(Photo | undefined)[]>([
    undefined, undefined, undefined, undefined,
  ])
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const generateOS = useGenerateOS()

  const isFilmDept =
    appointment?.department === 'film' ||
    appointment?.department === 'security_film' ||
    appointment?.department === 'ppf'

  const filmEntries = appointment?.film_entries ?? []
  const dept = appointment?.department ?? ''

  const { data: servicesData } = useQuery({
    queryKey: ['services-for-generate-os', dept],
    queryFn: () =>
      servicesService.list({ department: dept, is_active: true, limit: 100 }).then((r) => r.items),
    enabled: isFilmDept && !!dept,
    staleTime: 1000 * 60 * 5,
  })

  const serviceMap = useMemo<Record<number, ServiceItem>>(() => {
    const map: Record<number, ServiceItem> = {}
    for (const s of servicesData ?? []) map[s.id] = s
    return map
  }, [servicesData])

  const handleCapture = useCallback(
    async (index: number, file: File) => {
      try {
        const compressed = await compressImage(file, {
          maxWidth: 1920,
          maxHeight: 1080,
          quality: 0.85,
        })
        const preview = URL.createObjectURL(compressed)
        const photo: Photo = {
          id: generateId(),
          preview,
          compressed,
          uploaded: false,
          uploadProgress: 0,
        }
        setPhotos((prev) => {
          const next = [...prev]
          next[index] = photo
          return next
        })
      } catch (err) {
        logger.error('Erro ao comprimir imagem:', err)
        toast({
          variant: 'destructive',
          title: 'Erro ao processar imagem',
          description: 'Tente novamente com outra foto.',
        })
      }
    },
    []
  )

  const handleRemove = useCallback((index: number) => {
    setPhotos((prev) => {
      const next = [...prev]
      if (next[index]) URL.revokeObjectURL(next[index]!.preview)
      next[index] = undefined
      return next
    })
  }, [])

  const handleClose = () => {
    photos.forEach((p) => p && URL.revokeObjectURL(p.preview))
    setPhotos([undefined, undefined, undefined, undefined])
    setNotes('')
    setIsSubmitting(false)
    onClose()
  }

  const handleSubmit = async () => {
    if (!appointment) return

    const filledPhotos = photos.filter(Boolean) as Photo[]
    if (filledPhotos.length < MIN_PHOTOS) {
      toast({
        variant: 'destructive',
        title: 'Fotos insuficientes',
        description: `Adicione pelo menos ${MIN_PHOTOS} fotos do veículo.`,
      })
      return
    }

    setIsSubmitting(true)
    try {
      const uploaded = await uploadService.uploadPhotos(filledPhotos)
      const photoUrls = uploaded.map((u) => u.url)

      generateOS.mutate(
        {
          id: appointment.id,
          payload: {
            photos: photoUrls,
            notes: notes.trim() || undefined,
          },
        },
        {
          onSuccess: (result) => {
            handleClose()
            onSuccess(result.service_order_id, result.order_number)
          },
          onSettled: () => setIsSubmitting(false),
        }
      )
    } catch (err) {
      logger.error('Erro ao fazer upload das fotos:', err)
      toast({
        variant: 'destructive',
        title: 'Erro no upload',
        description: 'Falha ao enviar fotos. Tente novamente.',
      })
      setIsSubmitting(false)
    }
  }

  const filledCount = photos.filter(Boolean).length

  if (!appointment) return null

  const deptLabel = DEPARTMENT_LABELS[dept as keyof typeof DEPARTMENT_LABELS] ?? dept

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg w-full p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-semibold">
            Gerar Ordem de Servico
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            Confirme os dados do agendamento e adicione a foto do veiculo para iniciar.
          </p>
        </DialogHeader>

        <ScrollArea className="max-h-[70dvh]">
          <div className="px-5 py-4 space-y-5">
            {/* Appointment summary */}
            <div className="rounded-lg border bg-gray-50 dark:bg-zinc-800/40 p-3 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Resumo do Agendamento
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">Placa</span>
                  <p className="font-mono font-semibold">{appointment.vehicle_plate}</p>
                </div>
                {appointment.vehicle_model && (
                  <div>
                    <span className="text-muted-foreground text-xs">Modelo</span>
                    <p>{appointment.vehicle_model}</p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground text-xs">Departamento</span>
                  <p>{deptLabel}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Entrega</span>
                  <p>{formatDate(appointment.delivery_date)}</p>
                </div>
                {appointment.consultant_name && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground text-xs">Consultor</span>
                    <p>{appointment.consultant_name}</p>
                  </div>
                )}
              </div>

              {/* Film entries or services summary */}
              {isFilmDept && filmEntries.length > 0 && (
                <div className="pt-1 border-t mt-1 space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Peliculas
                  </p>
                  {filmEntries.map((fe) => (
                    <p key={fe.service_id} className="text-xs text-gray-700 dark:text-gray-300">
                      {buildServiceLabel(fe.service_id, fe.tonality, serviceMap)}
                    </p>
                  ))}
                </div>
              )}
              {!isFilmDept && (appointment.service_ids ?? []).length > 0 && (
                <div className="pt-1 border-t mt-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Servicos: {(appointment.service_ids ?? []).length} selecionado(s)
                  </p>
                </div>
              )}
            </div>

            {/* Photos */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Fotos do Veiculo <span className="text-destructive">*</span>
                </Label>
                <span
                  className={cn(
                    'text-xs font-medium',
                    filledCount >= MIN_PHOTOS ? 'text-green-600' : 'text-muted-foreground'
                  )}
                >
                  {filledCount}/{MIN_PHOTOS} minimo
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {photos.map((photo, i) => (
                  <PhotoSlot
                    key={i}
                    photo={photo}
                    index={i}
                    onCapture={handleCapture}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label
                htmlFor="generate-os-notes"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Observacoes
              </Label>
              <Textarea
                id="generate-os-notes"
                placeholder="Observacoes adicionais para a O.S. (opcional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="resize-none text-sm border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 focus-visible:ring-[#F5A800]"
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="px-5 pt-3 border-t gap-2" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || filledCount < MIN_PHOTOS}
            style={{ backgroundColor: '#F5A800', color: '#000' }}
            className="font-semibold"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Gerando...
              </>
            ) : (
              'Gerar O.S.'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Success banner component ─────────────────────────────────────────────────

interface OSCreatedBannerProps {
  serviceOrderId: number
  orderNumber: string
  onDismiss: () => void
}

export function OSCreatedBanner({
  serviceOrderId,
  orderNumber,
  onDismiss,
}: OSCreatedBannerProps) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border bg-white dark:bg-zinc-900 shadow-lg px-4 py-3 max-w-sm">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          O.S. criada com sucesso!
        </p>
        <p className="text-xs text-muted-foreground">N° {orderNumber}</p>
      </div>
      <a
        href={`/service-orders/${serviceOrderId}/edit`}
        className="flex items-center gap-1 text-xs font-medium text-[#F5A800] hover:underline shrink-0"
      >
        Ver <ExternalLink className="h-3 w-3" />
      </a>
      <button
        type="button"
        onClick={onDismiss}
        className="text-muted-foreground hover:text-gray-700 dark:hover:text-gray-300 shrink-0"
        aria-label="Fechar"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
