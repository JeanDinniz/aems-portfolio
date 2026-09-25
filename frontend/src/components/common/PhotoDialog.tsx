import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { Download } from 'lucide-react'
import { downloadAuthedFile } from '@/utils/downloadAuthedFile'

interface PhotoDialogProps {
  url: string
  open: boolean
  onClose: () => void
  /** Legenda opcional exibida abaixo da foto (ex.: "ABC1D23 · OS 8891"). */
  caption?: string
  /** Descrição da imagem para leitores de tela. Padrão: "Foto da OS". */
  alt?: string
}

/** Lightbox de foto com zoom/pan (scroll para zoom, arraste para mover). */
export function PhotoDialog({ url, open, onClose, caption, alt = 'Foto da OS' }: PhotoDialogProps) {
  // Com legenda o modal ganha mais uma faixa: limita a foto para não estourar
  // telas baixas (notebook 1366x768). Sem legenda, mantém a altura de sempre.
  // Classes literais (o scanner do Tailwind não enxerga classes concatenadas).
  const wrapperClass = caption
    ? '!w-full !max-h-[70vh] rounded-lg overflow-hidden cursor-grab active:cursor-grabbing'
    : '!w-full !max-h-[80vh] rounded-lg overflow-hidden cursor-grab active:cursor-grabbing'
  const imgClass = caption
    ? 'w-full rounded-lg object-contain max-h-[70vh]'
    : 'w-full rounded-lg object-contain max-h-[80vh]'
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {/* z-[310]: acima do drawer de agendamento (z-[201]) e de qualquer modal.
          max-h/overflow: o DialogContent base não tem teto de altura — sem isto o
          conteúdo (foto + legenda + ações) é cortado em telas baixas. */}
      <DialogContent className="z-[310] max-w-2xl p-2 gap-2 max-h-[92dvh] overflow-y-auto bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333]">
        {/* Nome acessível do diálogo (exigido pelo Radix); a legenda é o rótulo natural. */}
        <DialogTitle className="sr-only">{caption ? `${alt} — ${caption}` : alt}</DialogTitle>
        {/* display:contents — a figure agrupa foto+legenda semanticamente sem alterar o grid */}
        <figure className="contents">
          <TransformWrapper
            minScale={1}
            maxScale={5}
            centerOnInit
            wheel={{ step: 0.15 }}
            doubleClick={{ mode: 'reset' }}
          >
            <TransformComponent
              wrapperClass={wrapperClass}
              contentClass="!w-full"
            >
              <img src={url} alt={alt} className={imgClass} />
            </TransformComponent>
          </TransformWrapper>
          {caption && (
            <figcaption className="mt-1 pt-2 border-t border-[#E8E8E8] dark:border-[#333333] text-center text-sm font-semibold text-[#111111] dark:text-white break-words">
              {caption}
            </figcaption>
          )}
        </figure>
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={() => downloadAuthedFile(url, 'foto.jpg')}
            className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold hover:brightness-110 active:scale-[0.98] transition-all"
            style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
          >
            <Download className="h-4 w-4" />
            Baixar Foto
          </button>
        </div>
        <p className="-mt-1 text-center text-[11px] text-muted-foreground">
          Scroll para zoom · arraste para mover · 2 cliques para resetar
        </p>
      </DialogContent>
    </Dialog>
  )
}
