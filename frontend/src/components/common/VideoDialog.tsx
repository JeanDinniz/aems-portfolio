import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Download } from 'lucide-react'
import { downloadAuthedFile } from '@/utils/downloadAuthedFile'

interface VideoDialogProps {
  url: string
  open: boolean
  onClose: () => void
  /** Legenda opcional exibida abaixo do vídeo (ex.: "ABC1D23 · OS 8891"). */
  caption?: string
}

/** Lightbox de vídeo da vistoria (sem zoom/pan — é vídeo, não foto). */
export function VideoDialog({ url, open, onClose, caption }: VideoDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {/* z-[310]: acima do drawer de agendamento (z-[201]) e de qualquer modal.
          max-h/overflow: o DialogContent base não tem teto de altura — sem isto o
          conteúdo (vídeo + legenda + ações) é cortado em telas baixas. */}
      <DialogContent className="z-[310] max-w-2xl p-2 gap-2 max-h-[92dvh] overflow-y-auto bg-white dark:bg-[#1A1A1A] border-[#D1D1D1] dark:border-[#333333]">
        {/* Nome acessível do diálogo (exigido pelo Radix); a legenda é o rótulo natural. */}
        <DialogTitle className="sr-only">
          {caption ? `Vídeo da OS — ${caption}` : 'Vídeo da OS'}
        </DialogTitle>
        {/* display:contents — a figure agrupa vídeo+legenda semanticamente sem alterar o grid */}
        <figure className="contents">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- vídeo da vistoria não tem faixa de legendas disponível */}
          <video
            src={url}
            controls
            playsInline
            className="w-full rounded-lg bg-black max-h-[70vh]"
          />
          {caption && (
            <figcaption className="mt-1 pt-2 border-t border-[#E8E8E8] dark:border-[#333333] text-center text-sm font-semibold text-[#111111] dark:text-white break-words">
              {caption}
            </figcaption>
          )}
        </figure>
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={() => downloadAuthedFile(url, 'vídeo.mp4')}
            className="flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold hover:brightness-110 active:scale-[0.98] transition-all"
            style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
          >
            <Download className="h-4 w-4" />
            Baixar vídeo
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
