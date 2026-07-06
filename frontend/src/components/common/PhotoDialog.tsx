import { Dialog, DialogContent } from '@/components/ui/dialog'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'

interface PhotoDialogProps {
  url: string
  open: boolean
  onClose: () => void
}

/** Lightbox de foto com zoom/pan (scroll para zoom, arraste para mover). */
export function PhotoDialog({ url, open, onClose }: PhotoDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {/* z-[310]: acima do drawer de agendamento (z-[201]) e de qualquer modal */}
      <DialogContent className="z-[310] max-w-2xl p-2 bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333]">
        <TransformWrapper
          minScale={1}
          maxScale={5}
          centerOnInit
          wheel={{ step: 0.15 }}
          doubleClick={{ mode: 'reset' }}
        >
          <TransformComponent
            wrapperClass="!w-full !max-h-[80vh] rounded-lg overflow-hidden cursor-grab active:cursor-grabbing"
            contentClass="!w-full"
          >
            <img
              src={url}
              alt="Foto da OS"
              className="w-full rounded-lg object-contain max-h-[80vh]"
            />
          </TransformComponent>
        </TransformWrapper>
        <p className="mt-1 text-center text-[11px] text-muted-foreground">
          Scroll para zoom · arraste para mover · 2 cliques para resetar
        </p>
      </DialogContent>
    </Dialog>
  )
}
