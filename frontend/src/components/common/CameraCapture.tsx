import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, Check, RotateCcw, X } from 'lucide-react'

export interface CameraCaptureProps {
  /** Recebe o arquivo capturado (JPEG na resolução real do sensor). */
  onCapture: (file: File) => void
  /** Fecha a câmera sem capturar. */
  onCancel: () => void
}

type CameraState = 'loading' | 'active' | 'preview' | 'denied' | 'unavailable' | 'error'

/**
 * Câmera in-app via `getUserMedia` (NÃO usa `<input capture>` / câmera nativa).
 *
 * Por que existe: o atributo `capture="environment"` abre o app de câmera do SO,
 * jogando o PWA para segundo plano. Em Android com pouca RAM o SO mata a aba e,
 * ao voltar, a página recarrega ("o app reinicia") — perdendo o que estava em tela.
 * Mantendo a captura dentro do navegador isso não acontece.
 *
 * Renderiza via `createPortal` no `document.body` (z-[9999]) para ocupar a tela
 * inteira de verdade, escapando do `transform/overflow` de drawers/sheets que
 * prenderiam um `position: fixed` filho.
 *
 * Fluxo: tirar → preview → Refazer/Confirmar. Captura na resolução real do vídeo
 * (`videoWidth/Height`) em JPEG 0.95 — a compressão para upload acontece depois,
 * a cargo de quem consome (via `compressImage`).
 */
export function CameraCapture({ onCapture, onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const pendingFileRef = useRef<File | null>(null)
  const previewUrlRef = useRef<string | null>(null)

  const [state, setState] = useState<CameraState>(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return 'unavailable'
    }
    return 'loading'
  })
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
  }, [])

  // Ao abrir a câmera: fecha qualquer teclado aberto (um campo do formulário por
  // trás pode estar com foco) e trava o scroll do body. Sem o blur, o teclado do
  // Android fica sobreposto e esconde os botões de capturar/cancelar.
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null
    active?.blur?.()
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  // Abre o stream da câmera (traseira por padrão) UMA vez, na montagem, e limpa
  // ao desmontar. NÃO pode depender de `state`: senão, ao tirar a foto (active →
  // preview), o efeito re-executaria — fechando o stream e revogando o preview e
  // reabrindo a câmera ("pisca e não mostra a foto"). A checagem usa o mesmo
  // critério do estado inicial, sem ler `state`.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return

    let cancelled = false

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 4096 },
          height: { ideal: 2160 },
        },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        setState('active')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          setState('denied')
        } else {
          setErrorMessage(err instanceof Error ? err.message : 'Erro ao acessar a câmera.')
          setState('error')
        }
      })

    return () => {
      cancelled = true
      stopStream()
      revokePreview()
    }
  }, [stopStream, revokePreview])

  // Reanexa o stream ao <video> ao voltar do preview para a câmera.
  useEffect(() => {
    if (state === 'active' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
    }
  }, [state])

  const handleCapture = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)

    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' })
        const url = URL.createObjectURL(blob)
        pendingFileRef.current = file
        previewUrlRef.current = url
        setPreviewSrc(url)
        setState('preview')
      },
      'image/jpeg',
      0.95
    )
  }, [])

  const handleConfirm = useCallback(() => {
    const file = pendingFileRef.current
    if (!file) return
    stopStream()
    revokePreview()
    setPreviewSrc(null)
    onCapture(file)
  }, [onCapture, stopStream, revokePreview])

  const handleRetake = useCallback(() => {
    revokePreview()
    setPreviewSrc(null)
    pendingFileRef.current = null
    setState('active')
  }, [revokePreview])

  const handleCancel = useCallback(() => {
    stopStream()
    revokePreview()
    onCancel()
  }, [onCancel, stopStream, revokePreview])

  let content: React.ReactNode

  if (state === 'unavailable' || state === 'denied' || state === 'error') {
    content = (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-6">
        <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl bg-background p-6 text-center shadow-xl">
          <p className="text-[13px] text-destructive">
            {state === 'unavailable'
              ? 'Câmera não disponível neste dispositivo.'
              : state === 'denied'
                ? 'Permissão de câmera negada. Permita o acesso nas configurações do navegador.'
                : (errorMessage ?? 'Erro ao acessar a câmera.')}
          </p>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    )
  } else if (state === 'preview' && previewSrc) {
    content = (
      <div className="fixed inset-0 z-[9999] bg-black">
        <img
          src={previewSrc}
          alt="Pré-visualização da foto"
          className="h-full w-full object-contain"
        />
        <div className="absolute bottom-8 left-0 right-0 flex items-center justify-center gap-6 px-4">
          <button
            type="button"
            onClick={handleRetake}
            aria-label="Refazer foto"
            className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-white/70 bg-black/60 text-white shadow-lg transition-opacity hover:opacity-80"
          >
            <RotateCcw className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            aria-label="Confirmar foto"
            className="flex h-20 w-20 items-center justify-center rounded-full bg-[#F5B800] text-black shadow-xl transition-transform active:scale-95"
          >
            <Check className="h-9 w-9" />
          </button>
        </div>
      </div>
    )
  } else {
    content = (
      <div className="fixed inset-0 z-[9999] bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
          aria-label="Visualização da câmera"
        />

        {state === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <p className="text-[13px] text-white">Iniciando câmera…</p>
          </div>
        )}

        <div className="absolute bottom-8 left-0 right-0 flex items-center justify-center gap-6 px-4">
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Cancelar"
            className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-white/70 bg-black/60 text-white shadow-lg transition-opacity hover:opacity-80"
          >
            <X className="h-6 w-6" />
          </button>

          <button
            type="button"
            onClick={handleCapture}
            disabled={state !== 'active'}
            aria-label="Capturar foto"
            className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-black shadow-xl transition-transform active:scale-95 disabled:pointer-events-none disabled:opacity-50"
          >
            <Camera className="h-9 w-9" />
          </button>
        </div>

        <canvas ref={canvasRef} className="hidden" aria-hidden />
      </div>
    )
  }

  // O wrapper resolve três problemas ao abrir a câmera dentro de um Radix Dialog
  // (ex.: Lançar O.S.), já que o portal renderiza no <body>, FORA do diálogo:
  // 1. `pointer-events-auto` — o Radix modal coloca `pointer-events: none` no
  //    <body>; sem reabilitar aqui, a câmera fica visível mas os botões NÃO
  //    respondem ao toque.
  // 2. `onPointerDown` stopPropagation — o Radix escuta `pointerdown` no document
  //    (bubble) para fechar ao "clicar fora"; como a câmera está fora do diálogo,
  //    sem isso cada toque fecharia o modal por baixo. Parar a propagação evita.
  // 3. `onMouseDownCapture` preventDefault — impede que tocar na câmera mova o
  //    foco para fora do diálogo (senão o focus-trap do Radix devolve o foco ao
  //    campo de texto, reabrindo o teclado). O clique em si continua funcionando.
  return createPortal(
    <div
      className="pointer-events-auto"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDownCapture={(e) => e.preventDefault()}
    >
      {content}
    </div>,
    document.body
  )
}
