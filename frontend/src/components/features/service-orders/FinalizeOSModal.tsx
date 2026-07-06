import { useState, useRef, useCallback } from 'react'
import { Camera, ImageIcon, X, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { useEmployeesByStore } from '@/hooks/useEmployees'
import { uploadService } from '@/services/api/upload.service'
import { FilmRollSelector } from '@/components/features/scheduling/FilmRollSelector'
import { compressImage } from '@/utils/imageCompression'
import { validateImageFile } from '@/utils/fileValidation'
import { generateId } from '@/utils/generateId'
import { logger } from '@/lib/logger'
import { useFinalizeServiceOrder } from '@/hooks/useServiceOrders'
import type { Photo } from '@/types/photo.types'
import type { ServiceCategory } from '@/services/api/services.service'
import { CameraCapture } from '@/components/common/CameraCapture'

// ─── Photo slot ───────────────────────────────────────────────────────────────

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
        toast({ variant: 'destructive', title: 'Arquivo invalido', description: validation.error })
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
          className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-green-600 hover:border-green-600 transition-colors"
          aria-label={`Adicionar foto ${index + 1}`}
        >
          <Camera className="h-5 w-5" />
          <span className="text-[10px] font-medium">{index + 1}</span>
        </button>
      )}
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface FinalizeOSModalProps {
  open: boolean
  serviceOrderId: number
  storeId: number
  department: string
  items: Array<{
    service_id: number
    service_name?: string | null
    service_code?: string | null
    category?: ServiceCategory | null
    tonality?: string | null
    film_roll_id?: number | null
    film_type_id?: number | null
  }>
  onClose: () => void
  onSuccess: () => void
  isGalpon?: boolean
}

const MIN_PHOTOS = 1
const TOTAL_SLOTS = 2

export function FinalizeOSModal({
  open,
  serviceOrderId,
  storeId,
  department,
  items,
  onClose,
  onSuccess,
  isGalpon = false,
}: FinalizeOSModalProps) {
  const [photos, setPhotos] = useState<(Photo | undefined)[]>(
    Array(TOTAL_SLOTS).fill(undefined)
  )
  const [rollSelections, setRollSelections] = useState<Record<number, number | undefined>>(() => {
    const pre: Record<number, number | undefined> = {}
    for (const item of items) {
      if (item.film_roll_id) pre[item.service_id] = item.film_roll_id
    }
    return pre
  })
  const [selectedEmployees, setSelectedEmployees] = useState<number[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const finalize = useFinalizeServiceOrder()
  const { data: employeesData } = useEmployeesByStore(storeId)
  const employees = (employeesData ?? []).filter((e) => e.is_active)

  const isFilmDept = department === 'film' || department === 'security_film' || department === 'ppf'

  // Bobina obrigatória só para Película comum. PPF e Película de Segurança têm bobina opcional.
  const isRollRequiredDept = department === 'film'
  const isPpfItem = (item: { category?: ServiceCategory | null }) => item.category === 'ppf'
  const hasRequiredRollItem = isRollRequiredDept && items.some((item) => !isPpfItem(item))

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

  const toggleEmployee = useCallback((id: number) => {
    setSelectedEmployees((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }, [])

  const handleClose = () => {
    photos.forEach((p) => p && URL.revokeObjectURL(p.preview))
    setPhotos(Array(TOTAL_SLOTS).fill(undefined))
    setRollSelections({})
    setSelectedEmployees([])
    setIsSubmitting(false)
    onClose()
  }

  const handleSubmit = async () => {
    const filledPhotos = photos.filter(Boolean) as Photo[]

    if (filledPhotos.length < MIN_PHOTOS) {
      toast({
        variant: 'destructive',
        title: 'Foto obrigatoria',
        description: `Adicione pelo menos ${MIN_PHOTOS} foto da chancela.`,
      })
      return
    }

    if (isRollRequiredDept && items.length > 0) {
      const missing = items
        .filter((item) => !isPpfItem(item))
        .some((item) => !rollSelections[item.service_id])
      if (missing) {
        toast({
          variant: 'destructive',
          title: 'Bobinas nao selecionadas',
          description: 'Selecione uma bobina para cada servico de pelicula.',
        })
        return
      }
    }

    setIsSubmitting(true)
    try {
      const uploaded = await uploadService.uploadPhotos(filledPhotos)
      const completionPhotos = uploaded.map((u) => u.url)

      const filmRollAssignments = isFilmDept
        ? items
            .filter((item) => rollSelections[item.service_id] !== undefined)
            .map((item) => ({
              service_id: item.service_id,
              film_roll_id: rollSelections[item.service_id]!,
            }))
        : []

      finalize.mutate(
        {
          id: serviceOrderId,
          payload: {
            completion_photos: completionPhotos,
            film_roll_assignments: filmRollAssignments,
            employee_ids: selectedEmployees,
          },
        },
        {
          onSuccess: () => {
            handleClose()
            onSuccess()
          },
          onSettled: () => setIsSubmitting(false),
        }
      )
    } catch (err) {
      logger.error('Erro ao fazer upload das fotos de finalizacao:', err)
      toast({
        variant: 'destructive',
        title: 'Erro no upload',
        description: 'Falha ao enviar fotos. Tente novamente.',
      })
      setIsSubmitting(false)
    }
  }

  const filledCount = photos.filter(Boolean).length

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg w-full p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-semibold">
            Finalizar O.S.
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            Preencha os dados finais para concluir o servico.
          </p>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh]">
          <div className="px-5 py-4 space-y-5">
            {/* Completion photos */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Foto da chancela <span className="text-destructive">*</span>
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

            {/* Film roll selectors */}
            {isFilmDept && items.length > 0 && (
              <div className="space-y-3">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Bobinas {hasRequiredRollItem && <span className="text-destructive">*</span>}
                </Label>
                {items.map((item) => (
                  <FilmRollSelector
                    key={item.service_id}
                    storeId={storeId}
                    department={department}
                    serviceId={item.service_id}
                    tonality={item.tonality ?? null}
                    serviceName={item.service_code
                      ? `${item.service_code} - ${item.service_name ?? `Servico #${item.service_id}`}`
                      : (item.service_name ?? `Servico #${item.service_id}`)}
                    filmTypeId={item.film_type_id ?? undefined}
                    required={isRollRequiredDept && !isPpfItem(item)}
                    value={rollSelections[item.service_id]}
                    onChange={(rollId) =>
                      setRollSelections((prev) => ({ ...prev, [item.service_id]: rollId }))
                    }
                    isGalpon={isGalpon}
                  />
                ))}
              </div>
            )}

            {/* Employee selector */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Funcionarios
              </Label>
              {employees.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum funcionario ativo nesta loja.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {employees.map((emp) => (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => toggleEmployee(emp.id)}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                        selectedEmployees.includes(emp.id)
                          ? 'bg-green-600 border-green-600 text-white'
                          : 'border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-gray-300 hover:border-green-600'
                      )}
                    >
                      {emp.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="px-5 py-3 border-t gap-2">
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
            className="bg-green-600 hover:bg-green-700 text-white font-semibold"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Finalizando...
              </>
            ) : (
              'Confirmar e Finalizar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
