import { useState, useEffect, useRef } from 'react'
import { Clock, Download, Plus, Ban, Wrench, FileText } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { useTimeClockList, useCreateAdjustment, useAnnulRecord } from '@/hooks/useTimeClock'
import { useEmployees } from '@/hooks/useEmployees'
import { timeClockService } from '@/services/api/timeClock.service'
import { useStores } from '@/hooks/useStores'
import { useToast } from '@/hooks/use-toast'
import { useAuthStore } from '@/stores/auth.store'
import { useHasPermission } from '@/hooks/useMyPermissions'
import type { TimeClockRecord } from '@/types/timeClock.types'

// ─── Utilitários ────────────────────────────────────────────────────────────

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

function formatDistance(distance_m: number | null): string {
    if (distance_m === null) return '—'
    if (distance_m < 1000) return `${Math.round(distance_m)}m`
    return `${(distance_m / 1000).toFixed(1).replace('.', ',')}km`
}

function getTodayDateString(): string {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

/** Faz o download de um Blob como arquivo. */
function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

// ─── Schemas Zod ────────────────────────────────────────────────────────────

/** Schema do modal "Lançar ajuste" */
const adjustmentSchema = z.object({
    employee_id: z.number({ error: 'Selecione um funcionário' }),
    type: z.enum(['in', 'out']),
    /** Formato esperado: 'YYYY-MM-DDTHH:MM' (input datetime-local) */
    recorded_at_local: z
        .string()
        .min(1, 'Data e hora são obrigatórios')
        .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Formato inválido'),
    reason: z.string().min(3, 'Motivo deve ter no mínimo 3 caracteres'),
})
type AdjustmentFormData = z.infer<typeof adjustmentSchema>

/** Schema do modal "Anular registro" */
const annulSchema = z.object({
    reason: z.string().min(3, 'Motivo deve ter no mínimo 3 caracteres'),
})
type AnnulFormData = z.infer<typeof annulSchema>

/** Schema do modal "Exportar AFD/AEJ" */
const exportSchema = z.object({
    store_id: z.number({ error: 'Selecione uma loja' }),
    start: z.string().min(1, 'Data inicial obrigatória'),
    end: z.string().min(1, 'Data final obrigatória'),
})
type ExportFormData = z.infer<typeof exportSchema>

// ─── Modal: Lançar Ajuste ───────────────────────────────────────────────────

interface AdjustmentDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

function AdjustmentDialog({ open, onOpenChange }: AdjustmentDialogProps) {
    const { mutateAsync: createAdjustment, isPending } = useCreateAdjustment()
    const { toast } = useToast()

    // Carrega lista de funcionários ativos para o combobox
    const { employees } = useEmployees({ is_active: true }, 1)

    const {
        register,
        handleSubmit,
        setValue,
        watch,
        reset,
        formState: { errors },
    } = useForm<AdjustmentFormData>({ resolver: zodResolver(adjustmentSchema) })

    const selectedEmployeeId = watch('employee_id')
    const selectedType = watch('type')

    useEffect(() => {
        if (!open) reset()
    }, [open, reset])

    const onSubmit = async (data: AdjustmentFormData) => {
        // Converte datetime-local para ISO com fuso horário local
        const localDate = new Date(data.recorded_at_local)
        const isoWithTz = localDate.toISOString()

        try {
            await createAdjustment({
                employee_id: data.employee_id,
                type: data.type,
                recorded_at: isoWithTz,
                reason: data.reason,
            })
            reset()
            onOpenChange(false)
        } catch {
            // Erro já tratado no hook useCreateAdjustment
            toast({
                title: 'Erro ao lançar ajuste',
                description: 'Verifique os dados e tente novamente.',
                variant: 'destructive',
            })
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Lançar Ajuste de Ponto</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* Funcionário */}
                    <div className="space-y-2">
                        <label htmlFor="adj-employee" className="text-sm font-medium">
                            Funcionário <span className="text-red-500">*</span>
                        </label>
                        <Select
                            value={selectedEmployeeId?.toString() ?? ''}
                            onValueChange={(v) => setValue('employee_id', Number(v))}
                        >
                            <SelectTrigger id="adj-employee">
                                <SelectValue placeholder="Selecione o funcionário" />
                            </SelectTrigger>
                            <SelectContent className="max-h-56">
                                {employees.map((e) => (
                                    <SelectItem key={e.id} value={e.id.toString()}>
                                        {e.name}
                                        {e.last_name ? ` ${e.last_name}` : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {errors.employee_id && (
                            <p className="text-sm text-red-500">{errors.employee_id.message}</p>
                        )}
                    </div>

                    {/* Tipo: Entrada / Saída */}
                    <div className="space-y-2">
                        <label htmlFor="adj-type" className="text-sm font-medium">
                            Tipo <span className="text-red-500">*</span>
                        </label>
                        <Select
                            value={selectedType ?? ''}
                            onValueChange={(v) => setValue('type', v as 'in' | 'out')}
                        >
                            <SelectTrigger id="adj-type">
                                <SelectValue placeholder="Selecione o tipo" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="in">Entrada</SelectItem>
                                <SelectItem value="out">Saída</SelectItem>
                            </SelectContent>
                        </Select>
                        {errors.type && (
                            <p className="text-sm text-red-500">{errors.type.message}</p>
                        )}
                    </div>

                    {/* Data e hora */}
                    <div className="space-y-2">
                        <label htmlFor="adj-datetime" className="text-sm font-medium">
                            Data e Hora <span className="text-red-500">*</span>
                        </label>
                        <Input
                            id="adj-datetime"
                            type="datetime-local"
                            {...register('recorded_at_local')}
                        />
                        {errors.recorded_at_local && (
                            <p className="text-sm text-red-500">{errors.recorded_at_local.message}</p>
                        )}
                    </div>

                    {/* Motivo */}
                    <div className="space-y-2">
                        <label htmlFor="adj-reason" className="text-sm font-medium">
                            Motivo <span className="text-red-500">*</span>
                        </label>
                        <Textarea
                            id="adj-reason"
                            placeholder="Descreva o motivo do ajuste..."
                            rows={3}
                            {...register('reason')}
                        />
                        {errors.reason && (
                            <p className="text-sm text-red-500">{errors.reason.message}</p>
                        )}
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => { reset(); onOpenChange(false) }}
                        >
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={isPending}>
                            {isPending ? 'Lançando...' : 'Lançar Ajuste'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

// ─── Modal: Anular Registro ─────────────────────────────────────────────────

interface AnnulDialogProps {
    record: TimeClockRecord | null
    open: boolean
    onOpenChange: (open: boolean) => void
}

function AnnulDialog({ record, open, onOpenChange }: AnnulDialogProps) {
    const { mutateAsync: annulRecord, isPending } = useAnnulRecord()

    const {
        register,
        handleSubmit,
        reset,
        formState: { errors },
    } = useForm<AnnulFormData>({ resolver: zodResolver(annulSchema) })

    useEffect(() => {
        if (!open) reset()
    }, [open, reset])

    const onSubmit = async (data: AnnulFormData) => {
        if (!record) return
        await annulRecord({ recordId: record.id, payload: { reason: data.reason } })
        reset()
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>Anular Registro de Ponto</DialogTitle>
                </DialogHeader>

                {record && (
                    <div className="rounded-lg border border-[#D1D1D1] dark:border-[#333333] p-3 bg-gray-50 dark:bg-zinc-800/40 text-sm space-y-1 mb-2">
                        <p className="font-medium text-[#111111] dark:text-zinc-200">
                            {record.employee_name}
                        </p>
                        <p className="text-[#666666] dark:text-zinc-400">
                            {record.type === 'in' ? 'Entrada' : 'Saída'} —{' '}
                            {formatTime(record.recorded_at)}
                        </p>
                    </div>
                )}

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="space-y-2">
                        <label htmlFor="ann-reason" className="text-sm font-medium">
                            Motivo da anulação <span className="text-red-500">*</span>
                        </label>
                        <Textarea
                            id="ann-reason"
                            placeholder="Descreva o motivo da anulação..."
                            rows={3}
                            {...register('reason')}
                        />
                        {errors.reason && (
                            <p className="text-sm text-red-500">{errors.reason.message}</p>
                        )}
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => { reset(); onOpenChange(false) }}
                        >
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={isPending} variant="destructive">
                            {isPending ? 'Anulando...' : 'Confirmar Anulação'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

// ─── Modal: Exportar AFD / AEJ ──────────────────────────────────────────────

type ExportFileType = 'afd' | 'aej'

interface ExportFiscalDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    fileType: ExportFileType
    stores: Array<{ id: number; name: string }>
}

function ExportFiscalDialog({ open, onOpenChange, fileType, stores }: ExportFiscalDialogProps) {
    const { toast } = useToast()
    const [isExporting, setIsExporting] = useState(false)

    const {
        handleSubmit,
        setValue,
        watch,
        register,
        reset,
        formState: { errors },
    } = useForm<ExportFormData>({ resolver: zodResolver(exportSchema) })

    const selectedStoreId = watch('store_id')

    useEffect(() => {
        if (!open) reset()
    }, [open, reset])

    const onSubmit = async (data: ExportFormData) => {
        setIsExporting(true)
        try {
            const blob =
                fileType === 'afd'
                    ? await timeClockService.exportAfd({
                          store_id: data.store_id,
                          start: data.start,
                          end: data.end,
                      })
                    : await timeClockService.exportAej({
                          store_id: data.store_id,
                          start: data.start,
                          end: data.end,
                      })

            const storeName =
                stores.find((s) => s.id === data.store_id)?.name?.replace(/\s+/g, '-') ?? 'loja'
            const filename = `${fileType.toUpperCase()}-${storeName}-${data.start}-${data.end}.txt`
            downloadBlob(blob, filename)
        } catch {
            toast({
                title: `Erro ao exportar ${fileType.toUpperCase()}`,
                description: 'Tente novamente.',
                variant: 'destructive',
            })
        } finally {
            setIsExporting(false)
        }
    }

    const label = fileType === 'afd' ? 'AFD' : 'AEJ'
    const description =
        fileType === 'afd'
            ? 'Arquivo de Fonte de Dados — compatível com o leiaute da Portaria MTP 671/2021 (sem assinatura ICP-Brasil)'
            : 'Arquivo Eletrônico de Jornada simplificado (sem assinatura ICP-Brasil)'

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Exportar {label}</DialogTitle>
                </DialogHeader>

                <p className="text-sm text-[#666666] dark:text-zinc-400 -mt-2">{description}</p>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* Loja */}
                    <div className="space-y-2">
                        <label htmlFor="exp-store" className="text-sm font-medium">
                            Loja <span className="text-red-500">*</span>
                        </label>
                        <Select
                            value={selectedStoreId?.toString() ?? ''}
                            onValueChange={(v) => setValue('store_id', Number(v))}
                        >
                            <SelectTrigger id="exp-store">
                                <SelectValue placeholder="Selecione a loja" />
                            </SelectTrigger>
                            <SelectContent>
                                {stores.map((s) => (
                                    <SelectItem key={s.id} value={s.id.toString()}>
                                        {s.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {errors.store_id && (
                            <p className="text-sm text-red-500">{errors.store_id.message}</p>
                        )}
                    </div>

                    {/* Intervalo de datas */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <label htmlFor="exp-start" className="text-sm font-medium">
                                Data inicial <span className="text-red-500">*</span>
                            </label>
                            <Input id="exp-start" type="date" {...register('start')} />
                            {errors.start && (
                                <p className="text-sm text-red-500">{errors.start.message}</p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="exp-end" className="text-sm font-medium">
                                Data final <span className="text-red-500">*</span>
                            </label>
                            <Input id="exp-end" type="date" {...register('end')} />
                            {errors.end && (
                                <p className="text-sm text-red-500">{errors.end.message}</p>
                            )}
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => { reset(); onOpenChange(false) }}
                        >
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={isExporting}>
                            {isExporting ? 'Exportando...' : `Baixar ${label}`}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

// ─── Página principal ────────────────────────────────────────────────────────

export function TimeClockMirrorPage() {
    const { stores } = useStores()
    const { toast } = useToast()
    const isOwner = useAuthStore((s) => s.isOwner())
    const hasPermission = useHasPermission()
    // can_edit em time_clock_mirror permite lançar ajustes e anulações
    const canEdit = isOwner || hasPermission('time_clock_mirror', 'edit')

    const [storeId, setStoreId] = useState<number | undefined>(undefined)
    const [date, setDate] = useState<string>(getTodayDateString())
    const [searchInput, setSearchInput] = useState('')
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)
    const [photoDialogSrc, setPhotoDialogSrc] = useState<string | null>(null)
    const [isExportingPdf, setIsExportingPdf] = useState(false)

    // Estado dos modais
    const [adjustmentOpen, setAdjustmentOpen] = useState(false)
    const [annulOpen, setAnnulOpen] = useState(false)
    const [annulTarget, setAnnulTarget] = useState<TimeClockRecord | null>(null)
    const [exportAfdOpen, setExportAfdOpen] = useState(false)
    const [exportAejOpen, setExportAejOpen] = useState(false)

    // Debounce da busca por funcionário
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => {
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
        searchTimerRef.current = setTimeout(() => {
            setSearch(searchInput)
            setPage(1)
        }, 300)
        return () => {
            if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
        }
    }, [searchInput])

    const PAGE_SIZE = 20

    const { data, isLoading } = useTimeClockList({
        store_id: storeId,
        date: date || undefined,
        page,
        limit: PAGE_SIZE,
    })

    // Filtro client-side por nome de funcionário
    const items: TimeClockRecord[] = (data?.items ?? []).filter((r) => {
        if (!search) return true
        return r.employee_name.toLowerCase().includes(search.toLowerCase())
    })

    const pagination = data?.pagination

    const handleExportPdf = async () => {
        const exportStoreId = storeId ?? stores[0]?.id
        if (!exportStoreId) {
            toast({ title: 'Selecione uma loja para exportar.', variant: 'destructive' })
            return
        }
        if (!date) {
            toast({ title: 'Selecione uma data para exportar.', variant: 'destructive' })
            return
        }
        setIsExportingPdf(true)
        try {
            const blob = await timeClockService.exportPdf({ store_id: exportStoreId, date })
            downloadBlob(blob, `espelho-ponto-${date}.pdf`)
        } catch {
            toast({
                title: 'Erro ao exportar PDF',
                description: 'Tente novamente.',
                variant: 'destructive',
            })
        } finally {
            setIsExportingPdf(false)
        }
    }

    const handleAnnulClick = (record: TimeClockRecord) => {
        // Verificar se já é uma anulação (não pode anular uma anulação)
        if (record.annuls_record_id !== null) {
            toast({
                title: 'Não é possível anular',
                description: 'Este registro já é uma anulação.',
                variant: 'destructive',
            })
            return
        }
        setAnnulTarget(record)
        setAnnulOpen(true)
    }

    return (
        <div className="pt-3 px-4 pb-4 md:pt-4 md:px-6 md:pb-6 space-y-5">
            {/* Cabeçalho */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#F5A800]/15 flex items-center justify-center shrink-0">
                        <Clock className="w-5 h-5" style={{ color: '#F5A800' }} />
                    </div>
                    <div>
                        <h1
                            className="text-xl font-bold text-[#111111] dark:text-white tracking-tight"
                            style={{ fontFamily: 'Barlow, Barlow Semi Condensed, sans-serif' }}
                        >
                            Espelho de Ponto
                        </h1>
                        <p className="text-sm text-[#666666] dark:text-zinc-400">
                            Registros de ponto eletrônico por loja e data
                        </p>
                    </div>
                </div>

                {/* Ações do cabeçalho */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {/* Exportar AFD e AEJ */}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExportAfdOpen(true)}
                        title="Arquivo de Fonte de Dados — compatível com Portaria MTP 671/2021 (sem assinatura ICP-Brasil)"
                        className="text-xs"
                    >
                        <FileText className="h-3.5 w-3.5 mr-1.5" />
                        Exportar AFD
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExportAejOpen(true)}
                        title="Arquivo Eletrônico de Jornada simplificado (sem assinatura ICP-Brasil)"
                        className="text-xs"
                    >
                        <FileText className="h-3.5 w-3.5 mr-1.5" />
                        Exportar AEJ
                    </Button>

                    {/* Lançar ajuste — apenas com can_edit */}
                    {canEdit && (
                        <Button
                            size="sm"
                            onClick={() => setAdjustmentOpen(true)}
                            className="font-semibold text-xs"
                            style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                        >
                            <Plus className="h-3.5 w-3.5 mr-1.5" />
                            Lançar ajuste
                        </Button>
                    )}

                    {/* PDF do espelho */}
                    <Button
                        onClick={handleExportPdf}
                        disabled={isExportingPdf}
                        className="font-semibold"
                        style={{ backgroundColor: '#F5A800', color: '#1A1A1A' }}
                    >
                        <Download className="h-4 w-4 mr-2" />
                        {isExportingPdf ? 'Exportando...' : 'Exportar PDF'}
                    </Button>
                </div>
            </div>

            {/* Filtros */}
            <div className="bg-white dark:bg-[#252525] border border-[#D1D1D1] dark:border-[#333333] rounded-xl p-4 flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Loja</span>
                    <Select
                        value={storeId?.toString() ?? '__all__'}
                        onValueChange={(v) => {
                            setStoreId(v === '__all__' ? undefined : Number(v))
                            setPage(1)
                        }}
                    >
                        <SelectTrigger className="w-[200px] bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus:ring-[#F5A800]">
                            <SelectValue placeholder="Todas as lojas" />
                        </SelectTrigger>
                        <SelectContent className="bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white">
                            <SelectItem value="__all__">Todas as lojas</SelectItem>
                            {stores.map((s) => (
                                <SelectItem key={s.id} value={s.id.toString()}>
                                    {s.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">Data</span>
                    <Input
                        type="date"
                        value={date}
                        onChange={(e) => {
                            setDate(e.target.value)
                            setPage(1)
                        }}
                        className="w-[170px] bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white focus-visible:ring-[#F5A800]"
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-[#666666] dark:text-zinc-400">
                        Funcionário
                    </span>
                    <Input
                        placeholder="Buscar funcionário..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        className="w-[220px] bg-white dark:bg-[#252525] border-[#D1D1D1] dark:border-[#333333] text-[#111111] dark:text-white placeholder:text-[#999999] dark:placeholder:text-zinc-500 focus-visible:ring-[#F5A800]"
                    />
                </div>
            </div>

            {/* Contagem de resultados */}
            <p className="text-sm text-[#666666] dark:text-zinc-400">
                {pagination?.total ?? 0} registro(s) encontrado(s)
            </p>

            {/* Tabela */}
            <div className="border border-[#D1D1D1] dark:border-[#333333] rounded-xl overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-gray-100 dark:bg-zinc-800/60">
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide w-16">
                                Foto
                            </TableHead>
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide">
                                Funcionário
                            </TableHead>
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide">
                                Tipo
                            </TableHead>
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide">
                                Hora
                            </TableHead>
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide">
                                Distância
                            </TableHead>
                            <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide">
                                Situação
                            </TableHead>
                            {/* Coluna de ações: apenas para can_edit */}
                            {canEdit && (
                                <TableHead className="text-xs font-semibold text-[#666666] dark:text-zinc-400 uppercase tracking-wide w-24">
                                    Ações
                                </TableHead>
                            )}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            Array.from({ length: 8 }).map((_, i) => (
                                <TableRow
                                    key={i}
                                    className="border-t border-[#E8E8E8] dark:border-[#333333]"
                                >
                                    {Array.from({ length: canEdit ? 7 : 6 }).map((__, j) => (
                                        <TableCell key={j}>
                                            <Skeleton className="h-5 w-full bg-gray-200 dark:bg-zinc-800 animate-pulse rounded" />
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : items.length === 0 ? (
                            <TableRow>
                                <TableCell
                                    colSpan={canEdit ? 7 : 6}
                                    className="text-center py-12"
                                >
                                    <div className="flex flex-col items-center gap-3 text-[#999999] dark:text-zinc-500">
                                        <Clock className="h-10 w-10 opacity-30" />
                                        <p className="text-sm">Nenhum registro encontrado</p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            items.map((record) => (
                                <TableRow
                                    key={record.id}
                                    className={`border-t border-[#E8E8E8] dark:border-[#333333] hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors ${
                                        record.annuls_record_id !== null
                                            ? 'opacity-50'
                                            : ''
                                    }`}
                                >
                                    {/* Foto */}
                                    <TableCell>
                                        {record.photo_url ? (
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setPhotoDialogSrc(record.photo_url)
                                                }
                                                className="w-10 h-10 rounded-lg overflow-hidden border border-[#D1D1D1] dark:border-[#333333] hover:opacity-80 transition-opacity"
                                                aria-label="Ver foto do ponto"
                                            >
                                                <img
                                                    src={record.photo_url}
                                                    alt="Foto do ponto"
                                                    className="w-full h-full object-cover"
                                                />
                                            </button>
                                        ) : (
                                            /* Ajuste sem foto */
                                            <div className="w-10 h-10 rounded-lg border border-[#D1D1D1] dark:border-[#333333] flex items-center justify-center bg-gray-50 dark:bg-zinc-800">
                                                <Wrench className="h-4 w-4 text-[#999999]" />
                                            </div>
                                        )}
                                    </TableCell>

                                    {/* Funcionário + motivo (se ajuste) */}
                                    <TableCell>
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-sm font-medium text-[#111111] dark:text-zinc-200">
                                                {record.employee_name}
                                            </span>
                                            {record.adjustment_reason && (
                                                <span className="text-xs text-[#999999] dark:text-zinc-500 max-w-[200px] truncate">
                                                    {record.adjustment_reason}
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>

                                    {/* Tipo + selos de ajuste/anulação */}
                                    <TableCell>
                                        <div className="flex flex-col gap-1">
                                            <Badge
                                                variant="outline"
                                                className={
                                                    record.type === 'in'
                                                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-300 dark:border-green-700/50 w-fit'
                                                        : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-orange-300 dark:border-orange-700/50 w-fit'
                                                }
                                            >
                                                {record.type === 'in' ? 'Entrada' : 'Saída'}
                                            </Badge>
                                            {/* Selo: anulação */}
                                            {record.annuls_record_id !== null && (
                                                <Badge
                                                    variant="outline"
                                                    className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-300 dark:border-red-700/50 w-fit"
                                                >
                                                    Anulação
                                                </Badge>
                                            )}
                                            {/* Selo: ajuste administrativo (não anulação) */}
                                            {record.source === 'admin_adjustment' &&
                                                record.annuls_record_id === null && (
                                                    <Badge
                                                        variant="outline"
                                                        className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-300 dark:border-blue-700/50 w-fit"
                                                    >
                                                        Ajuste
                                                    </Badge>
                                                )}
                                        </div>
                                    </TableCell>

                                    {/* Hora */}
                                    <TableCell className="text-sm text-[#333333] dark:text-zinc-300">
                                        {formatTime(record.recorded_at)}
                                    </TableCell>

                                    {/* Distância */}
                                    <TableCell className="text-sm text-[#666666] dark:text-zinc-400">
                                        {formatDistance(record.distance_m)}
                                    </TableCell>

                                    {/* Situação de geofence */}
                                    <TableCell>
                                        <div className="flex flex-col gap-0.5">
                                            {record.is_within_radius === true ? (
                                                <Badge
                                                    variant="outline"
                                                    className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-300 dark:border-green-700/50 w-fit"
                                                >
                                                    Na loja
                                                </Badge>
                                            ) : record.is_within_radius === false ? (
                                                <Badge
                                                    variant="outline"
                                                    className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700/50 w-fit"
                                                >
                                                    Fora da loja
                                                </Badge>
                                            ) : (
                                                <Badge
                                                    variant="outline"
                                                    className="bg-gray-100 text-[#666666] dark:bg-zinc-800 dark:text-zinc-400 border-[#D1D1D1] dark:border-zinc-700 w-fit"
                                                >
                                                    Sem geofence
                                                </Badge>
                                            )}
                                            {record.accuracy_m !== null && (
                                                <span className="text-xs text-[#999999] dark:text-zinc-500">
                                                    ±{Math.round(record.accuracy_m)}m
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>

                                    {/* Ações: apenas para can_edit */}
                                    {canEdit && (
                                        <TableCell>
                                            {/* Não exibir "Anular" em registros que já são anulações */}
                                            {record.annuls_record_id === null ? (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleAnnulClick(record)}
                                                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 h-7 px-2 text-xs"
                                                    aria-label={`Anular registro de ${record.employee_name}`}
                                                >
                                                    <Ban className="h-3.5 w-3.5 mr-1" />
                                                    Anular
                                                </Button>
                                            ) : (
                                                <span className="text-xs text-[#999999] dark:text-zinc-500 italic">
                                                    —
                                                </span>
                                            )}
                                        </TableCell>
                                    )}
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Paginação */}
            {pagination && pagination.total_pages > 1 && (
                <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-[#666666] dark:text-zinc-400">
                        Página {pagination.page} de {pagination.total_pages}
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={!pagination.has_prev}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                            Anterior
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={!pagination.has_next}
                            onClick={() => setPage((p) => p + 1)}
                        >
                            Próxima
                        </Button>
                    </div>
                </div>
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

            {/* Modal: lançar ajuste */}
            <AdjustmentDialog open={adjustmentOpen} onOpenChange={setAdjustmentOpen} />

            {/* Modal: anular registro */}
            <AnnulDialog
                record={annulTarget}
                open={annulOpen}
                onOpenChange={(v) => {
                    setAnnulOpen(v)
                    if (!v) setAnnulTarget(null)
                }}
            />

            {/* Modais de exportação fiscal */}
            <ExportFiscalDialog
                open={exportAfdOpen}
                onOpenChange={setExportAfdOpen}
                fileType="afd"
                stores={stores}
            />
            <ExportFiscalDialog
                open={exportAejOpen}
                onOpenChange={setExportAejOpen}
                fileType="aej"
                stores={stores}
            />
        </div>
    )
}
