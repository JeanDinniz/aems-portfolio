import { useState, useCallback } from 'react'
import { Clock, Bell, Download, ChevronDown, ChevronUp, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { CameraCapture } from '@/components/common/CameraCapture'
import { useTimeClockMe, usePunch, useMyMirror } from '@/hooks/useTimeClock'
import { useToast } from '@/hooks/use-toast'
import { getCurrentPosition, GeolocationError } from '@/utils/geolocation'
import { compressImage } from '@/utils/imageCompression'
import { uploadService } from '@/services/api/upload.service'
import { subscribeWebPush } from '@/services/webPush'
import { getApiErrorMessage, getApiErrorStatus } from '@/lib/api-error'
import { timeClockService } from '@/services/api/timeClock.service'
import type { TimeClockRecord } from '@/types/timeClock.types'

type PunchStep = 'idle' | 'locating' | 'camera' | 'uploading' | 'done'
type MirrorPeriod = '24h' | 'month'

function formatTime(isoString: string | null | undefined): string {
    if (!isoString) return '--:--'
    try {
        return new Date(isoString).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
        })
    } catch {
        return '--:--'
    }
}

function formatDateTime(isoString: string | null | undefined): string {
    if (!isoString) return '—'
    try {
        return new Date(isoString).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        })
    } catch {
        return '—'
    }
}

function formatWorkTime(hhmmss: string): string {
    // 'HH:MM:SS' → 'HH:MM'
    return hhmmss?.slice(0, 5) ?? '--:--'
}

function formatDate(dateString: string): string {
    try {
        const [year, month, day] = dateString.split('-').map(Number)
        const d = new Date(year, month - 1, day)
        return d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })
    } catch {
        return dateString
    }
}

function groupByDate(
    records: TimeClockRecord[]
): Array<{ date: string; items: TimeClockRecord[] }> {
    const map = new Map<string, TimeClockRecord[]>()
    for (const r of records) {
        const existing = map.get(r.recorded_date) ?? []
        existing.push(r)
        map.set(r.recorded_date, existing)
    }
    return Array.from(map.entries()).map(([date, items]) => ({ date, items }))
}

/** Linha do espelho: exibe horário, tipo, e selo de ajuste quando aplicável */
function MirrorRecordRow({ record }: { record: TimeClockRecord }) {
    const isAdjustment = record.source === 'admin_adjustment'
    const isAnnulment = record.annuls_record_id !== null

    return (
        <div className="flex items-center justify-between gap-3 py-2 border-b border-[#E8E8E8] dark:border-[#333333] last:border-b-0">
            <div className="flex items-center gap-2 min-w-0">
                <div className="flex flex-col">
                    <span className="text-sm font-medium text-[#111111] dark:text-zinc-200">
                        {formatDateTime(record.recorded_at)}
                    </span>
                    {/* Motivo do ajuste/anulação */}
                    {record.adjustment_reason && (
                        <span className="text-xs text-[#999999] dark:text-zinc-500 truncate max-w-[200px]">
                            {record.adjustment_reason}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                {/* Badge de tipo (entrada/saída) */}
                <Badge
                    className={
                        record.type === 'in'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-300 dark:border-green-700/50'
                            : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-orange-300 dark:border-orange-700/50'
                    }
                    variant="outline"
                >
                    {record.type === 'in' ? 'Entrada' : 'Saída'}
                </Badge>
                {/* Selo de ajuste administrativo */}
                {isAnnulment && (
                    <Badge
                        variant="outline"
                        className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-300 dark:border-red-700/50"
                    >
                        Anulação
                    </Badge>
                )}
                {isAdjustment && !isAnnulment && (
                    <Badge
                        variant="outline"
                        className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-300 dark:border-blue-700/50"
                    >
                        Ajuste
                    </Badge>
                )}
            </div>
        </div>
    )
}

/** Seção "Meu espelho" — autoatendimento do funcionário */
function MyMirrorSection() {
    const [isOpen, setIsOpen] = useState(false)
    const [period, setPeriod] = useState<MirrorPeriod>('24h')
    const [isExporting, setIsExporting] = useState(false)
    const { toast } = useToast()

    const { data, isLoading } = useMyMirror(period)

    const handleExportPdf = async () => {
        setIsExporting(true)
        try {
            const blob = await timeClockService.exportMyPdf(period)
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            const suffix = period === '24h' ? '24h' : 'mes'
            a.download = `meu-espelho-ponto-${suffix}.pdf`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
        } catch {
            toast({
                title: 'Erro ao exportar PDF',
                description: 'Tente novamente.',
                variant: 'destructive',
            })
        } finally {
            setIsExporting(false)
        }
    }

    return (
        <div className="rounded-2xl border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] overflow-hidden">
            {/* Cabeçalho expansível */}
            <button
                type="button"
                onClick={() => setIsOpen((v) => !v)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors"
            >
                <span className="text-sm font-semibold text-[#333333] dark:text-zinc-300 flex items-center gap-2">
                    <Clock className="h-4 w-4" style={{ color: '#F5A800' }} />
                    Meu espelho de ponto
                </span>
                {isOpen ? (
                    <ChevronUp className="h-4 w-4 text-[#999999]" />
                ) : (
                    <ChevronDown className="h-4 w-4 text-[#999999]" />
                )}
            </button>

            {isOpen && (
                <div className="px-5 pb-5 space-y-4 border-t border-[#E8E8E8] dark:border-[#333333]">
                    {/* Controles: toggle de período + botão de exportar */}
                    <div className="flex items-center justify-between gap-3 pt-3 flex-wrap">
                        {/* Toggle 24h / Mês */}
                        <div className="flex rounded-lg border border-[#D1D1D1] dark:border-[#333333] overflow-hidden">
                            {(['24h', 'month'] as MirrorPeriod[]).map((p) => (
                                <button
                                    key={p}
                                    type="button"
                                    onClick={() => setPeriod(p)}
                                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                        period === p
                                            ? 'text-[#1A1A1A] dark:text-[#1A1A1A]'
                                            : 'bg-transparent text-[#666666] dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-700'
                                    }`}
                                    style={
                                        period === p
                                            ? { backgroundColor: '#F5A800' }
                                            : {}
                                    }
                                >
                                    {p === '24h' ? 'Últimas 24h' : 'Este mês'}
                                </button>
                            ))}
                        </div>

                        {/* Exportar PDF pessoal */}
                        <Button
                            size="sm"
                            onClick={handleExportPdf}
                            disabled={isExporting || isLoading}
                            className="font-semibold text-xs h-8"
                            style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                        >
                            <Download className="h-3.5 w-3.5 mr-1.5" />
                            {isExporting ? 'Exportando...' : 'Exportar PDF'}
                        </Button>
                    </div>

                    {/* Lista de registros */}
                    {isLoading ? (
                        <div className="space-y-2">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <Skeleton key={i} className="h-10 w-full" />
                            ))}
                        </div>
                    ) : !data || data.items.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 py-6 text-[#999999] dark:text-zinc-500">
                            <Clock className="h-8 w-8 opacity-30" />
                            <p className="text-sm">
                                {period === '24h'
                                    ? 'Nenhum registro nas últimas 24h'
                                    : 'Nenhum registro este mês'}
                            </p>
                        </div>
                    ) : (
                        <div>
                            {groupByDate(data.items).map(({ date, items }) => (
                                <div key={date} className="mb-4 last:mb-0">
                                    <p className="text-xs font-semibold text-[#666666] dark:text-zinc-400 capitalize mb-1">
                                        {formatDate(date)}
                                    </p>
                                    <div className="rounded-xl border border-[#E8E8E8] dark:border-[#333333] px-3">
                                        {items.map((record) => (
                                            <MirrorRecordRow key={record.id} record={record} />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export function TimeClockPage() {
    const { data, isLoading } = useTimeClockMe()
    const { mutateAsync: doPunch } = usePunch()
    const { toast } = useToast()

    const [step, setStep] = useState<PunchStep>('idle')
    const [showCamera, setShowCamera] = useState(false)
    const [photoDialogSrc, setPhotoDialogSrc] = useState<string | null>(null)
    const [notifyDismissed, setNotifyDismissed] = useState(false)

    // Geolocalização capturada antes de abrir a câmera
    const [capturedPosition, setCapturedPosition] = useState<GeolocationPosition | null>(null)

    const isProcessing = step !== 'idle' && step !== 'done'

    const nextPunchType = data?.last_type === 'in' ? 'out' : 'in'

    const stepLabel: Record<PunchStep, string> = {
        idle: nextPunchType === 'in' ? 'Bater Entrada' : 'Bater Saída',
        locating: 'Localizando...',
        camera: 'Aguardando foto...',
        uploading: 'Enviando...',
        done: nextPunchType === 'in' ? 'Bater Entrada' : 'Bater Saída',
    }

    const handlePunchClick = useCallback(async () => {
        // Verificar conexão
        if (!navigator.onLine) {
            toast({
                title: 'Sem conexão',
                description: 'Você precisa estar online para bater o ponto.',
                variant: 'default',
            })
            return
        }

        setStep('locating')

        let position: GeolocationPosition
        try {
            position = await getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 })
        } catch (err) {
            setStep('idle')
            const msg =
                err instanceof GeolocationError
                    ? err.message
                    : 'Não foi possível obter sua localização.'
            toast({ title: 'Localização indisponível', description: msg, variant: 'destructive' })
            return
        }

        setCapturedPosition(position)
        setStep('camera')
        setShowCamera(true)
    }, [toast])

    const handleCapture = useCallback(
        async (file: File) => {
            setShowCamera(false)
            setStep('uploading')

            try {
                const compressed = await compressImage(file, {
                    maxWidth: 1280,
                    maxHeight: 1280,
                    quality: 0.8,
                })
                const compressedFile = new File([compressed], file.name, {
                    type: compressed.type || 'image/jpeg',
                })

                const photoUrl = await uploadService.uploadPhoto({
                    id: 'punch-selfie',
                    file: compressedFile,
                    compressed,
                    preview: URL.createObjectURL(compressed),
                    uploaded: false,
                    uploadProgress: 0,
                })

                const pos = capturedPosition!
                const record = await doPunch({
                    type: nextPunchType,
                    photo_url: photoUrl,
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    accuracy_m: pos.coords.accuracy ?? undefined,
                })

                setStep('done')

                if (record.is_within_radius === false) {
                    toast({
                        title: 'Ponto registrado',
                        description: 'Ponto registrado fora do raio da loja.',
                        variant: 'default',
                    })
                } else {
                    toast({
                        title: 'Ponto registrado',
                        description:
                            nextPunchType === 'in'
                                ? 'Entrada registrada com sucesso!'
                                : 'Saída registrada com sucesso!',
                    })
                }

                // Resetar estado após breve delay
                setTimeout(() => setStep('idle'), 2000)
            } catch (err) {
                setStep('idle')
                const status = getApiErrorStatus(err as Error)
                const msg =
                    status === 409
                        ? 'Ponto duplicado — você já bateu ponto recentemente.'
                        : status === 422
                          ? 'Usuário não vinculado a nenhum funcionário.'
                          : getApiErrorMessage(err as Error, 'Erro ao registrar ponto.')
                toast({ title: 'Erro ao bater ponto', description: msg, variant: 'destructive' })
            }
        },
        [capturedPosition, doPunch, nextPunchType, toast]
    )

    const handleCameraCancel = useCallback(() => {
        setShowCamera(false)
        setStep('idle')
        setCapturedPosition(null)
    }, [])

    const handleActivateNotifications = useCallback(async () => {
        if (typeof Notification === 'undefined') return
        const permission = await Notification.requestPermission()
        if (permission === 'granted') {
            try {
                await subscribeWebPush()
                toast({ title: 'Notificações ativadas!' })
            } catch {
                toast({
                    title: 'Erro ao ativar notificações',
                    description: 'Tente novamente mais tarde.',
                    variant: 'destructive',
                })
            }
        }
    }, [toast])

    const showPushPrompt =
        !notifyDismissed &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'default'

    // Funcionário não vinculado
    if (!isLoading && data?.employee_id === null) {
        return (
            <div className="max-w-lg mx-auto px-4 py-6">
                <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-8 text-center">
                    <Clock className="h-10 w-10 text-amber-500" />
                    <h2 className="text-base font-semibold text-amber-800 dark:text-amber-300">
                        Usuário sem vínculo de funcionário
                    </h2>
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                        Seu usuário tem acesso ao Ponto, mas não está vinculado a um funcionário —
                        fale com o administrador.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
            {/* Card de cabeçalho */}
            <div className="rounded-2xl border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] p-5 space-y-1">
                {isLoading ? (
                    <>
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="h-4 w-36 mt-1" />
                        <Skeleton className="h-4 w-32 mt-1" />
                    </>
                ) : (
                    <>
                        <div className="flex items-center gap-2">
                            <Clock className="h-5 w-5" style={{ color: '#F5A800' }} />
                            <h1 className="text-lg font-bold text-[#111111] dark:text-white">
                                Ponto Eletrônico
                            </h1>
                        </div>
                        <p className="text-sm font-medium text-[#333333] dark:text-zinc-300">
                            {data?.employee_name}
                        </p>
                        <p className="text-sm text-[#666666] dark:text-zinc-400">{data?.store_name}</p>
                        {data?.work_start_time && data?.work_end_time && (
                            <p className="text-xs text-[#999999] dark:text-zinc-500">
                                Horário:{' '}
                                <span className="font-medium text-[#666666] dark:text-zinc-400">
                                    {formatWorkTime(data.work_start_time)} –{' '}
                                    {formatWorkTime(data.work_end_time)}
                                </span>
                            </p>
                        )}
                    </>
                )}
            </div>

            {/* Prompt de notificações push */}
            {showPushPrompt && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <Bell className="h-4 w-4 text-blue-500 shrink-0" />
                        <p className="text-sm text-blue-700 dark:text-blue-300">
                            Ative notificações para receber alertas de ponto
                        </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-blue-300 text-blue-600"
                            onClick={handleActivateNotifications}
                        >
                            Ativar
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-[#999999]"
                            onClick={() => setNotifyDismissed(true)}
                        >
                            Fechar
                        </Button>
                    </div>
                </div>
            )}

            {/* Card de estado + botão de bater ponto */}
            <div className="rounded-2xl border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] p-5">
                {isLoading ? (
                    <Skeleton className="h-6 w-56 mx-auto" />
                ) : (
                    <p className="text-center text-sm font-medium text-[#333333] dark:text-zinc-300">
                        {data?.last_type === 'in' && data.today.length > 0
                            ? `Entrada batida às ${formatTime(data.today.find((r) => r.type === 'in')?.recorded_at ?? '')}`
                            : data?.last_type === 'out' && data.today.length > 0
                              ? `Saída batida às ${formatTime(data.today.filter((r) => r.type === 'out').at(-1)?.recorded_at ?? '')}`
                              : 'Você ainda não bateu ponto hoje'}
                    </p>
                )}

                {/* BOTÃO GRANDE */}
                <div className="mt-5 flex justify-center">
                    <button
                        type="button"
                        disabled={isLoading || isProcessing}
                        onClick={handlePunchClick}
                        className="w-48 h-14 rounded-2xl text-base font-bold tracking-wide transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                        style={{
                            backgroundColor:
                                nextPunchType === 'in'
                                    ? '#16a34a' // green-600
                                    : '#ea580c', // orange-600
                            color: '#fff',
                        }}
                    >
                        {isProcessing ? stepLabel[step] : stepLabel['idle']}
                    </button>
                </div>
            </div>

            {/* Registros de hoje */}
            {!isLoading && data && data.today.length > 0 && (
                <div className="rounded-2xl border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] p-5 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#666666] dark:text-zinc-400">
                        Hoje
                    </p>
                    <div className="space-y-2">
                        {data.today.map((record) => (
                            <div
                                key={record.id}
                                className="flex items-center justify-between gap-3"
                            >
                                <div className="flex items-center gap-2">
                                    {record.photo_url ? (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setPhotoDialogSrc(record.photo_url)
                                            }
                                            className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-[#D1D1D1] dark:border-[#333333] hover:opacity-80 transition-opacity"
                                        >
                                            <img
                                                src={record.photo_url}
                                                alt="Foto do ponto"
                                                className="w-full h-full object-cover"
                                            />
                                        </button>
                                    ) : (
                                        /* Ajuste sem foto — exibe ícone de chave inglesa */
                                        <div className="w-10 h-10 rounded-lg shrink-0 border border-[#D1D1D1] dark:border-[#333333] flex items-center justify-center bg-gray-50 dark:bg-zinc-800">
                                            <Wrench className="h-4 w-4 text-[#999999]" />
                                        </div>
                                    )}
                                    <span className="text-sm font-medium text-[#111111] dark:text-zinc-200">
                                        {formatTime(record.recorded_at)}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap justify-end">
                                    <Badge
                                        className={
                                            record.type === 'in'
                                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-300 dark:border-green-700/50'
                                                : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-orange-300 dark:border-orange-700/50'
                                        }
                                        variant="outline"
                                    >
                                        {record.type === 'in' ? 'Entrada' : 'Saída'}
                                    </Badge>
                                    {/* Selo de ajuste administrativo */}
                                    {record.source === 'admin_adjustment' && (
                                        <Badge
                                            variant="outline"
                                            className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-300 dark:border-blue-700/50 text-xs"
                                        >
                                            (ajuste)
                                        </Badge>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Últimos 7 dias */}
            {!isLoading && data && data.recent.length > 0 && (
                <details className="rounded-2xl border border-[#D1D1D1] dark:border-[#333333] bg-white dark:bg-[#252525] overflow-hidden">
                    <summary className="px-5 py-4 text-sm font-semibold text-[#333333] dark:text-zinc-300 cursor-pointer select-none">
                        Últimos 7 dias
                    </summary>
                    <div className="px-5 pb-5 space-y-4">
                        {groupByDate(data.recent).map(({ date, items }) => (
                            <div key={date} className="space-y-2">
                                <p className="text-xs font-semibold text-[#666666] dark:text-zinc-400 capitalize">
                                    {formatDate(date)}
                                </p>
                                {items.map((record) => (
                                    <div
                                        key={record.id}
                                        className="flex items-center justify-between gap-3"
                                    >
                                        <div className="flex items-center gap-2">
                                            {record.photo_url ? (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setPhotoDialogSrc(record.photo_url)
                                                    }
                                                    className="w-9 h-9 rounded-lg overflow-hidden shrink-0 border border-[#D1D1D1] dark:border-[#333333] hover:opacity-80 transition-opacity"
                                                >
                                                    <img
                                                        src={record.photo_url}
                                                        alt="Foto do ponto"
                                                        className="w-full h-full object-cover"
                                                    />
                                                </button>
                                            ) : (
                                                <div className="w-9 h-9 rounded-lg shrink-0 border border-[#D1D1D1] dark:border-[#333333] flex items-center justify-center bg-gray-50 dark:bg-zinc-800">
                                                    <Wrench className="h-3.5 w-3.5 text-[#999999]" />
                                                </div>
                                            )}
                                            <span className="text-sm text-[#333333] dark:text-zinc-300">
                                                {formatTime(record.recorded_at)}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 flex-wrap justify-end">
                                            <Badge
                                                className={
                                                    record.type === 'in'
                                                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-300 dark:border-green-700/50'
                                                        : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-orange-300 dark:border-orange-700/50'
                                                }
                                                variant="outline"
                                            >
                                                {record.type === 'in' ? 'Entrada' : 'Saída'}
                                            </Badge>
                                            {record.source === 'admin_adjustment' && (
                                                <Badge
                                                    variant="outline"
                                                    className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-300 dark:border-blue-700/50 text-xs"
                                                >
                                                    (ajuste)
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </details>
            )}

            {/* Seção "Meu espelho" — autoatendimento */}
            {!isLoading && data?.employee_id !== null && <MyMirrorSection />}

            {/* Câmera */}
            {showCamera && (
                <CameraCapture
                    facingMode="user"
                    onCapture={handleCapture}
                    onCancel={handleCameraCancel}
                />
            )}

            {/* Dialog de foto em tela cheia */}
            <Dialog
                open={!!photoDialogSrc}
                onOpenChange={(o) => {
                    if (!o) setPhotoDialogSrc(null)
                }}
            >
                <DialogContent className="max-w-2xl p-2">
                    <DialogHeader className="sr-only">
                        <DialogTitle>Foto do ponto</DialogTitle>
                    </DialogHeader>
                    {photoDialogSrc && (
                        <img
                            src={photoDialogSrc}
                            alt="Foto do ponto"
                            className="w-full rounded-lg object-contain max-h-[80vh]"
                        />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
